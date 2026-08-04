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
import type { TenantContext } from "@/db/client";

export type ApiRole = "owner" | "admin" | "hr" | "manager" | "employee";

export interface ApiContext extends TenantContext {
  orgId: string;
  userId: string;
  email?: string;
  role: ApiRole;
}

const HRMS_DATABASE = "hrms-circuvent";

/**
 * Resolves the caller's organization and role.
 *
 * While DATA_BACKEND is firestore or dual, this reads the profile from
 * Firestore. Once the identity service lands (Phase 1.3) org_id and role are
 * claims on the JWT and this becomes a pure token read with no database call.
 */
export async function requireApiContext(
  request: NextRequest,
  allowedRoles?: ApiRole[]
): Promise<ApiContext> {
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
