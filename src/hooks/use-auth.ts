"use client";

// ═══════════════════════════════════════════════════════════════
// AUTH — suite session
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";

import { refreshSession } from "@/lib/refresh-session";

/** Access token lifetime — matches auth.circuvent.com. */
const ACCESS_TTL_MS = 24 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = ACCESS_TTL_MS - 5 * 60 * 1000;

export interface AuthUser {
  uid: string;
  employeeId: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl?: string | null;
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
    avatarUrl?: string | null;
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
    avatarUrl: body.user.avatarUrl ?? null,
    orgId: body.user.orgId,
    role: body.user.role,
    mfaVerified: body.user.mfaVerified ?? false,
  };
}

/** Reads the current session. Returns null when signed out. */
export async function fetchSession(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me", { credentials: "include" });

  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (!refreshed) return null;
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
  const lastRefreshRef = useRef(0);

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

    const handler = () => void reload();
    window.addEventListener("focus", handler);
    window.addEventListener("circuvent-auth-change", handler);
    return () => {
      window.removeEventListener("focus", handler);
      window.removeEventListener("circuvent-auth-change", handler);
    };
  }, [reload]);

  useEffect(() => {
    if (!user) return;

    const renew = () => {
      if (Date.now() - lastRefreshRef.current < REFRESH_INTERVAL_MS) return;
      void refreshSession().then((ok) => {
        if (ok) lastRefreshRef.current = Date.now();
      });
    };

    const timer = setInterval(renew, REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      renew();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user]);

  return {
    user,
    loading,
    tenantReady: !loading,
    reload,
  };
}

/** Signs out and notifies every hook instance. */
export async function signOutSession(): Promise<void> {
  let federatedLogoutUrl: string | null = null;
  try {
    const res = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { federatedLogoutUrl?: string };
      if (typeof body.federatedLogoutUrl === "string") {
        federatedLogoutUrl = body.federatedLogoutUrl;
      }
    }
  } finally {
    window.dispatchEvent(new Event("circuvent-auth-change"));
    if (federatedLogoutUrl) {
      window.location.assign(federatedLogoutUrl);
    }
  }
}
