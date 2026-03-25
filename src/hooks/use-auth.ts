"use client";

import { useEffect, useState } from "react";
import { auth, onAuthStateChanged, type User } from "@/lib/firebase";
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

  useEffect(() => {
    // Local credentials mode — no Firebase needed
    if (isLocalCredentialsMode()) {
      const localUser = getLocalSession();
      if (localUser) {
        setUser({
          uid: localUser.uid,
          email: localUser.email,
          displayName: localUser.displayName,
        });
      }
      setLoading(false);

      // Listen for storage changes (login/logout in another tab)
      const handler = () => {
        const u = getLocalSession();
        setUser(
          u
            ? { uid: u.uid, email: u.email, displayName: u.displayName }
            : null
        );
      };
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
          setUser(
            firebaseUser
              ? {
                  uid: firebaseUser.uid,
                  email: firebaseUser.email,
                  displayName: firebaseUser.displayName,
                }
              : null
          );
          setLoading(false);
        },
        (error) => {
          console.error("Auth state error:", error);
          setLoading(false);
        }
      );
      return unsubscribe;
    } catch (error) {
      console.error("Auth initialization error:", error);
      setLoading(false);
    }
  }, []);

  return { user, loading };
}
