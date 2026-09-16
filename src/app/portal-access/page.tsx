"use client";
import { useHrmsPortal } from "@/components/hrms-portal-provider";
import { HRMS_PORTALS } from "@/lib/hrms-portals";
import { signOutSession } from "@/hooks/use-auth";
import { ShieldAlert } from "lucide-react";

export default function PortalAccessPage() {
  const portal = useHrmsPortal();
  return <main className="mx-auto max-w-xl px-6 py-24 text-center">
    <ShieldAlert className="mx-auto mb-6 h-12 w-12 text-primary" />
    <h1 className="text-2xl font-bold">This area is not available in your {HRMS_PORTALS[portal].name.toLowerCase()}</h1>
    <p className="mt-4 text-muted-foreground">Use your assigned workspace, or ask your organization administrator to check your role and employment record. Opening a subdomain does not change your permissions.</p>
    <div className="mt-8 flex flex-wrap justify-center gap-4">
      <a href="/workspace" className="rounded-lg border px-4 py-2">Portal home</a>
      <a href="https://hrms.circuvent.com/dashboard" className="rounded-lg bg-primary px-4 py-2 text-primary-foreground">Open HRMS</a>
      <button onClick={() => void signOutSession()} className="rounded-lg border px-4 py-2">Sign out</button>
    </div>
  </main>;
}
