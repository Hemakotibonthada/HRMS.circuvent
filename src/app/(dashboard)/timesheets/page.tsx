"use client";

import { Clock } from "lucide-react";
import { DataEmptyState } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// TIMESHEETS
// ═══════════════════════════════════════════════════════════════
// This page used to run entirely on a local, in-browser zustand store seeded
// with three invented project rows (fabricated daily hours for "Project
// Alpha", "Project Beta" and "Internal - Training") and a "Submit" button
// that only flipped local status to "submitted" and showed a success toast.
// No request was ever sent, so nothing was actually submitted for approval,
// and refreshing the page silently reset everything back to the fake seed.
//
// A generic "timesheets" document collection does exist at the
// infrastructure layer (hrms.doc_store, via /api/collections/timesheets),
// but its GET handler returns every document for the whole organisation with
// no per-employee filter -- wiring this page to it directly would let every
// employee read every other employee's logged hours, which is worse than the
// fabrication it would replace. A properly scoped, per-employee endpoint is
// real feature work, not a fabrication fix, so this stays an honest empty
// state until one exists.
export default function TimesheetsPage() {
  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Timesheets</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Time tracking is not available yet</p>
      </div>
      <DataEmptyState
        icon={Clock}
        title="Timesheets aren't available yet"
        description="There's no timesheet data source connected here. This page will let you log and submit real hours once one exists."
      />
    </div>
  );
}
