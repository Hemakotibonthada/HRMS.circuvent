"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  UserMinus, Search, CheckCircle2, AlertCircle, Shield, ShieldCheck, ShieldAlert,
  Laptop, BookOpen, DollarSign, FileText, FileCheck2, ChevronDown, Download,
  ListChecks, Target, ClipboardList, Wallet, Banknote, PlayCircle, RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useEmployeeStore, startSync, type EmployeeDoc } from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton } from "@/components/data-empty-state";
import {
  OFFBOARDING_STEPS, OFFBOARDING_CHECKLIST_TASKS, offboardingTaskTemplates,
} from "@/lib/offboarding-checklist";
import type { SettlementComponents } from "@/lib/employee-lifecycle";
import { downloadDocumentPdf } from "@/lib/letters-client";
import { todayKey } from "@/lib/date-keys";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, PieChart, Pie, Cell, Legend,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// OFFBOARDING — the leaver checklist, access removal and settlement
// ═══════════════════════════════════════════════════════════════
// This page used to run its own invented six-item checklist ("IT Assets
// Return", "Access Revocation", ...) that existed only here, and posted it
// to `/api/lifecycle` as an employee's *actual* offboarding checklist.
// Meanwhile `resignation.neon.ts` was already creating the real one — the
// 27 tasks in `OFFBOARDING_TEMPLATE`, grouped into the same six steps this
// file now renders — the moment HR accepted a resignation. Two different
// checklists claiming to be the same thing, and whichever POST landed first
// silently won (`NeonLifecycleRepository.start()` is first-writer-wins, a
// 409 on the second attempt). Every real detail the template carries — who
// owns a task, which step it belongs to, when it falls due relative to the
// last working day — was thrown away in favour of six generic rows the
// moment someone opened this page before HR's own accept-flow beat them to
// it. So this file no longer defines a checklist: it imports the one
// `offboarding-checklist.ts` already turns `OFFBOARDING_TEMPLATE` into, the
// same module the server-side acceptance flow uses, so there is exactly one
// answer to "what does a leaver's checklist contain".
//
// The bigger gap: this page also had no idea whether access had actually
// been removed, whether a settlement had been priced, or whether a
// relieving letter existed anywhere but a fake "Documentation" checkbox — a
// leaver ticked 100% complete here could still be a member of
// `all@circuvent.com` and never have been paid. That is the exact shape of
// bug this whole body of work exists to close (see `offboarding-exit.ts`'s
// header), so this page now surfaces a real "Process Exit" result — access
// still outstanding, a document that failed to generate, the standing
// sign-out caveat — instead of a checkbox that says nothing about whether
// the underlying thing happened.

interface ResignationRecord {
  id: string;
  employeeId: string;
  employeeName?: string;
  status: "submitted" | "accepted";
  reason: string;
  intendedLastWorkingDay: string;
  agreedLastWorkingDay?: string;
  acceptedAt?: string;
  exitProcessedAt?: string;
  settlementSnapshot?: SettlementComponents;
  relievingLetterDocumentId?: string;
  experienceCertificateDocumentId?: string;
  internshipCompletionDocumentId?: string;
}

/**
 * The full result of `POST /api/resignations/[id]/process-exit` — settlement,
 * access removal and documents in one shot, `caveats` deliberately included.
 * See that route's own comment for why: a caller must never read a 200 here
 * as "everything is clean" when the report itself might say otherwise.
 */
interface ExitProcessingReport {
  resignationId: string;
  employeeId: string;
  agreedLastWorkingDay: string;
  settlement: SettlementComponents;
  settlementFrozenThisRun: boolean;
  groupLeaves: {
    attempted: number;
    left: number;
    failed: number;
    outstanding: Array<{ groupAddress: string; status: string; lastError: string | null }>;
  };
  documents: {
    dispatched: Array<{ kind: string; ok: boolean; documentId?: string; error?: string }>;
    withheldReason?: string;
    allIssued: boolean;
  };
  exitProcessed: boolean;
  caveats: string[];
}

interface LifecycleTask {
  id: string;
  taskKey: string;
  title: string;
  completed: boolean;
  completedAt?: string;
  mandatory: boolean;
}

interface LifecycleJourney {
  id: string;
  employeeId: string;
  status: string;
  progress: { total: number; completed: number; percent: number };
  blocking: { taskKey: string; title: string }[];
  tasks: LifecycleTask[];
}

/** `OFFBOARDING_CHECKLIST_TASKS` grouped by step — computed once from a static import, not per render. */
const STEPS: Array<{ step: number; stepName: string; tasks: typeof OFFBOARDING_CHECKLIST_TASKS }> =
  OFFBOARDING_STEPS.map((s) => ({
    step: s.step,
    stepName: s.stepName,
    tasks: OFFBOARDING_CHECKLIST_TASKS.filter((t) => t.step === s.step),
  }));

/** `offboarding-checklist.ts` is deliberately UI-agnostic (see its header) — the icon-per-step mapping belongs here, not there. */
const STEP_ICONS: Record<number, LucideIcon> = {
  1: ClipboardList,
  2: BookOpen,
  3: Laptop,
  4: Wallet,
  5: FileText,
  6: Banknote,
};

const COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];

/** Which `resignations` column backs a document kind, for a badge that reads the same field `offboarding-exit.ts` treats as "already issued". Intern-only kinds are marked so non-interns never see a phantom "pending" badge for a certificate nobody will ever request for them. */
const DOCUMENT_KINDS: Array<{
  kind: "experience_certificate" | "relieving_letter" | "internship_completion_certificate";
  field: "experienceCertificateDocumentId" | "relievingLetterDocumentId" | "internshipCompletionDocumentId";
  label: string;
  icon: LucideIcon;
  internOnly: boolean;
}> = [
  { kind: "experience_certificate", field: "experienceCertificateDocumentId", label: "Experience Certificate", icon: FileCheck2, internOnly: false },
  { kind: "relieving_letter", field: "relievingLetterDocumentId", label: "Relieving Letter", icon: FileText, internOnly: false },
  { kind: "internship_completion_certificate", field: "internshipCompletionDocumentId", label: "Internship Completion", icon: FileCheck2, internOnly: true },
];

function fmtDate(value?: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function currency(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function nameOf(resignation: ResignationRecord, employee?: EmployeeDoc): string {
  return employee ? `${employee.firstName} ${employee.lastName}` : resignation.employeeName ?? "Unknown employee";
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const letters = parts.slice(0, 2).map((p) => p[0] ?? "").join("");
  return letters.toUpperCase() || "?";
}

/**
 * A resignation's real-world phase, derived from what has actually happened
 * rather than from a status column nobody updates for a leaver. "Overdue
 * Processing" is the state that matters most: the agreed last working day
 * has passed and nobody has run exit processing, which is precisely the
 * "a record nobody touches again" shape the whole leaver path exists to
 * close. The daily cron's `processDueExits` should catch this automatically
 * — seeing this badge at all past the day it was agreed is a sign the cron
 * did not run, not a normal steady state.
 */
function exitPhase(resignation: ResignationRecord, today: string): { label: string; className: string } {
  if (resignation.exitProcessedAt) return { label: "Exit Processed", className: "status-active" };
  if (resignation.agreedLastWorkingDay && resignation.agreedLastWorkingDay <= today) {
    return { label: "Overdue Processing", className: "status-rejected" };
  }
  return { label: "Notice Period", className: "status-pending" };
}

/**
 * "Unchecked" is its own state, distinct from "clear" — this page has not
 * fetched a report for this person this session, so it does not know
 * whether access was removed and must not imply that it was. Only a report
 * that was actually returned this session, with zero outstanding groups,
 * earns the green badge.
 */
function accessState(report: ExitProcessingReport | undefined): "unchecked" | "clear" | "outstanding" | "none-attempted" {
  if (!report) return "unchecked";
  if (report.groupLeaves.outstanding.length > 0) return "outstanding";
  if (report.groupLeaves.attempted === 0) return "none-attempted";
  return "clear";
}

/**
 * Whether a leaver's document is issued, failed, withheld, or simply not
 * attempted yet — read from the resignation record's own document-id
 * columns first, because those are the durable, always-correct signal
 * (`offboarding-exit.ts` only ever writes them once, on success). The last
 * fetched report is only consulted to explain *why* a document is not
 * issued (a real failure vs. still waiting on the last working day) — a
 * document already issued in an earlier session must never show as
 * "pending" just because nobody has re-run processing since this tab opened.
 */
function documentState(
  resignation: ResignationRecord,
  report: ExitProcessingReport | undefined,
  kind: string,
  field: "experienceCertificateDocumentId" | "relievingLetterDocumentId" | "internshipCompletionDocumentId"
): { state: "issued" | "failed" | "withheld" | "pending"; documentId?: string; detail?: string } {
  const documentId = resignation[field];
  if (documentId) return { state: "issued", documentId };
  const dispatched = report?.documents.dispatched.find((d) => d.kind === kind);
  if (dispatched && !dispatched.ok) return { state: "failed", detail: dispatched.error };
  if (report?.documents.withheldReason) return { state: "withheld", detail: report.documents.withheldReason };
  return { state: "pending" };
}

/**
 * Folds a freshly-returned report into its resignation row so the list
 * reflects what just happened without waiting on a full re-fetch. Only
 * copies document ids the report says were actually dispatched *and*
 * succeeded this run — a document already issued in a prior run is not in
 * `dispatched` at all (see `offboarding-exit.ts`), so its existing id on the
 * row is left exactly as it was rather than overwritten with nothing.
 */
function mergeReportIntoResignation(record: ResignationRecord, report: ExitProcessingReport): ResignationRecord {
  const patch: Partial<ResignationRecord> = {
    settlementSnapshot: report.settlement,
    exitProcessedAt: report.exitProcessed ? record.exitProcessedAt ?? new Date().toISOString() : record.exitProcessedAt,
  };
  for (const doc of report.documents.dispatched) {
    if (!doc.ok || !doc.documentId) continue;
    if (doc.kind === "relieving_letter") patch.relievingLetterDocumentId = doc.documentId;
    else if (doc.kind === "experience_certificate") patch.experienceCertificateDocumentId = doc.documentId;
    else if (doc.kind === "internship_completion_certificate") patch.internshipCompletionDocumentId = doc.documentId;
  }
  return { ...record, ...patch };
}

export default function OffboardingPage() {
  const store = useEmployeeStore();
  const { items: employees, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("active");
  const [resignations, setResignations] = useState<ResignationRecord[]>([]);
  const [resignationsLoading, setResignationsLoading] = useState(true);
  /**
   * Offboarding checklists, keyed by employee — loaded, not invented. See
   * the file header: a checklist that only ever lived in this page's own
   * `useState` and was posted back under a made-up shape is exactly the bug
   * this rewrite exists to remove.
   */
  const [journeys, setJourneys] = useState<Record<string, LifecycleJourney>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  /** The last `ExitProcessingReport` fetched per resignation this session — see `accessState`/`documentState` for why "no report yet" is its own honest state rather than assumed-clean. */
  const [lastReport, setLastReport] = useState<Record<string, ExitProcessingReport>>({});

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.employees, store); }, [initialized, store]);

  // Only accepted resignations belong here — a submission still awaiting a
  // decision is `/resignation`'s job, not this page's.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/resignations?status=accepted&pageSize=200", {
          credentials: "include",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { items: ResignationRecord[] };
        if (!cancelled) setResignations(body.items ?? []);
      } catch {
        // Renders whatever loaded before the blip rather than throwing.
      } finally {
        if (!cancelled) setResignationsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadJourneys = useCallback(async (): Promise<Record<string, LifecycleJourney>> => {
    try {
      const response = await fetch("/api/lifecycle?kind=offboarding&limit=200", {
        credentials: "include",
      });
      if (!response.ok) return {};
      const body = (await response.json()) as { data: LifecycleJourney[] };
      const byEmployee: Record<string, LifecycleJourney> = {};
      for (const journey of body.data ?? []) byEmployee[journey.employeeId] = journey;
      setJourneys(byEmployee);
      return byEmployee;
    } catch {
      // The list still renders; ticks simply show as unsaved-and-absent,
      // which is honest, rather than as ticked-and-lost.
      return {};
    }
  }, []);

  useEffect(() => {
    void loadJourneys();
  }, [loadJourneys]);

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const leavers = useMemo(
    () => resignations.map((resignation) => ({ resignation, employee: employeeById.get(resignation.employeeId) })),
    [resignations, employeeById]
  );

  /**
   * A second, older way for someone to stop being an employee: their status
   * set straight to "terminated" through the plain employee-edit form, with
   * no resignation ever filed. That path was never taught about directory
   * groups, settlement or documents — `employee.neon.ts`'s delete-button
   * leaver path (`remove()`) got fixed to queue a group leave and dispatch
   * documents same as here, but a manual status edit to "terminated" is a
   * different code path this work did not touch. Rather than silently
   * pretend these people were never leavers, they get their own honest
   * notice below.
   */
  const legacyTerminated = useMemo(
    () => employees.filter((e) => e.status === "terminated" && !resignations.some((r) => r.employeeId === e.id)),
    [employees, resignations]
  );

  const filtered = useMemo(() => {
    if (!search) return leavers;
    const q = search.toLowerCase();
    return leavers.filter(({ resignation, employee }) => {
      const name = nameOf(resignation, employee).toLowerCase();
      return name.includes(q) || (employee?.department ?? "").toLowerCase().includes(q);
    });
  }, [leavers, search]);

  const getClearanceCount = useCallback(
    (employeeId: string) => journeys[employeeId]?.progress.completed ?? 0,
    [journeys]
  );

  const getClearancePercent = useCallback(
    (employeeId: string) => journeys[employeeId]?.progress.percent ?? 0,
    [journeys]
  );

  const isTaskDone = useCallback(
    (employeeId: string, taskKey: string) =>
      journeys[employeeId]?.tasks.find((t) => t.taskKey === taskKey)?.completed ?? false,
    [journeys]
  );

  const isStepComplete = useCallback(
    (employeeId: string, step: number) => {
      const journey = journeys[employeeId];
      if (!journey) return false;
      const keys = OFFBOARDING_STEPS.find((s) => s.step === step)?.taskKeys ?? [];
      return keys.length > 0 && keys.every((key) => journey.tasks.find((t) => t.taskKey === key)?.completed);
    },
    [journeys]
  );

  /**
   * Starts a checklist for a leaver who does not have one yet. In the
   * ordinary case this never runs: accepting a resignation already creates
   * the journey server-side (`ensureOffboardingJourney` in
   * `resignation.neon.ts`), so by the time anyone opens this page the row
   * already exists. It exists as a fallback for a resignation accepted
   * before that server-side creation shipped — an already-accepted leaver
   * with no journey yet, not a hypothetical.
   */
  const ensureJourney = useCallback(
    async (resignation: ResignationRecord): Promise<LifecycleJourney | null> => {
      const existing = journeys[resignation.employeeId];
      if (existing) return existing;

      const response = await fetch("/api/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          employeeId: resignation.employeeId,
          kind: "offboarding",
          anchorDate: resignation.agreedLastWorkingDay ?? resignation.intendedLastWorkingDay,
          exitReason: resignation.reason,
          tasks: offboardingTaskTemplates(),
        }),
      });

      if (response.status === 409) {
        // Lost the race to the server-side auto-create — not an error, just
        // proof the real journey already exists. Re-read it rather than
        // surfacing a 409 to someone who did nothing wrong.
        const refreshed = await loadJourneys();
        return refreshed[resignation.employeeId] ?? null;
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Could not start the exit checklist");
        return null;
      }

      const body = (await response.json()) as { data: LifecycleJourney };
      setJourneys((prev) => ({ ...prev, [resignation.employeeId]: body.data }));
      return body.data;
    },
    [journeys, loadJourneys]
  );

  const toggleClearance = async (resignation: ResignationRecord, taskKey: string) => {
    setSaving(`${resignation.employeeId}:${taskKey}`);
    try {
      const journey = await ensureJourney(resignation);
      if (!journey) return;

      const task = journey.tasks.find((t) => t.taskKey === taskKey);
      if (!task) {
        toast.error("That task is not on this checklist");
        return;
      }

      const response = await fetch(`/api/lifecycle/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ completed: !task.completed }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        data?: LifecycleJourney;
        error?: string;
      };

      if (!response.ok || !body.data) {
        toast.error(body.error ?? "That task could not be saved");
        return;
      }

      setJourneys((prev) => ({ ...prev, [resignation.employeeId]: body.data! }));
      toast.success(task.completed ? "Task reopened" : "Task completed");
    } catch {
      toast.error("That task could not be saved");
    } finally {
      setSaving(null);
    }
  };

  /**
   * Prices the settlement, queues access removal and dispatches whichever
   * documents are due — the same `runExitProcessing` the daily cron calls
   * for everyone whose last working day has arrived. Safe to call more than
   * once on purpose: a frozen settlement is never repriced, an issued
   * document is never re-issued, and a group already left is never
   * re-queued (see `offboarding-exit.ts`), so this button doubles as
   * "re-check access & docs" once an exit has already been processed —
   * useful after fixing whatever made an earlier run report a caveat.
   */
  const handleProcessExit = useCallback(async (resignation: ResignationRecord) => {
    setProcessing(resignation.id);
    try {
      const response = await fetch(`/api/resignations/${resignation.id}/process-exit`, {
        method: "POST",
        credentials: "include",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error((body as { error?: string }).error ?? "Exit processing failed");
        return;
      }
      const report = body as ExitProcessingReport;
      setLastReport((prev) => ({ ...prev, [resignation.id]: report }));
      setResignations((prev) =>
        prev.map((r) => (r.id === resignation.id ? mergeReportIntoResignation(r, report) : r))
      );
      const clean = report.exitProcessed && report.groupLeaves.outstanding.length === 0 && report.documents.allIssued;
      if (clean) {
        toast.success("Exit fully processed — settlement frozen, access confirmed removed, documents issued.");
      } else {
        // A warning, deliberately not a success — the caveats rendered on
        // this card say exactly what did not finish. Reporting this run as
        // a plain success would be the same mistake the old fake checklist
        // made.
        toast.warning("Exit processing ran, but something is still outstanding — see the notes on this card.");
      }
    } catch {
      toast.error("Exit processing failed");
    } finally {
      setProcessing(null);
    }
  }, []);

  const today = todayKey();
  const checklistCompleteCount = resignations.filter((r) => getClearancePercent(r.employeeId) === 100).length;
  const exitFullyProcessedCount = resignations.filter((r) => r.exitProcessedAt).length;
  const overdueProcessingCount = resignations.filter(
    (r) => !r.exitProcessedAt && r.agreedLastWorkingDay && r.agreedLastWorkingDay <= today
  ).length;

  const deptDistribution = useMemo(() => {
    const map: Record<string, number> = {};
    leavers.forEach(({ resignation, employee }) => {
      const d = employee?.department || "Unassigned";
      map[d] = (map[d] || 0) + 1;
      void resignation;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [leavers]);

  const stepChart = useMemo(
    () =>
      STEPS.map((s) => {
        const completed = resignations.filter((r) => isStepComplete(r.employeeId, s.step)).length;
        return {
          name: s.stepName.length > 14 ? `${s.stepName.slice(0, 13)}…` : s.stepName,
          completed,
          pending: resignations.length - completed,
        };
      }),
    [resignations, isStepComplete]
  );

  if ((loading && !initialized) || resignationsLoading) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Offboarding</h1>
          <p className="text-muted-foreground mt-1">Exit checklist, access removal, settlement and documents for accepted resignations</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        {[
          { label: "Active Exits", value: resignations.length, icon: UserMinus, gradient: "from-violet-500 to-purple-600" },
          { label: "Checklist Complete", value: checklistCompleteCount, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
          { label: "Exit Fully Processed", value: exitFullyProcessedCount, icon: ShieldCheck, gradient: "from-blue-500 to-cyan-500" },
          { label: "Overdue Processing", value: overdueProcessingCount, icon: AlertCircle, gradient: "from-red-500 to-orange-500" },
        ].map((kpi) => (
          <Card key={kpi.label} className="animate-slide-up">
            <CardContent className="p-4 flex items-center gap-4">
              <div className={cn("h-12 w-12 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md", kpi.gradient)}>
                <kpi.icon className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{kpi.label}</p>
                <p className="text-2xl font-bold">{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search exiting employees..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
      </div>

      {/* Standing disclosures — true regardless of whether anyone has run
          exit processing this session, so they are not buried inside a
          per-leaver report that only appears after a click. */}
      <div className="flex items-start gap-2 p-3 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20 text-xs text-blue-700 dark:text-blue-400">
        <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p>Access removal here only leaves the auto-joined &quot;all@&quot; mailing address for this domain — additional directory groups an employee was added to by hand are not touched by this flow.</p>
          <p>Removing group membership does not end an already-issued sign-in session — this suite has no cross-app sign-out today, so a token an ex-employee already holds may still be honoured until it naturally expires. &quot;Access removed&quot; below means cannot start a new session and is off the mailing list, not logged out this instant.</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active" className="gap-2"><ListChecks className="h-4 w-4" /> Clearance Tracking</TabsTrigger>
          <TabsTrigger value="workflow" className="gap-2"><Target className="h-4 w-4" /> Workflow Steps</TabsTrigger>
          <TabsTrigger value="settlement" className="gap-2"><DollarSign className="h-4 w-4" /> Settlement</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2"><Shield className="h-4 w-4" /> Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4 space-y-4">
          {filtered.length === 0 ? (
            <DataEmptyState icon={UserMinus} title="No exits in progress" description="Accepted resignations will appear here once HR accepts them on the Resignation page." />
          ) : (
            <div className="space-y-4 stagger-children">
              {filtered.map(({ resignation, employee }) => {
                const pct = getClearancePercent(resignation.employeeId);
                const journey = journeys[resignation.employeeId];
                const displayName = nameOf(resignation, employee);
                const phase = exitPhase(resignation, today);
                const report = lastReport[resignation.id];
                const access = accessState(report);
                const busy = processing === resignation.id;
                const isIntern = employee?.employmentType === "intern";
                const expanded = expandedId === resignation.id;

                return (
                  <Card key={resignation.id} className="animate-slide-up">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4 mb-3">
                        <Avatar className="h-12 w-12">
                          <AvatarFallback className="bg-gradient-to-br from-red-500 to-orange-500 text-white">
                            {initialsOf(displayName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <h3 className="font-semibold">{displayName}</h3>
                          <p className="text-sm text-muted-foreground">{employee?.department ?? "—"} &middot; {employee?.designation ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            Last working day: {fmtDate(resignation.agreedLastWorkingDay ?? resignation.intendedLastWorkingDay)}
                            {!resignation.agreedLastWorkingDay && " (intended, not yet agreed)"}
                          </p>
                        </div>
                        <Badge className={phase.className}>{phase.label}</Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs gap-1",
                            access === "clear" && "border-green-500 text-green-600",
                            access === "outstanding" && "border-red-500 text-red-600",
                            (access === "unchecked" || access === "none-attempted") && "border-muted-foreground/40 text-muted-foreground"
                          )}
                        >
                          {access === "outstanding" ? <ShieldAlert className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                          {access === "clear" && "Access removed"}
                          {access === "outstanding" && `Access NOT fully removed (${report?.groupLeaves.outstanding.length ?? 0})`}
                          {access === "unchecked" && "Access not yet checked"}
                          {access === "none-attempted" && "No group memberships found"}
                        </Badge>
                        {DOCUMENT_KINDS.filter((d) => !d.internOnly || isIntern).map((d) => {
                          const ds = documentState(resignation, report, d.kind, d.field);
                          return (
                            <span key={d.kind} className="inline-flex items-center gap-1">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-xs gap-1",
                                  ds.state === "issued" && "border-green-500 text-green-600",
                                  ds.state === "failed" && "border-red-500 text-red-600",
                                  ds.state === "withheld" && "border-amber-500 text-amber-600",
                                  ds.state === "pending" && "border-muted-foreground/40 text-muted-foreground"
                                )}
                                title={ds.detail}
                              >
                                <d.icon className="h-3 w-3" />
                                {d.label}: {ds.state === "issued" ? "Issued" : ds.state === "failed" ? "Failed" : ds.state === "withheld" ? "Withheld" : "Pending"}
                              </Badge>
                              {ds.state === "issued" && ds.documentId && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-1.5 gap-1 text-xs"
                                  onClick={() => void downloadDocumentPdf(ds.documentId!, `${d.label} - ${displayName}`)}
                                >
                                  <Download className="h-3 w-3" /> View
                                </Button>
                              )}
                            </span>
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-3 mb-3">
                        <Progress value={pct} className="flex-1 h-2" />
                        <span className="text-sm font-medium">{pct}% Complete</span>
                      </div>

                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Button
                          variant="ghost" size="sm" className="gap-1"
                          onClick={() => setExpandedId(expanded ? null : resignation.id)}
                        >
                          <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
                          {expanded ? "Collapse" : "Expand"} Checklist
                        </Button>
                        <Button
                          size="sm"
                          variant={resignation.exitProcessedAt ? "outline" : "default"}
                          className={cn("gap-1", !resignation.exitProcessedAt && "bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0")}
                          disabled={busy}
                          onClick={() => void handleProcessExit(resignation)}
                        >
                          {busy ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : resignation.exitProcessedAt ? (
                            <RefreshCw className="h-3.5 w-3.5" />
                          ) : (
                            <PlayCircle className="h-3.5 w-3.5" />
                          )}
                          {busy ? "Processing…" : resignation.exitProcessedAt ? "Re-check Access & Docs" : "Process Exit"}
                        </Button>
                      </div>

                      {expanded && (
                        <div className="space-y-4 mt-2">
                          {/* Named what is outstanding rather than only
                              refusing to finish. "You cannot close this" is
                              not useful without "because these are open". */}
                          {journey && journey.blocking.length > 0 && (
                            <p className="text-xs text-amber-600 px-1">
                              Cannot be certified complete until:{" "}
                              {journey.blocking.map((b) => b.title).join(", ")}
                            </p>
                          )}
                          {STEPS.map((s) => {
                            const Icon = STEP_ICONS[s.step] ?? ClipboardList;
                            return (
                              <div key={s.step}>
                                <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                                  <Icon className="h-4 w-4 text-violet-500" />
                                  Step {s.step}: {s.stepName}
                                </h4>
                                <div className="space-y-1 ml-4">
                                  {s.tasks.map((task) => {
                                    const done = isTaskDone(resignation.employeeId, task.key);
                                    const isBusy = saving === `${resignation.employeeId}:${task.key}`;
                                    return (
                                      <div key={task.key} className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/50 transition-colors">
                                        <Checkbox
                                          checked={done}
                                          disabled={isBusy}
                                          onCheckedChange={() => void toggleClearance(resignation, task.key)}
                                          aria-label={task.title}
                                        />
                                        <div className="flex-1">
                                          <p className={cn("text-sm", done && "line-through text-muted-foreground")}>
                                            {task.title}
                                            {task.mandatory && <span className="ml-1 text-xs text-muted-foreground">(required)</span>}
                                          </p>
                                        </div>
                                        <Badge variant="outline" className="text-xs">{task.assignee}</Badge>
                                        <Badge variant="outline" className={cn("text-xs", done ? "border-green-500 text-green-600" : "border-amber-500 text-amber-600")}>
                                          {isBusy ? "Saving…" : done ? "Done" : "Pending"}
                                        </Badge>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {report && report.groupLeaves.outstanding.length > 0 && (
                        <div className="mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 space-y-1">
                          <p className="text-xs font-medium text-red-700 dark:text-red-400 flex items-center gap-1">
                            <ShieldAlert className="h-3.5 w-3.5" />
                            Still a member of {report.groupLeaves.outstanding.length} directory group{report.groupLeaves.outstanding.length > 1 ? "s" : ""} — the daily sweep will retry this, it is not a dead end
                          </p>
                          {report.groupLeaves.outstanding.map((g) => (
                            <p key={g.groupAddress} className="text-xs text-red-700 dark:text-red-400 pl-5">
                              {g.groupAddress} — {g.status}{g.lastError ? `: ${g.lastError}` : ""}
                            </p>
                          ))}
                        </div>
                      )}

                      {report && report.caveats.length > 0 && (
                        <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 space-y-1">
                          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                            From the last run — a green badge above is not the same claim as this being clean:
                          </p>
                          {report.caveats.map((note, i) => (
                            <p key={i} className="text-xs text-amber-700 dark:text-amber-400 pl-2">&middot; {note}</p>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {legacyTerminated.length > 0 && (
            <Card className="border-amber-300/60 dark:border-amber-900/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertCircle className="h-4 w-4" /> Marked Terminated Without a Resignation on File ({legacyTerminated.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  These employees were set to &quot;terminated&quot; directly through the employee edit form rather than through the resignation flow above, so none of the automation on this page — checklist, access removal, settlement, documents — ran for them. Listed here so this gap stays visible instead of silently disappearing; review their status directly on the Employees page.
                </p>
                <div className="space-y-1">
                  {legacyTerminated.map((e) => (
                    <div key={e.id} className="flex items-center justify-between text-sm py-1 px-2 rounded bg-muted/40">
                      <span>{e.firstName} {e.lastName}</span>
                      <span className="text-xs text-muted-foreground">{e.department ?? "—"}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="workflow" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {STEPS.map((s) => {
              const Icon = STEP_ICONS[s.step] ?? ClipboardList;
              const completed = resignations.filter((r) => isStepComplete(r.employeeId, s.step)).length;
              const pct = resignations.length ? Math.round((completed / resignations.length) * 100) : 0;
              return (
                <Card key={s.step}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                        <Icon className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">Step {s.step}: {s.stepName}</p>
                        <p className="text-xs text-muted-foreground">{s.tasks.length} tasks</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Progress value={pct} className="flex-1 h-2" />
                      <span className="text-sm font-medium">{completed}/{resignations.length}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="settlement" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Full &amp; Final Settlement</CardTitle></CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-4">
                A settlement is priced once — the first time exit processing runs for someone — and never recalculated
                after. Salary structures and leave balances keep changing after a person leaves, so a later run freeze-
                checks the existing number rather than pricing it again; a payslip already promised does not quietly change.
              </p>
              {leavers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No employees pending settlement.</p>
              ) : (
                <div className="space-y-3">
                  {leavers.map(({ resignation, employee }) => {
                    const snapshot = resignation.settlementSnapshot;
                    const busy = processing === resignation.id;
                    const displayName = nameOf(resignation, employee);
                    return (
                      <div key={resignation.id} className="p-4 rounded-lg border hover:bg-muted/50">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9">
                              <AvatarFallback className="text-xs bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                                {initialsOf(displayName)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-sm">{displayName}</p>
                              <p className="text-xs text-muted-foreground">{employee?.department ?? "—"}</p>
                            </div>
                          </div>
                          {snapshot ? (
                            <Badge className="status-active">Frozen</Badge>
                          ) : (
                            <Button size="sm" disabled={busy} onClick={() => void handleProcessExit(resignation)}>
                              {busy ? "Processing…" : "Calculate & Freeze"}
                            </Button>
                          )}
                        </div>
                        {snapshot ? (
                          <div className="mt-3 space-y-2">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">Earnings</p>
                                {snapshot.earnings.map((line) => (
                                  <div key={line.code} className="flex justify-between text-xs py-0.5">
                                    <span>{line.label}{line.note && <span className="text-muted-foreground"> — {line.note}</span>}</span>
                                    <span className="font-medium">{currency(line.amount)}</span>
                                  </div>
                                ))}
                                <div className="flex justify-between text-xs pt-1 mt-1 border-t font-semibold">
                                  <span>Total Earnings</span><span>{currency(snapshot.totalEarnings)}</span>
                                </div>
                              </div>
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">Deductions</p>
                                {snapshot.deductions.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">None</p>
                                ) : (
                                  snapshot.deductions.map((line) => (
                                    <div key={line.code} className="flex justify-between text-xs py-0.5 text-red-600">
                                      <span>{line.label}{line.note && <span className="text-muted-foreground"> — {line.note}</span>}</span>
                                      <span className="font-medium">-{currency(line.amount)}</span>
                                    </div>
                                  ))
                                )}
                                <div className="flex justify-between text-xs pt-1 mt-1 border-t font-semibold">
                                  <span>Total Deductions</span><span>{currency(snapshot.totalDeductions)}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between pt-2 border-t flex-wrap gap-1">
                              <span className="text-xs text-muted-foreground">
                                {snapshot.daysWorkedInFinalMonth} of {snapshot.daysInFinalMonth} days in exit month &middot;{" "}
                                {snapshot.gratuityEligible ? `Gratuity-eligible (${snapshot.gratuityYearsOfService.toFixed(1)}y)` : "Not gratuity-eligible"}
                              </span>
                              <span className={cn("text-base font-bold", snapshot.employeeOwes ? "text-red-600" : "text-green-600")}>
                                {snapshot.employeeOwes ? "Employee owes " : "Net payable "}{currency(Math.abs(snapshot.netSettlement))}
                              </span>
                            </div>
                            {snapshot.notes.length > 0 && (
                              <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
                                {snapshot.notes.map((n, i) => <p key={i}>&middot; {n}</p>)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-2">Not yet processed — a settlement is priced the moment exit processing runs, not before.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Checklist Progress by Step</CardTitle></CardHeader>
              <CardContent>
                {stepChart.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={stepChart}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="name" fontSize={10} />
                      <YAxis fontSize={11} />
                      <RTooltip />
                      <Bar dataKey="completed" fill="#10b981" radius={[4, 4, 0, 0]} name="Completed" />
                      <Bar dataKey="pending" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Pending" />
                      <Legend />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Exits by Department</CardTitle></CardHeader>
              <CardContent>
                {deptDistribution.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={deptDistribution} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name }) => name}>
                        {deptDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Exit Summary</CardTitle></CardHeader>
            <CardContent>
              {leavers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No exit data.</p>
              ) : (
                <div className="space-y-2">
                  {leavers.map(({ resignation, employee }) => {
                    const pct = getClearancePercent(resignation.employeeId);
                    const stepsComplete = getClearanceCount(resignation.employeeId);
                    const displayName = nameOf(resignation, employee);
                    const phase = exitPhase(resignation, today);
                    return (
                      <div key={resignation.id} className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="text-xs bg-gradient-to-br from-red-500 to-orange-500 text-white">
                            {initialsOf(displayName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <p className="font-medium text-sm">{displayName}</p>
                          <p className="text-xs text-muted-foreground">{employee?.department ?? "—"} &middot; {employee?.designation ?? "—"}</p>
                        </div>
                        <Badge className={cn("text-xs", phase.className)}>{phase.label}</Badge>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{stepsComplete}/{OFFBOARDING_CHECKLIST_TASKS.length} tasks</span>
                          <div className="w-16">
                            <Progress value={pct} className="h-1.5" />
                          </div>
                          <span className={cn("text-xs font-medium", pct === 100 ? "text-green-600" : "text-amber-600")}>{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {STEPS.map((s) => {
              const Icon = STEP_ICONS[s.step] ?? ClipboardList;
              const completed = leavers.filter(({ resignation }) => isStepComplete(resignation.employeeId, s.step)).length;
              const pct = leavers.length ? Math.round((completed / leavers.length) * 100) : 0;
              return (
                <Card key={s.step}>
                  <CardContent className="p-3 text-center">
                    <Icon className={cn("h-5 w-5 mx-auto mb-1", pct === 100 ? "text-green-500" : "text-muted-foreground")} />
                    <p className="text-xs font-medium truncate">{s.stepName}</p>
                    <p className="text-lg font-bold">{pct}%</p>
                    <p className="text-[10px] text-muted-foreground">{completed}/{leavers.length}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
