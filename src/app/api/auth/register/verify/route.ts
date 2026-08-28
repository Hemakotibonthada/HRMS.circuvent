// ═══════════════════════════════════════════════════════════════
// POST /api/auth/register/verify
// ═══════════════════════════════════════════════════════════════
// Completes a sign-up: checks the emailed code, then creates the tenant.
//
// This is the half of registration that writes. `POST /api/auth/register`
// deliberately creates nothing — see the note at the top of that file for why
// an unverified address must not be able to stand up an organisation in
// somebody else's name.
//
// The code is checked against a stored hash bound to the address, a wrong
// guess is counted, and the token dies after a handful of them. The check and
// the consume happen in one transaction, so a caller racing two correct codes
// gets one organisation rather than two.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { authTokens } from "@/db/schema/identity";
import {
  MAX_VERIFICATION_ATTEMPTS,
  checkVerification,
  hashVerificationCode,
  readPendingMetadata,
} from "@/lib/auth/pending-registration";
import { provisionTenant } from "@/lib/auth/provision-tenant";
import { signInWithSso } from "@/lib/auth/session";
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
} from "@/lib/auth/tokens";
import { checkRateLimit, clientIdentifier } from "@/lib/api-context";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

/**
 * One message for every way a code can fail.
 *
 * "That code has expired" and "that code is wrong" are both actionable in the
 * same way — ask for a new one — and distinguishing them tells somebody who is
 * guessing which of their guesses found a live token.
 */
const REFUSED = "That code is not valid. Ask for a new one and try again.";

export async function POST(request: NextRequest) {
  // Tighter than the send limit: this is the endpoint somebody would sit and
  // guess against, and six digits is a small enough space to be worth trying.
  const limit = checkRateLimit(`register-verify:${clientIdentifier(request)}`, 20, 60 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429 }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const { email, code } = parsed.data;

  let orgId: string | undefined;

  try {
    const submittedHash = hashVerificationCode(email, code);

    const outcome = await db().transaction(async (tx) => {
      await tx.execute(`SET LOCAL app.superuser = 'on'`);

      const [row] = await tx
        .select()
        .from(authTokens)
        .where(
          and(
            eq(authTokens.email, email),
            eq(authTokens.purpose, "email_verification"),
            isNull(authTokens.consumedAt)
          )
        )
        .orderBy(desc(authTokens.createdAt))
        .limit(1);

      if (!row) return { ok: false as const };

      const pending = readPendingMetadata(row.metadata);
      if (!pending) return { ok: false as const };

      const verdict = checkVerification({
        storedHash: row.tokenHash,
        submittedHash,
        expiresAt: row.expiresAt,
        consumedAt: row.consumedAt,
        attempts: pending.attempts,
      });

      if (!verdict.ok) {
        if (verdict.reason === "wrong_code") {
          const attempts = pending.attempts + 1;
          await tx
            .update(authTokens)
            .set({
              metadata: { ...pending, attempts },
              // Spent rather than left alive to be guessed at again. A fresh
              // code is one form submission away.
              ...(attempts >= MAX_VERIFICATION_ATTEMPTS ? { consumedAt: new Date() } : {}),
            })
            .where(eq(authTokens.id, row.id));
        }
        return { ok: false as const };
      }

      // Consumed here, in the same transaction that read it, so two requests
      // carrying the same correct code cannot both get past this point.
      await tx
        .update(authTokens)
        .set({ consumedAt: new Date() })
        .where(eq(authTokens.id, row.id));

      return { ok: true as const, pending };
    });

    if (!outcome.ok) {
      return NextResponse.json({ error: REFUSED }, { status: 400 });
    }

    const created = await provisionTenant({
      name: outcome.pending.name,
      company: outcome.pending.company,
      email,
      passwordHash: outcome.pending.passwordHash,
    });
    orgId = created.orgId;
  } catch (error) {
    console.error("Registration verification failed:", error);
    return NextResponse.json(
      { error: "Could not finish creating your account. Please try again." },
      { status: 500 }
    );
  }

  // Signed in without a password, because the password itself was never
  // carried past the first step — only its hash was. This is the same path
  // SSO uses: the one other place a session is issued to somebody whose
  // identity was established by something other than typing their password
  // just now. Here that something is the code they have proved they received.
  const result = await signInWithSso({
    email,
    app: "hrms",
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  if (!result.ok) {
    // The organisation exists; only the automatic sign-in did not happen.
    return NextResponse.json(
      { created: true, signedIn: false, message: "Account created. Please sign in." },
      { status: 201 }
    );
  }

  const wantsTokens =
    (raw as { client?: unknown })?.client === "native" ||
    request.headers.get("x-circuvent-client") === "native";

  const response = NextResponse.json(
    {
      created: true,
      signedIn: true,
      orgId,
      user: result.user,
      ...(wantsTokens
        ? {
            tokens: {
              accessToken: result.accessToken,
              refreshToken: result.refreshToken,
              expiresIn: ACCESS_TOKEN_TTL_SECONDS,
            },
          }
        : {}),
    },
    { status: 201 }
  );
  response.cookies.set(ACCESS_COOKIE, result.accessToken, accessCookieOptions());
  response.cookies.set(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
  return response;
}
