"use client";

import { SsoCard } from "@/components/sso-card";
import { useEffect, useState } from "react";

/**
 * Entry point for single sign-on.
 *
 * Rendered only when the deployment is wired to auth.circuvent.com, so an
 * environment without it never shows a button that would dead-end.
 */
export function SsoButton({ next }: { next?: string } = {}) {
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
      <SsoCard href={next ? `/api/auth/sso/start?next=${encodeURIComponent(next)}` : "/api/auth/sso/start"} />

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or use your password</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
