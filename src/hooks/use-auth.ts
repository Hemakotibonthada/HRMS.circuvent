"use client";

// ═══════════════════════════════════════════════════════════════
// AUTH — suite session
// ═══════════════════════════════════════════════════════════════
// Identity comes from /api/auth/me, which reads the signed suite JWT set by
// /api/auth/login. Firebase Auth is gone: the session token already carries the
// user id, organisation and role, so there was nothing left for a second
// identity provider to tell us, and keeping one meant every deployment needed
// Firebase credentials before it could authenticate anybody.
//
// The organisation arrives with the session rather than being fetched
// separately, so there is no window in which a scoped query can run without a
// tenant — the problem the old `tenantReady` flag existed to paper over.

import { useCallback, useEffect, useState } from "react";

export interface AuthUser {
  uid: string;
  employeeId: string | null;
  email: string | null;
  displayName: string | null;
  orgId: string;
  role: string;
  mfaVerified: boolean;
}

interface MeResponse {
  user: {
    id: string;
    orgId: string;
    role: string;
    email?: string;
    displayName?: string;
    mfaVerified?: boolean;
    employeeId?: string | null;
  };
}

function toUser(body: MeResponse): AuthUser {
  return {
    uid: body.user.id,
    employeeId: body.user.employeeId ?? null,
    email: body.user.email ?? null,
    displayName: body.user.displayName ?? null,
    orgId: body.user.orgId,
    role: body.user.role,
    mfaVerified: body.user.mfaVerified ?? false,
  };
}

/** Reads the current session. Returns null when signed out. */
export async function fetchSession(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me", { credentials: "include" });

  if (res.status === 401) {
    // An expired access token alongside a live refresh cookie is the normal
    // state every 15 minutes, not a sign-out. Renew once before giving up.
    const refreshed = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (!refreshed.ok) return null;
    const retry = await fetch("/api/auth/me", { credentials: "include" });
    if (!retry.ok) return null;
    return toUser((await retry.json()) as MeResponse);
  }

  if (!res.ok) return null;
  return toUser((await res.json()) as MeResponse);
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setUser(await fetchSession());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();

    // Keeps tabs in step: signing out in one should not leave another showing a
    // populated dashboard.
    const handler = () => void reload();
    window.addEventListener("focus", handler);
    window.addEventListener("circuvent-auth-change", handler);
    return () => {
      window.removeEventListener("focus", handler);
      window.removeEventListener("circuvent-auth-change", handler);
    };
  }, [reload]);

  return {
    user,
    loading,
    // The organisation is part of the session, so it is ready whenever the user
    // is. Kept in the shape callers already use so they need no changes.
    tenantReady: !loading,
    reload,
  };
}

/** Signs out and notifies every hook instance. */
export async function signOutSession(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } finally {
    window.dispatchEvent(new Event("circuvent-auth-change"));
  }
}
