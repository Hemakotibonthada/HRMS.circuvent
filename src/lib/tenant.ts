// ═══════════════════════════════════════════════════════════════
// TENANT CONTEXT — multi-tenant scoping for all Firestore access
// ═══════════════════════════════════════════════════════════════
// HRMS is sold as a multi-tenant SaaS, but every query previously read whole
// top-level collections with no organization filter, so any signed-in user
// received every other company's employees, payroll and leave records.
//
// Firestore evaluates security rules against the *query*, not the result set:
// a rule requiring `organizationId == <caller's org>` only permits a list read
// if the query itself carries that same equality filter. This module supplies
// that filter so `firestore.rules` can enforce isolation without breaking
// listing.

import { doc, getDoc, where, type QueryConstraint } from "@/lib/firebase";
import { db } from "@/lib/firebase";

export const TENANT_FIELD = "organizationId";

let currentOrgId: string | null = null;
const listeners = new Set<(orgId: string | null) => void>();

/** Organization id of the signed-in user, or null before it has resolved. */
export function getOrgId(): string | null {
  return currentOrgId;
}

export function setOrgId(orgId: string | null): void {
  if (currentOrgId === orgId) return;
  currentOrgId = orgId;
  listeners.forEach((fn) => fn(orgId));
}

export function onOrgIdChange(fn: (orgId: string | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Read the caller's organization from their user profile document. */
export async function loadOrgIdForUser(uid: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const orgId = snap.exists()
      ? ((snap.data()?.[TENANT_FIELD] as string | undefined) ?? null)
      : null;
    setOrgId(orgId);
    return orgId;
  } catch (error) {
    console.error("Failed to resolve organization for user:", error);
    setOrgId(null);
    return null;
  }
}

export function clearOrgId(): void {
  setOrgId(null);
}

/**
 * Equality constraint pinning a query to the caller's organization.
 * Returns an empty array when the org is not yet known, so callers can decide
 * whether to defer the query rather than silently reading across tenants.
 */
export function orgConstraint(): QueryConstraint[] {
  return currentOrgId ? [where(TENANT_FIELD, "==", currentOrgId)] : [];
}

/** True once the tenant is known and it is safe to issue scoped queries. */
export function isTenantReady(): boolean {
  return currentOrgId !== null;
}

/** Stamp the tenant field onto a document being written. */
export function withOrgId<T extends Record<string, unknown>>(
  data: T
): T & Record<string, unknown> {
  if (!currentOrgId || TENANT_FIELD in data) return data;
  return { ...data, [TENANT_FIELD]: currentOrgId };
}

/**
 * Collections that are genuinely global (not per-organization) and must not
 * receive a tenant filter.
 */
export const GLOBAL_COLLECTIONS = new Set<string>([
  "users",
  "organizations",
  "subscriptions",
]);

export function isTenantScoped(collectionName: string): boolean {
  return !GLOBAL_COLLECTIONS.has(collectionName);
}
