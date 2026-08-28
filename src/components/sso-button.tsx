"use client";

import { useEffect, useState } from "react";

/**
 * Entry point for single sign-on.
 *
 * Rendered only when the deployment is wired to auth.circuvent.com, so an
 * environment without it never shows a button that would dead-end.
 */
export function SsoButton() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/sso", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setEnabled(d.enabled === true);
      })
      .catch(() => {
        // Absence of the endpoint simply means no SSO here.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!enabled) return null;

  return (
    <div className="space-y-3">
      <a
        href="/api/auth/sso/start"
        className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-input bg-background text-sm font-medium transition-colors hover:bg-accent"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
          <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#2585C6" />
          <path
            d="M15.5 9.2a4.2 4.2 0 1 0 0 5.6"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
        Sign in with Circuvent
      </a>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or use your password</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
