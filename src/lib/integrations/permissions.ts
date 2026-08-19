// ═══════════════════════════════════════════════════════════════
// WHO MAY MANAGE INTEGRATIONS
// ═══════════════════════════════════════════════════════════════
// One helper rather than a role comparison at each route, because these
// endpoints let a caller point the *server* at a URL of their choosing. A
// route that forgot the check would not fail visibly — it would work, which is
// the problem.
//
// `ApiContext.role` and the RBAC `Role` union are not the same set: the API
// knows about "owner" and the permission model does not, because an owner
// outranks every application role. The client hook resolves that the same way
// (src/hooks/use-rbac.ts), and the two must agree or the screen will offer a
// control the API then refuses.

import { hasPermission, type Role } from "@/lib/rbac";
import type { ApiRole } from "@/lib/api-context";

/** Maps the API's role onto the permission model's. */
export function toRbacRole(role: ApiRole): Role {
  return role === "owner" ? "admin" : role;
}

export function canManageIntegrations(role: ApiRole): boolean {
  return hasPermission(toRbacRole(role), "settings.manage");
}
