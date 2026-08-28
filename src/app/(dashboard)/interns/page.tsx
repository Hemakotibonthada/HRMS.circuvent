"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  GraduationCap, AlertTriangle, Search, Download, ArrowRightCircle,
  Users, Clock, CalendarClock, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRBAC } from "@/hooks/use-rbac";
import { getInitials } from "@/lib/shared-ui";
import { downloadDocumentPdf } from "@/lib/letters-client";
import {
  listInterns, setInternshipEndDate, convertToPermanent,
  type InternRecord, type InternDocumentRecord,
} from "@/lib/intern-client";
import { daysUntil, describeDaysRemaining, reminderLeadDays } from "@/lib/intern-lifecycle";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// INTERNS
// ═══════════════════════════════════════════════════════════════
// The one page interns.view/interns.manage exist for: who is on an
// internship, how many days they have left, and what has actually been
// issued to them — not a second copy of the employees directory. Hiring an
// intern still goes through the normal Employees "Add" flow (employment
// type: Intern); this page only starts once that record exists, because
// `EmployeeCreate` (db/repositories/types.ts) has no `internshipEndDate`
// field at all. Without somewhere to set that date after hire, nobody could
// ever be reminded before an intern's last day, no matter how correct the
// cron sweep and its lead times are.
//
// Converting someone drops them off this list on the next reload — not
// because they vanished, but because `/api/interns` only ever asks for
// `employmentType: "intern"`, and conversion changes that value on purpose.
// From that point on they show up in the ordinary Employees list, on a new
// CV- code, with the CVI- one they were hired under kept as
// `previousEmployeeCode` so past payslips and signed letters still resolve.
export default function InternsPage() {
  const rbac = useRBAC();
  const canManage = rbac.can("interns.manage");
  // Same env-configurable lead times the reminder sweep uses (see
  // intern-lifecycle.ts) — reused here, not re-hardcoded, so the badge that
  // turns amber/red on this page always agrees with when a reminder email
  // actually goes out for the same intern.
  const leadDays = useMemo(() => reminderLeadDays(), []);

  const [interns, setInterns] = useState<InternRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // One page, sized to cover any internship programme this app runs in
      // practice, rather than building "load more" for a roster that is
      // never realistically the size the main employees directory is.
      const page = await listInterns({ pageSize: 500 });
      setInterns(page.items);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Interns could not be loaded");
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return interns;
    return interns.filter((i) =>
      i.fullName.toLowerCase().includes(q) ||
      i.email.toLowerCase().includes(q) ||
      i.employeeCode.toLowerCase().includes(q) ||
      i.designation.toLowerCase().includes(q) ||
      (i.departmentName ?? "").toLowerCase().includes(q)
    );
  }, [interns, search]);

  const handleSaveEndDate = useCallback(async (id: string, value: string | null) => {
    setBusyId(id);
    try {
      const updated = await setInternshipEndDate(id, value);
      setInterns((prev) =>
        prev.map((i) => (i.id === id ? { ...i, internshipEndDate: updated.internshipEndDate } : i))
      );
      toast.success(value ? "End date updated" : "End date cleared");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the end date");
    } finally {
      setBusyId(null);
    }
  }, []);

  const handleConvert = useCallback(async (intern: InternRecord) => {
    const remaining = intern.internshipEndDate ? daysUntil(intern.internshipEndDate) : null;
    const notice =
      remaining !== null && remaining > 0
        ? ` Their internship is not due to end for ${remaining} more day${remaining === 1 ? "" : "s"}.`
        : "";
    // A plain confirm(), matching src/app/(dashboard)/employees/page.tsx's
    // handleDelete — the closest precedent for "consequential, one-click
    // action on a person's record" in this codebase — rather than a new
    // dialog component for a single yes/no question.
    const ok = window.confirm(
      `Convert ${intern.fullName} (${intern.employeeCode}) to a permanent employee?${notice} ` +
        `They will be issued a new CV- employee code; ${intern.employeeCode} stays on their record ` +
        `for past payslips and documents to reference.`
    );
    if (!ok) return;

    setBusyId(intern.id);
    try {
      await convertToPermanent(intern.id);
      toast.success(`${intern.fullName} converted to a permanent employee`);
      // The converted record no longer matches `employmentType: "intern"`,
      // so re-fetching the roster is what actually removes them from this
      // list — there is no local patch that means the same thing.
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Conversion failed");
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  const handleDownload = useCallback(async (doc: InternDocumentRecord) => {
    try {
      await downloadDocumentPdf(doc.id, doc.title);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download the PDF");
    }
  }, []);

  const hasAnyData = interns.length > 0;

  if (loading && !initialized) return <DataLoadingSkeleton />;

  if (!loading && initialized && !hasAnyData) {
    return (
      <div className="space-y-6 p-6">
        <Header />
        {loadError ? (
          <ErrorBanner message={loadError} blocking />
        ) : (
          <DataEmptyState {...EMPTY_STATES.interns} />
        )}
      </div>
    );
  }

  const maxLead = leadDays.length > 0 ? Math.max(...leadDays) : 14;
  const noEndDateCount = interns.filter((i) => !i.internshipEndDate).length;
  const endingSoonCount = interns.filter((i) => {
    if (!i.internshipEndDate) return false;
    const remaining = daysUntil(i.internshipEndDate);
    return remaining >= 0 && remaining <= maxLead;
  }).length;
  const overdueCount = interns.filter(
    (i) => i.internshipEndDate && daysUntil(i.internshipEndDate) < 0
  ).length;

  const kpis = [
    { label: "Total Interns", value: interns.length, icon: Users, gradient: "from-violet-500 to-purple-600" },
    { label: "Ending Soon", value: endingSoonCount, icon: Clock, gradient: "from-amber-500 to-orange-500" },
    { label: "Past End Date", value: overdueCount, icon: AlertTriangle, gradient: "from-red-500 to-orange-500" },
    { label: "No End Date Set", value: noEndDateCount, icon: CalendarClock, gradient: "from-blue-500 to-cyan-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <Header />

      {loadError && <ErrorBanner message={loadError} blocking={false} />}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                  <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                </div>
                <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.gradient)}>
                  <kpi.icon className="h-5 w-5 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search interns…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="space-y-3">
        {filtered.map((intern) => (
          <InternRow
            // internshipEndDate rides along in the key, not a resync effect:
            // remounting on a genuine value change (our own save landing, or
            // a reload picking up someone else's edit) re-initialises
            // draftEndDate from the fresh prop for free, with no
            // setState-in-an-effect render cascade to reason about.
            key={`${intern.id}:${intern.internshipEndDate ?? ""}`}
            intern={intern}
            leadDays={leadDays}
            canManage={canManage}
            busy={busyId === intern.id}
            onSaveEndDate={(value) => handleSaveEndDate(intern.id, value)}
            onConvert={() => handleConvert(intern)}
            onDownload={handleDownload}
          />
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No interns match &ldquo;{search}&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent flex items-center gap-2">
        <GraduationCap className="h-7 w-7" /> Interns
      </h1>
      <p className="text-muted-foreground mt-1">Internship end dates, conversion &amp; documents</p>
    </div>
  );
}

function ErrorBanner({ message, blocking }: { message: string; blocking: boolean }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 flex items-start gap-3">
      <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-medium text-destructive">
          {blocking ? "Interns could not be loaded" : "The last refresh failed"}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {message}
          {blocking ? "" : " Showing the last data that loaded."}
        </p>
      </div>
    </div>
  );
}

/**
 * Formats a `YYYY-MM-DD` calendar date without routing it through
 * `new Date(isoString)`. That parses a date-only string as UTC midnight, so
 * a browser west of UTC reads "2026-04-30" back as Apr 29 — the exact bug
 * `daysUntil` (intern-lifecycle.ts) does its own epoch-day math to avoid.
 * Building the `Date` from the same Y/M/D components used to display it,
 * instead of from the string, keeps this page's calendar date and its
 * "days remaining" badge agreeing on which day it actually is.
 */
function formatCalendarDate(iso?: string): string {
  if (!iso) return "Not set";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

const URGENT = "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
const SOON = "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
const COMFORTABLE = "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";

/** Colours the "days remaining" badge off the same configured lead times the reminder sweep fires on, so the two never disagree about what "ending soon" means. */
function urgencyClassName(daysRemaining: number, leadDays: number[]): string {
  if (daysRemaining < 0) return URGENT;
  const sorted = [...leadDays].sort((a, b) => a - b);
  const nearest = sorted[0] ?? 3;
  const furthest = sorted[sorted.length - 1] ?? 14;
  if (daysRemaining <= nearest) return URGENT;
  if (daysRemaining <= furthest) return SOON;
  return COMFORTABLE;
}

const DOC_STATUS_CONF: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
  sent: { label: "Sent", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  viewed: { label: "Viewed", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  partially_signed: { label: "Partly signed", className: SOON },
  completed: { label: "Signed", className: COMFORTABLE },
  declined: { label: "Declined", className: URGENT },
  expired: { label: "Expired", className: URGENT },
  voided: { label: "Withdrawn", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
};

function InternRow({
  intern, leadDays, canManage, busy, onSaveEndDate, onConvert, onDownload,
}: {
  intern: InternRecord;
  leadDays: number[];
  canManage: boolean;
  busy: boolean;
  onSaveEndDate: (value: string | null) => void;
  onConvert: () => void;
  onDownload: (doc: InternDocumentRecord) => void;
}) {
  // The parent keys this row on `${id}:${internshipEndDate}`, so a genuine
  // change to the saved date (this row's own save landing, or a reload
  // picking up a colleague's edit) remounts the row and re-initialises this
  // from the fresh prop — without an effect calling setState after the fact.
  const [draftEndDate, setDraftEndDate] = useState(intern.internshipEndDate ?? "");

  const remaining = intern.internshipEndDate ? daysUntil(intern.internshipEndDate) : null;
  const dirty = draftEndDate !== (intern.internshipEndDate ?? "");

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-sm">
              {getInitials(intern.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">
              {intern.fullName} <span className="text-muted-foreground font-normal">· {intern.employeeCode}</span>
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {intern.designation}
              {intern.departmentName ? ` · ${intern.departmentName}` : ""}
              {intern.reportingToName ? ` · reports to ${intern.reportingToName}` : ""}
            </p>
          </div>
          {remaining !== null ? (
            <Badge variant="secondary" className={cn("text-xs whitespace-nowrap", urgencyClassName(remaining, leadDays))}>
              {describeDaysRemaining(remaining)}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs whitespace-nowrap">No end date set</Badge>
          )}
          {canManage && (
            <Button
              size="sm"
              className="gap-1 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0"
              disabled={busy}
              onClick={onConvert}
            >
              <ArrowRightCircle className="h-3.5 w-3.5" /> Convert to permanent
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pl-14">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Joined {formatCalendarDate(intern.joinDate)} · Ends
          </span>
          {canManage ? (
            <>
              <Input
                type="date"
                value={draftEndDate}
                onChange={(e) => setDraftEndDate(e.target.value)}
                className="h-8 w-40 text-xs"
                disabled={busy}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={busy || !dirty}
                onClick={() => onSaveEndDate(draftEndDate || null)}
              >
                Save
              </Button>
            </>
          ) : (
            <span className="text-xs font-medium">{formatCalendarDate(intern.internshipEndDate)}</span>
          )}
        </div>

        {intern.documents.length > 0 ? (
          <div className="pl-14 space-y-1.5 pt-1">
            {intern.documents.map((doc) => {
              const conf = DOC_STATUS_CONF[doc.status] ?? { label: doc.status, className: "" };
              return (
                <div key={doc.id} className="flex items-center gap-2 text-xs">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1 min-w-0 truncate">{doc.title}</span>
                  <span className="text-muted-foreground whitespace-nowrap">
                    {doc.signedCount}/{doc.totalSignatories} signed
                  </span>
                  <Badge variant="secondary" className={cn("text-xs", conf.className)}>{conf.label}</Badge>
                  {doc.blobUrl && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 gap-1"
                      onClick={() => void onDownload(doc)}
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="pl-14 text-xs text-muted-foreground">No documents issued yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
