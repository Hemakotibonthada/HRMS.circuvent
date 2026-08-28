// ═══════════════════════════════════════════════════════════════
// MFA ENROLMENT — /api/auth/mfa
// ═══════════════════════════════════════════════════════════════
// GET    — is MFA enabled, pending, or off?
// POST   — begin enrolment: mint a secret, return the QR payload
// DELETE — turn MFA off, on proof of password *and* a live code
//
// Confirmation lives at ./confirm, because beginning and completing enrolment
// are different operations with different failure modes and it should be
// obvious in a log which one happened.
//
// Everything here is deliberately restricted to the caller's own account.
// There is no `userId` parameter: an administrator resetting someone else's
// second factor is a separate, auditable operation, and folding it in here
// would make "disable MFA" reachable with an ordinary session.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema/identity";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { createTotpEnrolment, verifyTotp } from "@/lib/auth/mfa";
import { verifyPassword } from "@/lib/auth/password";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { canBeginEnrolment, canDisable, mfaState } from "@/lib/auth/mfa-enrolment";

const disableSchema = z.object({
  password: z.string().min(1, "Password is required"),
  code: z.string().min(1, "A current authenticator code is required"),
});

interface MfaRow {
  mfaSecret: string | null;
  mfaEnabledAt: Date | null;
  passwordHash: string | null;
}

async function readMfaRow(orgId: string, userId: string): Promise<MfaRow | null> {
  return withTenant({ orgId }, async (tx) => {
    const rows = await tx
      .select({
        mfaSecret: users.mfaSecret,
        mfaEnabledAt: users.mfaEnabledAt,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0] ?? null;
  });
}

function rateLimited(request: NextRequest, key: string, userId: string) {
  const limit = checkRateLimit(`${key}:${clientIdentifier(request, userId)}`, 10, 60_000);
  if (limit.allowed) return null;
  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: { "retry-after": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) },
    }
  );
}

/** GET /api/auth/mfa — the state of the caller's own second factor. */
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const row = await readMfaRow(ctx.orgId, ctx.userId);
  if (!row) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const state = mfaState(row.mfaSecret, row.mfaEnabledAt);
  return NextResponse.json({
    enabled: state === "active",
    pending: state === "pending",
    enabledAt: row.mfaEnabledAt?.toISOString() ?? null,
  });
}

/**
 * POST /api/auth/mfa — begin enrolment.
 *
 * Returns the `otpauth://` URI once. The secret is stored encrypted with
 * `mfa_enabled_at` left null, so sign-in does not start demanding a code from
 * an authenticator the user has not yet proved they can read.
 */
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // Minting secrets is cheap but not free, and an unbounded loop here would
  // let one session churn the column indefinitely.
  const limited = rateLimited(request, "mfa-enrol", ctx.userId);
  if (limited) return limited;

  const row = await readMfaRow(ctx.orgId, ctx.userId);
  if (!row) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  // Re-enrolling while active would silently invalidate the authenticator the
  // user still relies on, and a failure partway through would leave them with
  // neither. Disable first, deliberately.
  if (!canBeginEnrolment(mfaState(row.mfaSecret, row.mfaEnabledAt))) {
    return NextResponse.json(
      { error: "Multi-factor authentication is already enabled. Disable it first to re-enrol." },
      { status: 409 }
    );
  }

  // The label an authenticator app shows beside the code. Cosmetic, but it is
  // what distinguishes two Circuvent entries in a list, so fall back to the
  // user id rather than refusing to enrol over a missing claim.
  const enrolment = createTotpEnrolment(ctx.email ?? ctx.userId);

  await withTenant({ orgId: ctx.orgId }, async (tx) => {
    await tx
      .update(users)
      .set({
        mfaSecret: encryptField(enrolment.secret),
        mfaEnabledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, ctx.userId));
  });

  // The secret appears only inside the URI and the manual key, which the user
  // needs in order to enrol at all. It is never readable again afterwards —
  // no route returns it.
  return NextResponse.json({
    uri: enrolment.uri,
    manualEntryKey: enrolment.manualEntryKey,
  });
}

/**
 * DELETE /api/auth/mfa — turn the second factor off.
 *
 * Requires the password *and* a current code. A session cookie alone is not
 * enough: the whole point of MFA is that a stolen session cannot remove it.
 */
export async function DELETE(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limited = rateLimited(request, "mfa-disable", ctx.userId);
  if (limited) return limited;

  const parsed = disableSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }

  const row = await readMfaRow(ctx.orgId, ctx.userId);
  if (!row) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  if (!row.mfaSecret || !canDisable(mfaState(row.mfaSecret, row.mfaEnabledAt))) {
    return NextResponse.json(
      { error: "Multi-factor authentication is not enabled" },
      { status: 409 }
    );
  }

  const passwordOk =
    !!row.passwordHash && (await verifyPassword(parsed.data.password, row.passwordHash));
  const codeOk = verifyTotp(decryptField(row.mfaSecret), parsed.data.code);

  // One message for either failure, so this cannot be used to test passwords
  // against a known-good code or the reverse.
  if (!passwordOk || !codeOk) {
    return NextResponse.json({ error: "Password or code is incorrect" }, { status: 401 });
  }

  await withTenant({ orgId: ctx.orgId }, async (tx) => {
    await tx
      .update(users)
      .set({
        mfaSecret: null,
        mfaEnabledAt: null,
        // Recovery codes belong to the secret they were issued alongside;
        // leaving them behind would let an old code open a new enrolment.
        mfaBackupCodes: [],
        updatedAt: new Date(),
      })
      .where(eq(users.id, ctx.userId));
  });

  return NextResponse.json({ enabled: false });
}
