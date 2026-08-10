// ═══════════════════════════════════════════════════════════════
// API REQUEST CONTEXT
// ═══════════════════════════════════════════════════════════════
// Resolves who is calling and which organization they belong to, for every API
// route.
//
// The organization is derived from the verified token, never from the request
// body or a query parameter. This is the single most important rule in the
// file: the Firestore design let the browser choose its own organization
// filter and relied on security rules to catch a lie, whereas here the client
// has no way to express the choice at all.

import type { NextRequest } from "next/server";
import { AuthError, adminDb, requireRole, verifyRequest } from "@/lib/server-auth";
import { ACCESS_COOKIE, verifyAccessToken } from "@/lib/auth/tokens";
import type { TenantContext } from "@/db/client";

export type ApiRole = "owner" | "admin" | "hr" | "manager" | "employee";

export interface ApiContext extends TenantContext {
  orgId: string;
  userId: string;
  email?: string;
  role: ApiRole;
}

const HRMS_DATABASE = "hrms-circuvent";

const ROLES: ApiRole[] = ["owner", "admin", "hr", "manager", "employee"];

function asRole(value: unknown): ApiRole | null {
  return typeof value === "string" && (ROLES as string[]).includes(value)
    ? (value as ApiRole)
    : null;
}

/**
 * The suite session token, from either transport.
 *
 * The browser holds it in the `cv_access` cookie. Native apps have no usable
 * cookie jar, so they send the same token as a bearer credential. Both are the
 * same signed JWT verified the same way, so accepting both costs nothing in
 * trust.
 *
 * Bearer is read first: a native caller that presents one should be judged on
 * it rather than on a cookie that happened to ride along with the request.
 */
async function sessionContext(request: NextRequest): Promise<ApiContext | null> {
  const authorization = request.headers.get("authorization");
  const bearer =
    authorization && /^Bearer /i.test(authorization) ? authorization.slice(7).trim() : null;
  const token = bearer || request.cookies.get(ACCESS_COOKIE)?.value || null;
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  const role = asRole(claims.role);
  // An unrecognised role must not be treated as a valid identity: it would
  // then fail every allowedRoles check silently rather than being refused.
  if (!role) return null;

  return { orgId: claims.org, userId: claims.sub, email: claims.email, role };
}

/**
 * Resolves the caller's organization and role.
 *
 * The organization is derived from the verified token, never from the request
 * body or a query parameter. This is the single most important rule in the
 * file: the Firestore design let the browser choose its own organization
 * filter and relied on security rules to catch a lie, whereas here the client
 * has no way to express the choice at all.
 *
 * Two credentials are accepted, in order:
 *
 *  1. The suite session JWT (cookie or bearer). It already carries org, role
 *     and sid, so this path needs no database round trip at all.
 *  2. A Firebase ID token, kept for existing integrations that still mint one.
 *
 * The session path had to be added: `/api/auth/login` issues suite tokens and
 * the middleware verifies them, but this function only ever accepted Firebase
 * tokens — so the web app could sign in and then not call its own API, and
 * mobile had no way in at all.
 */
export async function requireApiContext(
  request: NextRequest,
  allowedRoles?: ApiRole[]
): Promise<ApiContext> {
  const session = await sessionContext(request);
  if (session) {
    if (allowedRoles && !allowedRoles.includes(session.role)) {
      throw new AuthError("Insufficient permissions", 403);
    }
    return session;
  }

  const decoded = allowedRoles
    ? await requireRole(request, allowedRoles)
    : await verifyRequest(request);

  const claimOrg = typeof decoded.organizationId === "string" ? decoded.organizationId : null;
  const claimRole = typeof decoded.role === "string" ? (decoded.role as ApiRole) : null;

  if (claimOrg && claimRole) {
    return { orgId: claimOrg, userId: decoded.uid, email: decoded.email, role: claimRole };
  }

  const snap = await adminDb(HRMS_DATABASE).collection("users").doc(decoded.uid).get();
  if (!snap.exists) {
    throw new AuthError("No user profile found for this account", 403);
  }

  const orgId = snap.get("organizationId") as string | undefined;
  const role = (snap.get("role") as ApiRole | undefined) ?? "employee";

  if (!orgId) {
    // Without an organization every query would be unscoped. Refuse rather
    // than fall back to reading everything.
    throw new AuthError("Account is not attached to an organization", 403);
  }

  return { orgId, userId: decoded.uid, email: decoded.email, role };
}

// ─── Rate limiting ───────────────────────────────────────────

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Fixed-window limiter.
 *
 * In-memory, so each serverless instance keeps its own counter and the real
 * ceiling is roughly limit × instances. That is a deliberate interim step: it
 * closes the "no rate limiting at all" gap from the April audit today, and the
 * call sites do not change when this is swapped for Upstash Redis (Phase 1.4.3).
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    const fresh = { count: 1, resetAt: now + windowMs };
    buckets.set(key, fresh);
    // Opportunistic sweep: without it the map grows once per unique caller and
    // never shrinks, which is a slow memory leak on a long-lived instance.
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }
    return { allowed: true, remaining: limit - 1, resetAt: fresh.resetAt };
  }

  bucket.count += 1;
  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

export function clientIdentifier(request: NextRequest, userId?: string): string {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return `ip:${ip}`;
}
