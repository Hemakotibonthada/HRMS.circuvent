// ═══════════════════════════════════════════════════════════════
// POST /api/auth/reset-password
// ═══════════════════════════════════════════════════════════════
// Consumes a reset token and sets a new password.
//
// Every existing session is revoked afterwards. Whoever asked for the reset may
// well be doing so because someone else has access, and leaving those sessions
// alive would let the intruder keep it.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { db } from "@/db/client";
import { authTokens, users } from "@/db/schema/identity";
import { hashPassword } from "@/lib/auth/password";
import { revokeUserSessions } from "@/lib/auth/session";
import { checkRateLimit, clientIdentifier } from "@/lib/api-context";

const schema = z.object({
  token: z.string().trim().min(20),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

export async function POST(request: NextRequest) {
  const limit = checkRateLimit(`reset:${clientIdentifier(request)}`, 20, 60 * 60_000);
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
  const { token, password } = parsed.data;

  const tokenHash = bytesToHex(sha256(new TextEncoder().encode(token)));

  try {
    const rows = await db()
      .select({
        id: authTokens.id,
        userId: authTokens.userId,
        orgId: authTokens.orgId,
      })
      .from(authTokens)
      .where(
        and(
          eq(authTokens.tokenHash, tokenHash),
          eq(authTokens.purpose, "password_reset"),
          isNull(authTokens.consumedAt),
          gt(authTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    const record = rows[0];
    if (!record?.userId) {
      // One message for expired, already-used and never-existed. Telling them
      // apart only helps someone testing tokens.
      return NextResponse.json(
        { error: "This reset link is invalid or has expired. Please request a new one." },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(password);

    await db().transaction(async (tx) => {
      await tx.execute(`SET LOCAL app.superuser = 'on'`);

      // Marked consumed in the same transaction as the password change, so a
      // failure cannot leave the token spent but the password unchanged.
      await tx
        .update(authTokens)
        .set({ consumedAt: new Date() })
        .where(eq(authTokens.id, record.id));

      await tx
        .update(users)
        .set({
          passwordHash,
          mustResetPassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, record.userId!));
    });

    if (record.orgId) {
      await revokeUserSessions(record.userId, record.orgId).catch((e) => {
        // The password is already changed; failing to revoke must not report
        // the reset as unsuccessful, but it does need to be visible.
        console.error("Failed to revoke sessions after password reset:", e);
      });
    }

    return NextResponse.json({
      ok: true,
      message: "Your password has been changed. Please sign in.",
    });
  } catch (error) {
    console.error("Password reset failed:", error);
    return NextResponse.json(
      { error: "Could not reset your password. Please try again." },
      { status: 500 }
    );
  }
}
