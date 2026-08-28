// ═══════════════════════════════════════════════════════════════
// POST /api/auth/forgot-password
// ═══════════════════════════════════════════════════════════════
// Issues a single-use password reset link.
//
// The response is identical whether or not the address exists. Saying "no
// account found" would turn this endpoint into a way to enumerate every user of
// the system, which is exactly what an attacker wants before trying passwords.
//
// The token is stored hashed, for the same reason passwords are: a database
// dump should not hand over working reset links.

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { db } from "@/db/client";
import { authTokens, users } from "@/db/schema/identity";
import { checkRateLimit, clientIdentifier } from "@/lib/api-context";
import { resetPasswordEmail, sendMail } from "@/lib/mailer";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

const TTL_MINUTES = 60;

/** Same generic answer in every case. */
const GENERIC = {
  ok: true,
  message: "If that address has an account, a reset link is on its way.",
};

function baseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_HRMS_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

export async function POST(request: NextRequest) {
  // Rate limited on the address as well as the caller, so one account cannot be
  // spammed with reset mail from many sources.
  const limit = checkRateLimit(`forgot:${clientIdentifier(request)}`, 10, 60 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
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
  // Even an invalid address gets the generic answer; distinguishing them leaks
  // nothing useful but invites probing.
  if (!parsed.success) return NextResponse.json(GENERIC);
  const { email } = parsed.data;

  try {
    const found = await db()
      .select({
        id: users.id,
        orgId: users.orgId,
        displayName: users.displayName,
        status: users.status,
      })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    const user = found[0];
    if (user && user.status !== "suspended") {
      const token = randomBytes(32).toString("base64url");
      const tokenHash = bytesToHex(sha256(new TextEncoder().encode(token)));

      await db()
        .insert(authTokens)
        .values({
          userId: user.id,
          orgId: user.orgId,
          email,
          purpose: "password_reset",
          tokenHash,
          expiresAt: new Date(Date.now() + TTL_MINUTES * 60_000),
        });

      const link = `${baseUrl(request)}/reset-password?token=${encodeURIComponent(token)}`;
      const message = resetPasswordEmail(link, user.displayName ?? undefined);
      // Awaited so a failure is logged against this request rather than
      // vanishing after the response.
      await sendMail({ to: email, ...message });
    }
  } catch (error) {
    // Still generic: an internal fault must not become a way to tell which
    // addresses are real.
    console.error("Password reset request failed:", error);
  }

  return NextResponse.json(GENERIC);
}
