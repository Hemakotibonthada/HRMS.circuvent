"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  LogOut, Send, CheckCircle2, Clock, CalendarClock,
  AlertCircle, Users, Calendar, PencilLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRBAC } from "@/hooks/use-rbac";
import { DataEmptyState, DataLoadingSkeleton } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// RESIGNATION — submit your own, decide on someone else's
// ═══════════════════════════════════════════════════════════════
// This is the front door of the leaver path: everything on `/offboarding`
// (the checklist, the settlement, access removal, documents) exists only for
// a resignation that started here and was accepted here. It mirrors
// `/leave` rather than `/onboarding` — one page serves both the person
// resigning (a self-service submit, exactly like applying for leave) and
// the people who decide on it (a manager or HR accepting, exactly like
// approving leave) — because that is the shape this codebase already uses
// for "an employee requests something, someone with authority decides it",
// and inventing a second shape for the same relationship would be one more
// pattern to keep in sync with no benefit.
//
// What is deliberately not here: the checklist, settlement figures and
// document status. Those belong to `/offboarding`, which is scoped to
// resignations that have already been accepted — this page's job ends the
// moment a last working day is agreed.

interface ResignationRecord {
  id: string;
  employeeId: string;
  employeeName?: string;
  status: "submitted" | "accepted";
  reason: string;
  intendedLastWorkingDay: string;
  agreedLastWorkingDay?: string;
  submittedAt: string;
  acceptedAt?: string;
  acceptedById?: string;
  exitProcessedAt?: string;
}

interface ResignationListResponse {
  items: ResignationRecord[];
  total: number;
}

const STATUS_CONF: Record<ResignationRecord["status"], { label: string; className: string }> = {
  submitted: { label: "Awaiting Decision", className: "status-pending" },
  accepted: { label: "Accepted", className: "status-active" },
};

function fmtDate(value?: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

export default function ResignationPage() {
  const { user, loading: authLoading } = useAuth();
  const rbac = useRBAC();
  const seesTeam = rbac.can("resignation.view_all");
  const canAdjust = rbac.isAdmin || rbac.isHR;

  const [mine, setMine] = useState<ResignationRecord[]>([]);
  const [team, setTeam] = useState<ResignationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("mine");
  const [form, setForm] = useState({ intendedLastWorkingDay: "", reason: "" });
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<string | null>(null);
  const [adjustDate, setAdjustDate] = useState("");

  const loadMine = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch(
        `/api/resignations?employeeId=${encodeURIComponent(user.uid)}&pageSize=50`,
        { credentials: "include" }
      );
      if (!response.ok) return;
      const body = (await response.json()) as ResignationListResponse;
      setMine(body.items ?? []);
    } catch {
      // Renders as "no resignation on file" rather than a stale one.
    }
  }, [user]);

  const loadTeam = useCallback(async () => {
    if (!seesTeam) {
      setTeam([]);
      return;
    }
    try {
      const response = await fetch(`/api/resignations?pageSize=200`, { credentials: "include" });
      if (!response.ok) return;
      const body = (await response.json()) as ResignationListResponse;
      setTeam(body.items ?? []);
    } catch {
      // Same trade as loadMine — empty and honest beats stale and wrong.
    }
  }, [seesTeam]);

  useEffect(() => {
    if (authLoading) return;
    setLoading(true);
    void Promise.all([loadMine(), loadTeam()]).finally(() => setLoading(false));
  }, [authLoading, loadMine, loadTeam]);

  // The partial unique index on `resignations` (see hrms.ts) allows exactly
  // one row per employee with `exit_processed_at IS NULL` — this mirrors
  // that rule on the client so the submit form disappears the moment there
  // is already one in flight, instead of letting someone fill it in and
  // discover the conflict only from a 4xx.
  const openResignation = useMemo(() => mine.find((r) => !r.exitProcessedAt), [mine]);
  const history = useMemo(() => mine.filter((r) => r.exitProcessedAt), [mine]);

  const pendingDecision = useMemo(() => team.filter((r) => r.status === "submitted"), [team]);
  const awaitingExit = useMemo(
    () => team.filter((r) => r.status === "accepted" && !r.exitProcessedAt),
    [team]
  );
  const completedExits = useMemo(() => team.filter((r) => r.exitProcessedAt), [team]);

  const handleSubmit = async () => {
    if (!form.intendedLastWorkingDay) {
      toast.error("Pick your intended last working day");
      return;
    }
    if (form.reason.trim().length < 3) {
      toast.error("Give a reason for leaving");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/resignations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const body = (await response.json().catch(() => ({}))) as ResignationRecord & { error?: string };
      if (!response.ok) {
        toast.error(body.error ?? "Could not submit your resignation");
        return;
      }
      setMine((prev) => [body, ...prev]);
      setForm({ intendedLastWorkingDay: "", reason: "" });
      toast.success("Resignation submitted — your manager has been notified");
    } catch {
      toast.error("Could not submit your resignation");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAccept = async (r: ResignationRecord) => {
    setBusy(`accept:${r.id}`);
    try {
      const response = await fetch(`/api/resignations/${r.id}/accept`, {
        method: "POST",
        credentials: "include",
      });
      const body = (await response.json().catch(() => ({}))) as ResignationRecord & { error?: string };
      if (!response.ok) {
        toast.error(body.error ?? "Could not accept this resignation");
        return;
      }
      setTeam((prev) => prev.map((x) => (x.id === r.id ? body : x)));
      toast.success(
        `Accepted — last working day agreed for ${r.employeeName ?? "this employee"} (${fmtDate(body.agreedLastWorkingDay)})`
      );
    } catch {
      toast.error("Could not accept this resignation");
    } finally {
      setBusy(null);
    }
  };

  const handleAdjust = async (id: string) => {
    if (!adjustDate) {
      toast.error("Pick the new last working day");
      return;
    }
    setBusy(`adjust:${id}`);
    try {
      const response = await fetch(`/api/resignations/${id}/adjust-last-working-day`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ lastWorkingDay: adjustDate }),
      });
      const body = (await response.json().catch(() => ({}))) as ResignationRecord & { error?: string };
      if (!response.ok) {
        toast.error(body.error ?? "Could not adjust the last working day");
        return;
      }
      setTeam((prev) => prev.map((x) => (x.id === id ? body : x)));
      toast.success("Last working day updated — the employee has been notified");
      setAdjustTarget(null);
      setAdjustDate("");
    } catch {
      toast.error("Could not adjust the last working day");
    } finally {
      setBusy(null);
    }
  };

  const kpis = [
    {
      label: "My Resignation",
      value: openResignation ? STATUS_CONF[openResignation.status].label : "None on file",
      icon: LogOut,
      gradient: "from-red-500 to-orange-500",
    },
    ...(seesTeam
      ? [
          { label: "Pending Decision", value: pendingDecision.length, icon: Clock, gradient: "from-amber-500 to-orange-500" },
          { label: "Awaiting Exit", value: awaitingExit.length, icon: CalendarClock, gradient: "from-violet-500 to-purple-600" },
          { label: "Completed Exits", value: completedExits.length, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
        ]
      : []),
  ];

  if (loading) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Resignation</h1>
          <p className="text-muted-foreground mt-1">Submit your notice, or decide on a direct report&apos;s</p>
        </div>
      </div>

      {/* KPIs */}
      <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-4 stagger-children", seesTeam && "lg:grid-cols-4")}>
        {kpis.map((kpi) => (
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="mine" className="gap-2"><LogOut className="h-4 w-4" /> My Resignation</TabsTrigger>
          {seesTeam && (
            <TabsTrigger value="team" className="gap-2"><Users className="h-4 w-4" /> Team Resignations</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="mine" className="mt-4 space-y-4">
          {openResignation ? (
            <Card className="animate-slide-up">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Your resignation</h3>
                  <Badge className={STATUS_CONF[openResignation.status].className}>
                    {STATUS_CONF[openResignation.status].label}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{openResignation.reason}</p>
                <Separator />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Intended last working day</p>
                    <p className="font-medium">{fmtDate(openResignation.intendedLastWorkingDay)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Agreed last working day</p>
                    <p className="font-medium">
                      {openResignation.agreedLastWorkingDay ? fmtDate(openResignation.agreedLastWorkingDay) : "Not yet agreed"}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {openResignation.status === "submitted"
                    ? "Waiting on your manager or HR to accept this before a last working day is finalised."
                    : "Final settlement, document generation and access removal run automatically on your last working day — see the Offboarding page for status once that date arrives."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="animate-slide-up border-rose-200/60 dark:border-rose-900/40">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-md">
                    <LogOut className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Initiate Formal Separation Notice</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Submit formal resignation request for manager and HR review.
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 rounded-xl border bg-amber-50/50 dark:bg-amber-950/20 flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-900 dark:text-amber-200">
                    Standard notice period policy applies. Your final agreed last working day will be confirmed during the manager review consultation.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Intended Last Working Day <span className="text-destructive">*</span></Label>
                  <Input
                    type="date"
                    value={form.intendedLastWorkingDay}
                    onChange={(e) => setForm((f) => ({ ...f, intendedLastWorkingDay: e.target.value }))}
                    className="h-9 text-xs"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Primary Reason for Departure <span className="text-destructive">*</span></Label>
                  <div className="flex gap-1.5 flex-wrap mb-2">
                    {[
                      "Career Advancement & Growth",
                      "Relocation & Family",
                      "Higher Studies / Education",
                      "Health & Well-being",
                      "Better Compensation",
                      "Entrepreneurship / Sabbatical",
                    ].map((reasonChip) => (
                      <button
                        key={reasonChip}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, reason: reasonChip }))}
                        className={cn(
                          "px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer",
                          form.reason === reasonChip
                            ? "bg-rose-50 dark:bg-rose-950/40 border-rose-500 text-rose-700 dark:text-rose-300 font-bold"
                            : "bg-muted/40 hover:bg-muted text-muted-foreground border-border"
                        )}
                      >
                        {reasonChip}
                      </button>
                    ))}
                  </div>
                  <Textarea
                    placeholder="Provide additional details or context for management and HR exit interview..."
                    rows={4}
                    value={form.reason}
                    onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                    className="text-xs resize-none"
                    required
                  />
                </div>

                <Button
                  className="bg-gradient-to-r from-rose-500 to-red-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all gap-1.5"
                  disabled={submitting}
                  onClick={() => void handleSubmit()}
                >
                  <Send className="h-4 w-4" /> {submitting ? "Submitting…" : "Submit Formal Notice"}
                </Button>
              </CardContent>
            </Card>
          )}

          {history.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Previous resignations</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {history.map((r) => (
                  <div key={r.id} className="flex items-center justify-between p-3 rounded-lg border text-sm">
                    <div>
                      <p className="font-medium">{fmtDate(r.agreedLastWorkingDay ?? r.intendedLastWorkingDay)}</p>
                      <p className="text-xs text-muted-foreground">{r.reason}</p>
                    </div>
                    <Badge variant="outline" className="border-green-500 text-green-600">Processed</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {seesTeam && (
          <TabsContent value="team" className="mt-4 space-y-6">
            <div>
              <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" /> Pending Decision
              </h3>
              {pendingDecision.length === 0 ? (
                <DataEmptyState icon={CheckCircle2} title="Nothing waiting" description="No resignations need a decision right now." />
              ) : (
                <div className="space-y-3 stagger-children">
                  {pendingDecision.map((r) => (
                    <Card key={r.id}>
                      <CardContent className="p-4 flex items-center gap-4">
                        <Avatar className="h-10 w-10">
                          <AvatarFallback className="bg-gradient-to-br from-red-500 to-orange-500 text-white text-sm">
                            {(r.employeeName ?? "?").split(" ").map((p) => p[0]).join("").slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm">{r.employeeName ?? "Unknown employee"}</p>
                          <p className="text-xs text-muted-foreground truncate">{r.reason}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Submitted {fmtDate(r.submittedAt)} &middot; Intends to leave {fmtDate(r.intendedLastWorkingDay)}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          className="bg-gradient-to-r from-emerald-500 to-green-600 text-white border-0 gap-1"
                          disabled={r.employeeId === user?.uid || busy === `accept:${r.id}`}
                          title={r.employeeId === user?.uid ? "You cannot accept your own resignation" : undefined}
                          onClick={() => void handleAccept(r)}
                        >
                          <CheckCircle2 className="h-3 w-3" /> {busy === `accept:${r.id}` ? "Accepting…" : "Accept"}
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-violet-500" /> Awaiting Exit
              </h3>
              {awaitingExit.length === 0 ? (
                <DataEmptyState icon={CalendarClock} title="Nobody in notice period" description="Accepted resignations awaiting their last working day appear here." />
              ) : (
                <div className="space-y-3 stagger-children">
                  {awaitingExit.map((r) => (
                    <Card key={r.id}>
                      <CardContent className="p-4 flex items-center gap-4">
                        <Avatar className="h-10 w-10">
                          <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-sm">
                            {(r.employeeName ?? "?").split(" ").map((p) => p[0]).join("").slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm">{r.employeeName ?? "Unknown employee"}</p>
                          <p className="text-xs text-muted-foreground">
                            Last working day: <span className="font-medium">{fmtDate(r.agreedLastWorkingDay)}</span>
                          </p>
                        </div>
                        {canAdjust && (
                          adjustTarget === r.id ? (
                            <div className="flex items-center gap-2">
                              <Input
                                type="date"
                                className="h-8 w-40"
                                value={adjustDate}
                                onChange={(e) => setAdjustDate(e.target.value)}
                              />
                              <Button size="sm" disabled={busy === `adjust:${r.id}`} onClick={() => void handleAdjust(r.id)}>
                                Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => { setAdjustTarget(null); setAdjustDate(""); }}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm" variant="outline" className="gap-1"
                              onClick={() => { setAdjustTarget(r.id); setAdjustDate(r.agreedLastWorkingDay ?? ""); }}
                            >
                              <PencilLine className="h-3 w-3" /> Adjust Date
                            </Button>
                          )
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {completedExits.length > 0 && (
              <div>
                <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Recently Completed
                </h3>
                <div className="space-y-2">
                  {completedExits.slice(0, 10).map((r) => (
                    <div key={r.id} className="flex items-center gap-4 p-3 rounded-lg border text-sm">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs bg-gradient-to-br from-emerald-500 to-green-600 text-white">
                          {(r.employeeName ?? "?").split(" ").map((p) => p[0]).join("").slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="font-medium">{r.employeeName ?? "Unknown employee"}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" /> Left {fmtDate(r.agreedLastWorkingDay)}
                        </p>
                      </div>
                      <Badge variant="outline" className="border-green-500 text-green-600">Exit processed</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
