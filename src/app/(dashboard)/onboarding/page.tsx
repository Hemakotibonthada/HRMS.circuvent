"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  UserPlus, Search, CheckCircle2, Clock, Users,
  Calendar, ListChecks, Target, AlertCircle, Briefcase,
  ChevronRight, Eye, Star, Shield, ChevronDown, Award,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useEmployeeStore, startSync, type EmployeeDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, PieChart, Pie, Cell, Legend,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// ONBOARDING — New joiner checklist, phase tracking, buddy
// assignment, and onboarding task management
// ═══════════════════════════════════════════════════════════════

const PHASES = [
  { key: "pre", label: "Pre-boarding", color: "from-blue-500 to-cyan-500", tasks: ["Offer letter signed", "Background check", "IT equipment ordered", "Email account created", "Welcome kit prepared"] },
  { key: "week1", label: "Week 1", color: "from-violet-500 to-purple-600", tasks: ["Office tour", "Team introduction", "System access setup", "Policy acknowledgement", "First 1-on-1 with manager"] },
  { key: "month1", label: "Month 1", color: "from-emerald-500 to-green-600", tasks: ["Department orientation", "Role-specific training", "30-day check-in", "Benefits enrollment", "Company culture session"] },
  { key: "month2_3", label: "Month 2-3", color: "from-amber-500 to-orange-500", tasks: ["60-day performance review", "Cross-team collaboration", "Advanced tool training", "Goals setting", "90-day completion review"] },
];

/**
 * Task keys are derived from the phase and the task text, so the same task
 * always maps to the same row. Slugified rather than used raw because the key
 * is a stable identifier — re-wording "First 1-on-1 with manager" should not
 * orphan everyone's tick.
 */
function taskKeyFor(phase: string, task: string): string {
  return `${phase}__${task.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

/** Which onboarding steps block completion. */
const MANDATORY_TASKS = new Set([
  "Offer letter signed",
  "Background check",
  "System access setup",
  "Policy acknowledgement",
]);

interface LifecycleTask {
  id: string;
  taskKey: string;
  title: string;
  completed: boolean;
}

interface LifecycleJourney {
  id: string;
  employeeId: string;
  status: string;
  progress: { total: number; completed: number; percent: number };
  blocking: { taskKey: string; title: string }[];
  tasks: LifecycleTask[];
}

export default function OnboardingPage() {
  const store = useEmployeeStore();
  const { items: employees, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [tab, setTab] = useState("onboarding");
  const [selectedJoiner, setSelectedJoiner] = useState<EmployeeDoc | null>(null);
  /**
   * Onboarding checklists, keyed by employee.
   *
   * Was `useState<TaskCompletion>({})` with no request anywhere — a new
   * joiner's whole first-90-days checklist lived in one browser tab and
   * disappeared with it. Onboarding does not even toast, so the tick simply
   * vanished on refresh with nothing said.
   */
  const [journeys, setJourneys] = useState<Record<string, LifecycleJourney>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.employees, store); }, [initialized, store]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/lifecycle?kind=onboarding&limit=200", {
          credentials: "include",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { data: LifecycleJourney[] };
        if (cancelled) return;

        const byEmployee: Record<string, LifecycleJourney> = {};
        for (const journey of body.data ?? []) byEmployee[journey.employeeId] = journey;
        setJourneys(byEmployee);
      } catch {
        // Renders unticked rather than showing ticks from nowhere.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const newJoiners = useMemo(() => {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    return employees.filter(e => {
      if (!e.joiningDate) return false;
      const jd = new Date(e.joiningDate);
      return jd >= ninetyDaysAgo && (e.status === "active" || e.status === "probation");
    });
  }, [employees]);

  const filtered = useMemo(() => {
    let result = newJoiners;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(e => `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) || e.department?.toLowerCase().includes(q));
    }
    return result;
  }, [newJoiners, search]);

  const getJoinerPhase = (joiningDate: string) => {
    const jd = new Date(joiningDate);
    const now = new Date();
    const daysSince = Math.floor((now.getTime() - jd.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince < 0) return "pre";
    if (daysSince < 7) return "week1";
    if (daysSince < 30) return "month1";
    return "month2_3";
  };

  const getCompletionRate = useCallback(
    (empId: string) => journeys[empId]?.progress.percent ?? 0,
    [journeys]
  );

  const isTaskDone = useCallback(
    (empId: string, phase: string, task: string) =>
      journeys[empId]?.tasks.find((t) => t.taskKey === taskKeyFor(phase, task))?.completed ?? false,
    [journeys]
  );

  /**
   * Starts a checklist on first tick rather than up front, so listing every
   * new joiner does not write a row for each of them before anyone has done
   * anything.
   */
  const ensureJourney = useCallback(
    async (emp: EmployeeDoc): Promise<LifecycleJourney | null> => {
      const existing = journeys[emp.id];
      if (existing) return existing;

      const response = await fetch("/api/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          employeeId: emp.id,
          kind: "onboarding",
          anchorDate: emp.joiningDate ?? new Date().toISOString().slice(0, 10),
          tasks: PHASES.flatMap((phase, phaseIndex) =>
            phase.tasks.map((task) => ({
              taskKey: taskKeyFor(phase.key, task),
              title: task,
              phase: phase.key,
              phaseOrder: phaseIndex,
              mandatory: MANDATORY_TASKS.has(task),
            }))
          ),
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Could not start the onboarding checklist");
        return null;
      }

      const body = (await response.json()) as { data: LifecycleJourney };
      setJourneys((prev) => ({ ...prev, [emp.id]: body.data }));
      return body.data;
    },
    [journeys]
  );

  const toggleTask = async (emp: EmployeeDoc, phase: string, task: string) => {
    const key = taskKeyFor(phase, task);
    setSaving(`${emp.id}:${key}`);
    try {
      const journey = await ensureJourney(emp);
      if (!journey) return;

      const existing = journey.tasks.find((t) => t.taskKey === key);
      if (!existing) {
        toast.error("That task is not on this checklist");
        return;
      }

      const response = await fetch(`/api/lifecycle/tasks/${existing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ completed: !existing.completed }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        data?: LifecycleJourney;
        error?: string;
      };

      if (!response.ok || !body.data) {
        // The old version said nothing at all when a tick was lost.
        toast.error(body.error ?? "That task could not be saved");
        return;
      }

      setJourneys((prev) => ({ ...prev, [emp.id]: body.data! }));
    } catch {
      toast.error("That task could not be saved");
    } finally {
      setSaving(null);
    }
  };

  const avgCompletion = useMemo(() => {
    if (newJoiners.length === 0) return 0;
    const total = newJoiners.reduce((s, j) => s + getCompletionRate(j.id), 0);
    return Math.round(total / newJoiners.length);
  }, [newJoiners, getCompletionRate]);

  const avgDays = useMemo(() => {
    if (newJoiners.length === 0) return 0;
    const now = new Date();
    const total = newJoiners.reduce((s, j) => {
      const jd = new Date(j.joiningDate);
      return s + Math.floor((now.getTime() - jd.getTime()) / (1000 * 60 * 60 * 24));
    }, 0);
    return Math.round(total / newJoiners.length);
  }, [newJoiners]);

  const phaseDistribution = useMemo(() =>
    PHASES.map(p => ({
      name: p.label,
      count: newJoiners.filter(j => getJoinerPhase(j.joiningDate) === p.key).length,
    })),
  [newJoiners]);

  const deptDistribution = useMemo(() => {
    const map: Record<string, number> = {};
    newJoiners.forEach(j => { const d = j.department || "Unassigned"; map[d] = (map[d] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [newJoiners]);

  const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899"];

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/*
        The header used to carry an "Add Task" button claiming to append a
        custom task to a joiner's checklist. It only toasted success and
        cleared the form — nothing was written anywhere, not even to local
        state, so the "task" never appeared on any checklist. The real
        checklist (below) is generated per journey from the fixed PHASES
        list via /api/lifecycle; there is no endpoint that accepts an
        arbitrary custom task, so there was nothing honest left to wire the
        button to. Removed rather than disabled: a permanently greyed-out
        primary header action would be worse clutter than no button at all.
      */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Onboarding</h1>
          <p className="text-muted-foreground mt-1">New hire onboarding workflows and checklists</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        {[
          { label: "Active Onboardings", value: newJoiners.length, icon: UserPlus, gradient: "from-violet-500 to-purple-600" },
          { label: "Avg Completion", value: `${avgCompletion}%`, icon: Target, gradient: "from-emerald-500 to-green-600" },
          { label: "Avg Days", value: avgDays, icon: Calendar, gradient: "from-blue-500 to-cyan-500" },
          { label: "This Week", value: newJoiners.filter(j => { const d = new Date(j.joiningDate); const w = new Date(); w.setDate(w.getDate() - 7); return d >= w; }).length, icon: Clock, gradient: "from-amber-500 to-orange-500" },
        ].map(kpi => (
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
        <Input placeholder="Search new joiners..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="onboarding" className="gap-2"><ListChecks className="h-4 w-4" /> Checklists</TabsTrigger>
          <TabsTrigger value="phases" className="gap-2"><Target className="h-4 w-4" /> Phase Overview</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2"><Briefcase className="h-4 w-4" /> Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="onboarding" className="mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.onboarding} />
          ) : (
            <div className="space-y-4 stagger-children">
              {filtered.map(joiner => {
                const phase = getJoinerPhase(joiner.joiningDate);
                const phaseInfo = PHASES.find(p => p.key === phase);
                const completion = getCompletionRate(joiner.id);

                return (
                  <Card key={joiner.id} className="animate-slide-up">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4 mb-4">
                        <Avatar className="h-12 w-12">
                          <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                            {joiner.firstName?.[0]}{joiner.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <h3 className="font-semibold">{joiner.firstName} {joiner.lastName}</h3>
                          <p className="text-sm text-muted-foreground">{joiner.designation || joiner.department || "—"}</p>
                        </div>
                        <div className="text-right">
                          <Badge className={cn("text-xs", phaseInfo?.color ? `bg-gradient-to-r ${phaseInfo.color} text-white border-0` : "status-active")}>
                            {phaseInfo?.label || "Unknown"}
                          </Badge>
                          <p className="text-xs text-muted-foreground mt-1">Joined {new Date(joiner.joiningDate).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mb-3">
                        <Progress value={completion} className="flex-1 h-2" />
                        <span className="text-sm font-medium">{completion}%</span>
                      </div>
                      <Button
                        variant="ghost" size="sm" className="gap-1 mb-2"
                        onClick={() => setSelectedJoiner(selectedJoiner?.id === joiner.id ? null : joiner)}
                      >
                        <ChevronDown className={cn("h-4 w-4 transition-transform", selectedJoiner?.id === joiner.id && "rotate-180")} />
                        {selectedJoiner?.id === joiner.id ? "Collapse" : "Expand"} Checklist
                      </Button>
                      {selectedJoiner?.id === joiner.id && (
                        <div className="space-y-4 mt-2">
                          {PHASES.map(p => (
                            <div key={p.key}>
                              <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                                <div className={cn("h-2 w-2 rounded-full bg-gradient-to-r", p.color)} />
                                {p.label}
                              </h4>
                              <div className="space-y-1 ml-4">
                                {p.tasks.map(task => (
                                  <div key={task} className="flex items-center gap-2 py-1">
                                    <Checkbox
                                      checked={isTaskDone(joiner.id, p.key, task)}
                                      disabled={saving === `${joiner.id}:${taskKeyFor(p.key, task)}`}
                                      onCheckedChange={() => void toggleTask(joiner, p.key, task)}
                                      aria-label={task}
                                    />
                                    <span className={cn("text-sm", isTaskDone(joiner.id, p.key, task) && "line-through text-muted-foreground")}>{task}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                          {joiner.reportingManager && (
                            <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                              <Award className="h-4 w-4 text-violet-500" />
                              <span className="text-sm">Buddy: {joiner.reportingManager}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="phases" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PHASES.map(p => {
              const count = newJoiners.filter(j => getJoinerPhase(j.joiningDate) === p.key).length;
              return (
                <Card key={p.key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <div className={cn("h-3 w-3 rounded-full bg-gradient-to-r", p.color)} />
                      {p.label}
                      <Badge variant="outline" className="ml-auto">{count} joiners</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {p.tasks.map(task => (
                        <div key={task} className="flex items-center gap-2 text-sm p-2 rounded-lg hover:bg-muted/50">
                          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                          <span>{task}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Joiners by Phase</CardTitle></CardHeader>
              <CardContent>
                {phaseDistribution.every(p => p.count === 0) ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={phaseDistribution}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="name" fontSize={11} />
                      <YAxis fontSize={11} />
                      <RTooltip />
                      <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Joiners by Department</CardTitle></CardHeader>
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

          {/* Onboarding Completion Summary */}
          <Card>
            <CardHeader><CardTitle className="text-base">Onboarding Progress Summary</CardTitle></CardHeader>
            <CardContent>
              {newJoiners.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No active onboardings to show.</p>
              ) : (
                <div className="space-y-3">
                  {newJoiners.map(joiner => {
                    const phase = getJoinerPhase(joiner.joiningDate);
                    const phaseInfo = PHASES.find(p => p.key === phase);
                    const completion = getCompletionRate(joiner.id);
                    const daysSinceJoin = Math.floor((new Date().getTime() - new Date(joiner.joiningDate).getTime()) / (1000 * 60 * 60 * 24));
                    return (
                      <div key={joiner.id} className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="text-xs bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                            {joiner.firstName?.[0]}{joiner.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{joiner.firstName} {joiner.lastName}</p>
                          <p className="text-xs text-muted-foreground">{joiner.department} &middot; Day {daysSinceJoin}</p>
                        </div>
                        <Badge variant="outline" className="text-xs">{phaseInfo?.label}</Badge>
                        <div className="w-20">
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-muted-foreground">Done</span>
                            <span className={cn("font-medium", completion >= 75 ? "text-green-600" : completion >= 40 ? "text-amber-600" : "text-red-500")}>
                              {completion}%
                            </span>
                          </div>
                          <Progress value={completion} className="h-1.5" />
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(joiner.joiningDate).toLocaleDateString()}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Phase Task Completion Rates */}
          <Card>
            <CardHeader><CardTitle className="text-base">Task Completion by Phase</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {PHASES.map(phase => {
                  const totalTasks = phase.tasks.length * newJoiners.length;
                  const completedTasks = newJoiners.reduce((s, j) => {
                    return s + phase.tasks.filter(t => isTaskDone(j.id, phase.key, t)).length;
                  }, 0);
                  const phasePct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
                  return (
                    <div key={phase.key} className="p-4 rounded-lg border">
                      <div className="flex items-center gap-2 mb-3">
                        <div className={cn("h-3 w-3 rounded-full bg-gradient-to-r", phase.color)} />
                        <h4 className="font-medium text-sm">{phase.label}</h4>
                      </div>
                      <div className="space-y-2">
                        {phase.tasks.map(task => {
                          const taskDone = newJoiners.filter(j => isTaskDone(j.id, phase.key, task)).length;
                          return (
                            <div key={task} className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground truncate max-w-[60%]">{task}</span>
                              <span className="font-medium">{taskDone}/{newJoiners.length}</span>
                            </div>
                          );
                        })}
                        <Separator className="my-1" />
                        <div className="flex items-center gap-2">
                          <Progress value={phasePct} className="flex-1 h-2" />
                          <span className="text-xs font-medium">{phasePct}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
