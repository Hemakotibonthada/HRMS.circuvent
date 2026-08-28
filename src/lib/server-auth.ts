// ═══════════════════════════════════════════════════════════════
// SERVER AUTH — suite session verification for API routes
// ═══════════════════════════════════════════════════════════════
// Authentication is the signed suite JWT issued by /api/auth/login, carried
// either in the cv_access cookie (browser) or as a bearer token (mobile, and
// any server-to-server caller acting for a user).
//
// Firebase is gone from this module. It verified ID tokens that nothing issues
// any more, and required Admin credentials to be present before a request could
// be authenticated at all — which meant a deployment without Firebase
// configuration could not authenticate anybody, exactly the state this app was
// found in. The suite token already carries the user id, organisation and role,
// so a second identity provider had nothing left to contribute.
//
// The shape of the decoded value is kept compatible with what callers already
// destructure, so the routes using this did not have to change.

import { timingSafeEqual } from "node:crypto";
import { verifyAccessToken } from "@/lib/auth/tokens";

/** What a verified caller looks like to a route handler. */
export interface VerifiedCaller {
  uid: string;
  email?: string;
  /** Organisation the caller belongs to. Never taken from the request body. */
  organizationId: string;
  role: string;
  /** Session id, so a route can tie an action back to a specific sign-in. */
  sid: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number = 401
  ) {
    super(message);
    this.name = "AuthError";
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim() || null;
}

/** The suite session cookie, for same-origin callers that send no header. */
function extractSessionCookie(req: Request): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)cv_access=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Verifies the caller's credential.
 *
 * Bearer is read before the cookie: a native client presenting a token should
 * be judged on it, not on a cookie that happened to ride along.
 */
export async function verifyRequest(req: Request): Promise<VerifiedCaller> {
  const token = extractBearerToken(req) ?? extractSessionCookie(req);
  if (!token) throw new AuthError("Not signed in");

  const claims = await verifyAccessToken(token);
  if (!claims) throw new AuthError("Invalid or expired token");

  return {
    uid: claims.sub,
    email: claims.email,
    organizationId: claims.org,
    role: claims.role,
    sid: claims.sid,
  };
}

/**
 * Verifies the caller holds one of the given roles.
 *
 * The role in the token is authoritative. The previous implementation fell back
 * to a Firestore lookup when the claim did not match, which turned a clean
 * "insufficient permissions" into a 500 whenever Admin credentials were absent.
 */
export async function requireRole(
  req: Request,
  roles: string[]
): Promise<VerifiedCaller> {
  const caller = await verifyRequest(req);
  // owner is the account that created the organisation and is above every
  // per-app role, so it is never locked out of its own data.
  if (caller.role !== "owner" && !roles.includes(caller.role)) {
    throw new AuthError("Insufficient permissions", 403);
  }
  return caller;
}

/**
 * Shared-secret gate for machine-to-machine callers — cross-app sync jobs that
 * act for no particular user. Fails closed when the secret is unset.
 */
export function requireServiceToken(req: Request): void {
  const expected = process.env.CROSS_APP_SYNC_TOKEN;
  if (!expected) {
    throw new AuthError("CROSS_APP_SYNC_TOKEN is not configured", 403);
  }
  const provided = req.headers.get("x-service-token") || extractBearerToken(req) || "";

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Compared in constant time, but only once the lengths match: timingSafeEqual
  // throws on a mismatch rather than returning false.
  if (a.length !== b.length) throw new AuthError("Invalid service token", 403);
  if (!timingSafeEqual(a, b)) throw new AuthError("Invalid service token", 403);
}

/** Accepts either a signed-in user or a valid service token. */
export async function requireUserOrService(req: Request): Promise<void> {
  try {
    requireServiceToken(req);
    return;
  } catch {
    await verifyRequest(req);
  }
}

/** Map an AuthError (or anything else) to a JSON error response body. */
export function authErrorResponse(e: unknown): { body: { error: string }; status: number } {
  const err = e as { status?: number; message?: string };
  return {
    body: { error: err.message ?? "Unauthorized" },
    status: err.status ?? 401,
  };
}
