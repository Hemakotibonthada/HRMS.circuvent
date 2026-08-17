// ═══════════════════════════════════════════════════════════════
// POST /api/auth/mfa/confirm
// ═══════════════════════════════════════════════════════════════
// Completes enrolment by proving the authenticator works, then activates the
// second factor and issues recovery codes.
//
// The proof matters. Activating on the strength of "we generated a secret and
// showed you a QR code" enables MFA for people who never successfully scanned
// it, and the only way out of that is an administrator disabling it out of
// band — which is itself an attack path, and one worth not manufacturing.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema/identity";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { generateBackupCodes, hashBackupCode, verifyTotp } from "@/lib/auth/mfa";
import { decryptField } from "@/lib/crypto/field-encryption";
import { canConfirmEnrolment, mfaState } from "@/lib/auth/mfa-enrolment";

const schema = z.object({
  code: z.string().min(1, "An authenticator code is required"),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // A six-digit code is 10^6 possibilities across a 90-second window. Without
  // a limit here, confirmation is a brute-force surface that bypasses the
  // sign-in lockout entirely.
  const limit = checkRateLimit(`mfa-confirm:${clientIdentifier(request, ctx.userId)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }

  const row = await withTenant({ orgId: ctx.orgId }, async (tx) => {
    const rows = await tx
      .select({ mfaSecret: users.mfaSecret, mfaEnabledAt: users.mfaEnabledAt })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    return rows[0] ?? null;
  });

  if (!row) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const state = mfaState(row.mfaSecret, row.mfaEnabledAt);

  if (state === "off") {
    return NextResponse.json(
      { error: "Start enrolment before confirming it" },
      { status: 409 }
    );
  }

  if (!canConfirmEnrolment(state)) {
    return NextResponse.json(
      { error: "Multi-factor authentication is already enabled" },
      { status: 409 }
    );
  }

  if (!verifyTotp(decryptField(row.mfaSecret!), parsed.data.code)) {
    return NextResponse.json({ error: "That code is not valid" }, { status: 401 });
  }

  // Issued at activation rather than at enrolment start, so codes are never
  // handed out for a secret that turns out not to work.
  const backupCodes = generateBackupCodes();

  await withTenant({ orgId: ctx.orgId }, async (tx) => {
    await tx
      .update(users)
      .set({
        mfaEnabledAt: new Date(),
        mfaBackupCodes: backupCodes.map(hashBackupCode),
        updatedAt: new Date(),
      })
      .where(eq(users.id, ctx.userId));
  });

  // The only time the plaintext codes exist outside the user's hands. They are
  // stored hashed, so this response cannot be reproduced.
  return NextResponse.json({ enabled: true, backupCodes });
}
