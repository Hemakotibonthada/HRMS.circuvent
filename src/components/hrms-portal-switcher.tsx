"use client";
import { useAuth } from "@/hooks/use-auth";
import { useHrmsPortal } from "@/components/hrms-portal-provider";
import { HRMS_PORTALS, canEnterPortal, canEnterInternPortal, type HrmsPortal } from "@/lib/hrms-portals";

export function HrmsPortalSwitcher() {
  const { user } = useAuth();
  const active = useHrmsPortal();
  if (!user) return null;
  return <details className="mx-2 rounded-lg border border-sidebar-border p-2 text-xs group-data-[collapsible=icon]:hidden">
    <summary className="cursor-pointer font-medium">Switch workspace</summary>
    <nav aria-label="HRMS portals" className="mt-2 grid gap-1">
      {(Object.keys(HRMS_PORTALS) as HrmsPortal[]).filter(id => canEnterPortal(id, user.role) && (id !== "intern" || canEnterInternPortal(user.role, user.employmentType))).map(id =>
        <a key={id} href={`/api/portal/open?portal=${id}`} aria-current={id === active ? "page" : undefined} className="rounded px-2 py-2 hover:bg-sidebar-accent aria-[current=page]:bg-sidebar-accent">{HRMS_PORTALS[id].name}</a>
      )}
    </nav>
  </details>;
}
