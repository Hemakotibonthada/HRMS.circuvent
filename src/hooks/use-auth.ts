"use client";

import { useEffect, useState } from "react";
import { auth, onAuthStateChanged, type User } from "@/lib/firebase";
import { clearOrgId, loadOrgIdForUser, setOrgId } from "@/lib/tenant";
import {
  isLocalCredentialsMode,
  getLocalSession,
  type LocalUser,
} from "@/lib/local-auth";

// Unified user type that works for both Firebase and local auth
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Tenant must resolve before any scoped Firestore query is issued, otherwise
  // the query carries no organizationId filter and security rules reject it.
  const [tenantReady, setTenantReady] = useState(false);

  useEffect(() => {
    // Local credentials mode — no Firebase needed
    if (isLocalCredentialsMode()) {
      const applyLocal = (localUser: LocalUser | null) => {
        if (localUser) {
          setUser({
            uid: localUser.uid,
            email: localUser.email,
            displayName: localUser.displayName,
          });
          setOrgId(localUser.organizationId ?? "local-dev-org");
        } else {
          setUser(null);
          clearOrgId();
        }
        setTenantReady(true);
      };

      applyLocal(getLocalSession());
      // Session state lives in browser storage, which does not exist during
      // server render, so it can only be read after mount. There is nothing to
      // derive this from during render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);

      // Listen for storage changes (login/logout in another tab)
      const handler = () => applyLocal(getLocalSession());
      window.addEventListener("storage", handler);
      // Also listen for custom event from login page
      window.addEventListener("local-auth-change", handler);
      return () => {
        window.removeEventListener("storage", handler);
        window.removeEventListener("local-auth-change", handler);
      };
    }

    // Firebase mode
    try {
      const unsubscribe = onAuthStateChanged(
        auth,
        (firebaseUser) => {
          if (firebaseUser) {
            setUser({
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
            });
            setTenantReady(false);
            void loadOrgIdForUser(firebaseUser.uid).finally(() =>
              setTenantReady(true)
            );
          } else {
            setUser(null);
            clearOrgId();
            setTenantReady(true);
          }
          setLoading(false);
        },
        (error) => {
          console.error("Auth state error:", error);
          setLoading(false);
          setTenantReady(true);
        }
      );
      return unsubscribe;
    } catch (error) {
      console.error("Auth initialization error:", error);
      setLoading(false);
      setTenantReady(true);
    }
  }, []);

  return { user, loading, tenantReady };
}
