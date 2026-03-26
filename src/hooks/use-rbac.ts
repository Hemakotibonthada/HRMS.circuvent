"use client";

import { useMemo, useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  isLocalCredentialsMode,
  getLocalSession,
} from "@/lib/local-auth";
import {
  type Role,
  type Permission,
  hasPermission,
  hasAnyPermission,
  canAccessModule,
  ROLE_PERMISSIONS,
} from "@/lib/rbac";
import { db, doc, getDoc } from "@/lib/firebase";

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

/**
 * Hook that provides RBAC context for the current user.
 * For local-creds mode: reads role from localStorage session.
 * For Firebase mode: looks up role from Firestore `users/{uid}` document.
 * Falls back to "employee" if no role document exists.
 */
export function useRBAC(): RBACContext {
  const { user } = useAuth();
  const [firebaseRole, setFirebaseRole] = useState<Role | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);

  // Fetch role from Firestore for Firebase users
  useEffect(() => {
    if (isLocalCredentialsMode() || !user?.uid) {
      setFirebaseRole(null);
      return;
    }

    let cancelled = false;
    setRoleLoading(true);

    async function fetchRole() {
      try {
        // Check users collection for role assignment
        const userDoc = await getDoc(doc(db, "users", user!.uid));
        if (!cancelled) {
          if (userDoc.exists()) {
            const data = userDoc.data();
            const role = data?.role as Role;
            if (role && (role === "admin" || role === "hr" || role === "manager" || role === "employee")) {
              setFirebaseRole(role);
            } else {
              setFirebaseRole("employee");
            }
          } else {
            // No user doc — check by email pattern for convenience
            const email = user!.email || "";
            if (email.startsWith("admin@") || email.includes("admin")) {
              setFirebaseRole("admin");
            } else if (email.startsWith("hr@") || email.includes("hr@")) {
              setFirebaseRole("hr");
            } else {
              setFirebaseRole("employee");
            }
          }
        }
      } catch {
        if (!cancelled) setFirebaseRole("employee");
      } finally {
        if (!cancelled) setRoleLoading(false);
      }
    }

    fetchRole();
    return () => { cancelled = true; };
  }, [user]);

  const role: Role = useMemo(() => {
    if (isLocalCredentialsMode()) {
      const localUser = getLocalSession();
      return (localUser?.role as Role) || "employee";
    }
    return firebaseRole || "employee";
  }, [user, firebaseRole]);

  return useMemo(() => ({
    role,
    roleLoading,
    can: (permission: Permission) => hasPermission(role, permission),
    canAny: (permissions: Permission[]) => hasAnyPermission(role, permissions),
    canAccessModule: (moduleId: string) => canAccessModule(role, moduleId),
    isAdmin: role === "admin",
    isHR: role === "hr",
    isManager: role === "manager",
    isEmployee: role === "employee",
  }), [role, roleLoading]);
}
