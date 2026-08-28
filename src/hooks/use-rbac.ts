"use client";

import { useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  type Role,
  type Permission,
  hasPermission,
  hasAnyPermission,
  canAccessModule,
} from "@/lib/rbac";

export interface RBACContext {
  role: Role;
  roleLoading: boolean;
  can: (permission: Permission) => boolean;
  canAny: (permissions: Permission[]) => boolean;
  canAccessModule: (moduleId: string) => boolean;
  isAdmin: boolean;
  isHR: boolean;
  isManager: boolean;
  isEmployee: boolean;
}

const KNOWN: Role[] = ["admin", "hr", "manager", "employee"];

/**
 * RBAC for the current user, taken from the session.
 *
 * The role is a claim on the signed session token, so it needs no lookup and
 * cannot disagree with what the API will enforce on the same request.
 *
 * The previous implementation read a Firestore `users/{uid}` document and, when
 * that document was missing, guessed from the email address — anyone whose
 * address merely contained "admin" was treated as an administrator by the whole
 * dashboard. Server routes never honoured that guess, so the UI offered actions
 * the API then refused; worse, it was a real privilege inference from a string
 * a user can often choose.
 *
 * This is still only a UI concern. Every route re-checks the role server-side,
 * because a client can always claim anything.
 */
export function useRBAC(): RBACContext {
  const { user, loading } = useAuth();

  const role: Role = useMemo(() => {
    const claimed = user?.role;
    if (claimed === "owner") return "admin"; // owner outranks every app role
    return KNOWN.includes(claimed as Role) ? (claimed as Role) : "employee";
  }, [user?.role]);

  return useMemo(
    () => ({
      role,
      roleLoading: loading,
      can: (permission: Permission) => hasPermission(role, permission),
      canAny: (permissions: Permission[]) => hasAnyPermission(role, permissions),
      canAccessModule: (moduleId: string) => canAccessModule(role, moduleId),
      isAdmin: role === "admin",
      isHR: role === "hr",
      isManager: role === "manager",
      isEmployee: role === "employee",
    }),
    [role, loading]
  );
}
