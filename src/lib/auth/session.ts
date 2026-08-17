// ═══════════════════════════════════════════════════════════════
// SESSION SERVICE — sign-in, refresh, revoke
// ═══════════════════════════════════════════════════════════════
// Ties the primitives in password.ts, tokens.ts and mfa.ts to the
// identity schema. This is the module that decides who gets in.
//
// Two properties drive most of the design:
//
//  1. Sign-in happens before the tenant is known. The caller supplies only an
//     email, and the organization is the *result* of the lookup, so the
//     credential check must run outside row-level security. That is the one
//     place `superuser: true` is legitimate, and it reads from
//     identity.login_lookup, a view exposing only the columns the check needs.
//
//  2. Refresh tokens are single-use. Re-presenting one means it was stolen or
//     replayed, so the entire session family is revoked rather than just
//     refusing that request.

import { and, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { sessions, users } from "@/db/schema/identity";
import {
  fakeVerify,
  generateToken,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password";
import { consumeBackupCode, verifyTotp } from "./mfa";
import { mfaRequiredAtSignIn } from "./mfa-enrolment";
import { decryptField } from "@/lib/crypto/field-encryption";
import {
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
  type AppId,
} from "./tokens";
import { strongestRole } from "./role-rank";

/** Failed attempts before the account is temporarily locked. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export type SignInFailure =
  | "invalid_credentials"
  | "account_locked"
  | "account_inactive"
  | "mfa_required"
  | "mfa_invalid"
  | "password_reset_required";

export interface SignInRequest {
  email: string;
  password: string;
  /** Present on the second leg of an MFA challenge. */
  totpCode?: string;
  backupCode?: string;
  app?: AppId;
  ipAddress?: string;
  userAgent?: string;
  deviceName?: string;
}

export interface SignInSuccess {
  ok: true;
  accessToken: string;
  refreshToken: string;
  user: { id: string; orgId: string; email: string; displayName: string; role: string };
}

export interface SignInRejected {
  ok: false;
  reason: SignInFailure;
  /** Seconds until a locked account can try again. */
  retryAfterSeconds?: number;
}

export type SignInResult = SignInSuccess | SignInRejected;

interface LoginRow {
  id: string;
  org_id: string;
  email: string;
  password_hash: string | null;
  status: string;
  mfa_secret: string | null;
  /**
   * Null while an enrolment is still pending.
   *
   * A secret exists from the moment someone scans the QR code, but it must be
   * proved with a live code before it is enforced. Keying enforcement off
   * `mfa_secret` alone would demand a second factor from anyone who started
   * enrolment and stopped — and the recovery path for that is an administrator
   * disabling MFA out of band, which is itself an attack path.
   */
  mfa_enabled_at: Date | null;
  failed_login_attempts: number;
  locked_until: Date | null;
  must_reset_password: boolean;
  display_name: string;
}

/**
 * Resolves credentials to a user without a tenant context.
 *
 * Runs as superuser because no organization is known yet; the view restricts
 * what that grants to the columns below.
 */
async function findLoginRow(email: string): Promise<LoginRow | null> {
  return withTenant({ orgId: "", superuser: true }, async (tx) => {
    const result = await tx.execute(
      sql`SELECT id, org_id, email, password_hash, status, mfa_secret, mfa_enabled_at,
                 failed_login_attempts, locked_until, must_reset_password, display_name
          FROM identity.login_lookup
          WHERE lower(email) = lower(${email})
          LIMIT 1`
    );
    return (result.rows[0] as unknown as LoginRow | undefined) ?? null;
  });
}

async function recordFailure(userId: string, orgId: string, attempts: number): Promise<void> {
  const next = attempts + 1;
  // Lock only on reaching the threshold, so the lock window does not extend on
  // every further attempt — otherwise an attacker can keep a real user locked
  // out indefinitely.
  const lockedUntil =
    next >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;

  await withTenant({ orgId, superuser: true }, async (tx) => {
    await tx
      .update(users)
      .set({ failedLoginAttempts: next, lockedUntil, updatedAt: new Date() })
      .where(eq(users.id, userId));
  });
}

async function clearFailures(userId: string, orgId: string, rehash?: string): Promise<void> {
  await withTenant({ orgId, superuser: true }, async (tx) => {
    await tx
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        ...(rehash ? { passwordHash: rehash } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  });
}

async function roleFor(userId: string, orgId: string, app: AppId): Promise<string> {
  return withTenant({ orgId }, async (tx) => {
    const rows = await tx.execute(
      sql`SELECT role FROM identity.user_roles
          WHERE user_id = ${userId} AND app = ${app}::identity.app
          LIMIT 1`
    );
    // No explicit grant means the lowest privilege, never the highest.
    return ((rows.rows[0] as { role?: string } | undefined)?.role) ?? "employee";
  });
}

export async function signIn(request: SignInRequest): Promise<SignInResult> {
  const app: AppId = request.app ?? "hrms";
  const row = await findLoginRow(request.email);

  if (!row || !row.password_hash) {
    // Hash against a dummy so an unknown address takes the same time as a real
    // one; skipping the work here is what makes login an enumeration oracle.
    await fakeVerify(request.password);
    return { ok: false, reason: "invalid_credentials" };
  }

  if (row.locked_until && row.locked_until.getTime() > Date.now()) {
    return {
      ok: false,
      reason: "account_locked",
      retryAfterSeconds: Math.ceil((row.locked_until.getTime() - Date.now()) / 1000),
    };
  }

  const passwordOk = await verifyPassword(request.password, row.password_hash);
  if (!passwordOk) {
    await recordFailure(row.id, row.org_id, row.failed_login_attempts);
    return { ok: false, reason: "invalid_credentials" };
  }

  if (row.status !== "active") {
    return { ok: false, reason: "account_inactive" };
  }

  // Checked after the password so a suspended or imported account is not
  // revealed to someone who does not know the credentials.
  if (row.must_reset_password) {
    return { ok: false, reason: "password_reset_required" };
  }

  const mfaActive = mfaRequiredAtSignIn(row.mfa_secret, row.mfa_enabled_at);
  let mfaSatisfied = !mfaActive;

  if (mfaActive) {
    if (request.totpCode) {
      // Stored encrypted; `decryptField` passes through rows written before
      // encryption existed, so this works either side of the backfill.
      mfaSatisfied = verifyTotp(decryptField(row.mfa_secret!), request.totpCode);
    } else if (request.backupCode) {
      mfaSatisfied = await consumeStoredBackupCode(row.id, row.org_id, request.backupCode);
    } else {
      return { ok: false, reason: "mfa_required" };
    }

    if (!mfaSatisfied) {
      // A wrong second factor counts toward lockout too, or MFA becomes a
      // rate-limit-free brute-force surface once a password leaks.
      await recordFailure(row.id, row.org_id, row.failed_login_attempts);
      return { ok: false, reason: "mfa_invalid" };
    }
  }

  const rehash = needsRehash(row.password_hash)
    ? await hashPassword(request.password)
    : undefined;
  await clearFailures(row.id, row.org_id, rehash);

  const role = await roleFor(row.id, row.org_id, app);
  const { accessToken, refreshToken } = await issueSession({
    userId: row.id,
    orgId: row.org_id,
    email: row.email,
    role,
    app,
    mfaVerified: mfaActive,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
    deviceName: request.deviceName,
  });

  return {
    ok: true,
    accessToken,
    refreshToken,
    user: {
      id: row.id,
      orgId: row.org_id,
      email: row.email,
      displayName: row.display_name,
      role,
    },
  };
}

/**
 * Signs in an identity that auth.circuvent.com has already authenticated.
 *
 * Two policies are deliberate here.
 *
 * It does not provision. HRMS is the system of record for who works here, so
 * an address the directory has never seen is refused rather than quietly given
 * an employee record -- joining is an HR action, not a side effect of clicking
 * a sign-in button.
 *
 * It refuses accounts that have enabled multi-factor authentication. The
 * identity provider does not yet assert a second factor, so accepting the
 * handshake for those accounts would turn the SSO button into a way around the
 * very control the person opted into. Once the provider asserts `amr`, this
 * check becomes a comparison rather than a refusal.
 */
export async function signInWithSso(request: {
  email: string;
  app?: AppId;
  ipAddress?: string;
  userAgent?: string;
  deviceName?: string;
  /**
   * The role the identity service asserts for this application.
   *
   * Groups in auth.circuvent.com grant roles across the suite, and this is how
   * that reaches HRMS — and, because ATS delegates its whole handshake here,
   * how it reaches ATS too. Only ever passed from a verified id_token; a role
   * read from anywhere a caller controls would be a way to choose your own.
   */
  ssoRole?: string | null;
}): Promise<SignInResult> {
  const app: AppId = request.app ?? "hrms";
  const row = await findLoginRow(request.email);

  if (!row) return { ok: false, reason: "invalid_credentials" };
  if (row.status !== "active") return { ok: false, reason: "account_inactive" };
  if (row.must_reset_password) return { ok: false, reason: "password_reset_required" };
  // A pending enrolment is not an enabled second factor, so it must not block
  // SSO — otherwise abandoning enrolment halfway locks the account out of the
  // one sign-in path that never needed a code.
  if (mfaRequiredAtSignIn(row.mfa_secret, row.mfa_enabled_at)) {
    return { ok: false, reason: "mfa_required" };
  }

  if (row.locked_until && row.locked_until.getTime() > Date.now()) {
    return {
      ok: false,
      reason: "account_locked",
      retryAfterSeconds: Math.ceil((row.locked_until.getTime() - Date.now()) / 1000),
    };
  }

  await clearFailures(row.id, row.org_id);

  /*
   * The stronger of what HRMS grants and what the identity service asserts.
   *
   * Not simply the token's role: a local grant is a decision somebody made
   * here, and letting a group silently demote an HRMS administrator would be a
   * loss of access nobody asked for. Not simply the local role either, or
   * group-based access would never reach this application at all.
   */
  const role = strongestRole(await roleFor(row.id, row.org_id, app), request.ssoRole);
  const { accessToken, refreshToken } = await issueSession({
    userId: row.id,
    orgId: row.org_id,
    email: row.email,
    role,
    app,
    mfaVerified: false,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
    deviceName: request.deviceName,
  });

  return {
    ok: true,
    accessToken,
    refreshToken,
    user: {
      id: row.id,
      orgId: row.org_id,
      email: row.email,
      displayName: row.display_name,
      role,
    },
  };
}

async function consumeStoredBackupCode(
  userId: string,
  orgId: string,
  code: string
): Promise<boolean> {
  return withTenant({ orgId, superuser: true }, async (tx) => {
    const rows = await tx
      .select({ codes: users.mfaBackupCodes })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const stored = (rows[0]?.codes as string[] | undefined) ?? [];
    const remaining = consumeBackupCode(code, stored);
    if (!remaining) return false;

    // Persisted immediately: a recovery code that still works after use is not
    // single-use.
    await tx.update(users).set({ mfaBackupCodes: remaining }).where(eq(users.id, userId));
    return true;
  });
}

// ─── Session issue / rotate / revoke ─────────────────────────

interface IssueParams {
  userId: string;
  orgId: string;
  email: string;
  role: string;
  app: AppId;
  mfaVerified: boolean;
  ipAddress?: string;
  userAgent?: string;
  deviceName?: string;
}

async function issueSession(
  params: IssueParams
): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
  const refreshToken = generateToken();

  const sessionId = await withTenant({ orgId: params.orgId, superuser: true }, async (tx) => {
    const [row] = await tx
      .insert(sessions)
      .values({
        userId: params.userId,
        orgId: params.orgId,
        refreshTokenHash: hashRefreshToken(refreshToken),
        app: params.app,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        deviceName: params.deviceName,
        mfaVerifiedAt: params.mfaVerified ? new Date() : null,
        expiresAt: refreshTokenExpiry(),
      })
      .returning({ id: sessions.id });
    return row.id;
  });

  const accessToken = await signAccessToken({
    sub: params.userId,
    org: params.orgId,
    role: params.role,
    email: params.email,
    sid: sessionId,
    mfa: params.mfaVerified,
  });

  return { accessToken, refreshToken, sessionId };
}

export type RefreshResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; reason: "invalid" | "expired" | "revoked" | "reused" };

/**
 * Exchanges a refresh token for a new pair, rotating the old one.
 *
 * If the presented token has already been rotated, it is a replay: either the
 * legitimate client retried after its rotation was lost, or someone stole it.
 * The two are indistinguishable, so every session in the family is revoked and
 * the user signs in again. Refusing only that one request would leave a
 * thief's session alive.
 */
export async function refreshSession(refreshToken: string): Promise<RefreshResult> {
  if (!refreshToken) return { ok: false, reason: "invalid" };
  const tokenHash = hashRefreshToken(refreshToken);

  const found = await withTenant({ orgId: "", superuser: true }, async (tx) => {
    const rows = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, tokenHash))
      .limit(1);
    return rows[0] ?? null;
  });

  if (!found) return { ok: false, reason: "invalid" };

  if (found.rotatedToId) {
    await revokeUserSessions(found.userId, found.orgId);
    return { ok: false, reason: "reused" };
  }
  if (found.revokedAt) return { ok: false, reason: "revoked" };
  if (found.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const profile = await withTenant({ orgId: found.orgId, superuser: true }, async (tx) => {
    const rows = await tx
      .select({ email: users.email, status: users.status })
      .from(users)
      .where(and(eq(users.id, found.userId), isNull(users.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  });

  // A user deactivated mid-session must not be able to refresh their way back
  // in; the access token expires within 15 minutes and this is the gate.
  if (!profile || profile.status !== "active") {
    await revokeUserSessions(found.userId, found.orgId);
    return { ok: false, reason: "revoked" };
  }

  const app = (found.app ?? "hrms") as AppId;
  const role = await roleFor(found.userId, found.orgId, app);

  const issued = await issueSession({
    userId: found.userId,
    orgId: found.orgId,
    email: profile.email,
    role,
    app,
    mfaVerified: !!found.mfaVerifiedAt,
    ipAddress: found.ipAddress ?? undefined,
    userAgent: found.userAgent ?? undefined,
    deviceName: found.deviceName ?? undefined,
  });

  await withTenant({ orgId: found.orgId, superuser: true }, async (tx) => {
    await tx
      .update(sessions)
      .set({ rotatedToId: issued.sessionId, revokedAt: new Date(), lastUsedAt: new Date() })
      .where(eq(sessions.id, found.id));
  });

  return { ok: true, accessToken: issued.accessToken, refreshToken: issued.refreshToken };
}

export async function revokeSession(refreshToken: string): Promise<void> {
  if (!refreshToken) return;
  await withTenant({ orgId: "", superuser: true }, async (tx) => {
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.refreshTokenHash, hashRefreshToken(refreshToken)));
  });
}

/** Signs the user out everywhere. Used on password change and replay detection. */
export async function revokeUserSessions(userId: string, orgId: string): Promise<void> {
  await withTenant({ orgId, superuser: true }, async (tx) => {
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  });
}
