"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Users, Target, TrendingUp, Search, ChevronRight,
  Award, Clock, Star, Shield, Briefcase, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEmployeeStore, useGoalStore, startSync, type EmployeeDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// SUCCESSION PLANNING — Key positions, readiness matrix, candidates
// ═══════════════════════════════════════════════════════════════

const READINESS_LEVELS = ["Ready Now", "1-2 Years", "3+ Years"] as const;
const READINESS_COLORS: Record<string, string> = {
  "Ready Now": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "1-2 Years": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "3+ Years": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};
const GRADIENTS = ["from-violet-500 to-purple-600", "from-blue-500 to-cyan-500", "from-emerald-500 to-green-600", "from-amber-500 to-orange-500", "from-pink-500 to-rose-600"];

interface SuccessionPlan {
  id: string;
  position: string;
  department: string;
  currentHolder: string;
  criticality: "High" | "Medium" | "Low";
  candidates: { employeeId: string; name: string; readiness: typeof READINESS_LEVELS[number]; goalCompletion: number }[];
}

export default function SuccessionPage() {
  const empStore = useEmployeeStore();
  const goalStore = useGoalStore();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [selectedPlan, setSelectedPlan] = useState<SuccessionPlan | null>(null);

  useEffect(() => {
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
    if (!goalStore.initialized) startSync(COLLECTIONS.goals, goalStore);
  }, [empStore, goalStore]);

  const loading = empStore.loading && !empStore.initialized;

  // Plans seeded from leadership roles, derived rather than pushed into state
  // by an effect. The effect version rendered an empty page first and then
  // re-rendered with content, and re-ran whenever plans.length changed.
  const seededPlans = useMemo<SuccessionPlan[]>(() => {
    const leaderRoles = empStore.items.filter(e =>
      e.designation?.toLowerCase().includes("manager") ||
      e.designation?.toLowerCase().includes("director") ||
      e.designation?.toLowerCase().includes("head") ||
      e.designation?.toLowerCase().includes("lead")
    );

    return leaderRoles.slice(0, 6).map((e, i) => ({
      id: `sp-${i}`,
      position: e.designation,
      department: e.department,
      currentHolder: `${e.firstName} ${e.lastName}`,
      criticality: (i < 2 ? "High" : i < 4 ? "Medium" : "Low") as SuccessionPlan["criticality"],
      candidates: [] as SuccessionPlan["candidates"],
    }));
  }, [empStore.items]);

  // "Add Plan"/"Add Candidate" used to write into a parallel edited-plans
  // layer that only ever existed in this component's state — refresh the
  // tab, or open it on another machine, and it was gone, even though the
  // toast that followed said "added". There is no succession endpoint to
  // persist to (no `succession` entry in COLLECTIONS, see
  // collection-service.ts), so rather than keep faking a save this page now
  // only shows what is honestly derivable from real employee records.
  const plans = seededPlans;

  const goalCompletionMap = useMemo(() => {
    const map = new Map<string, number>();
    const grouped = new Map<string, { total: number; progress: number }>();
    goalStore.items.forEach(g => {
      const key = g.employeeId;
      const existing = grouped.get(key) || { total: 0, progress: 0 };
      existing.total++;
      existing.progress += g.progress || 0;
      grouped.set(key, existing);
    });
    grouped.forEach((v, k) => map.set(k, Math.round(v.progress / v.total)));
    return map;
  }, [goalStore.items]);

  const departments = useMemo(() => [...new Set(plans.map(p => p.department))].sort(), [plans]);

  const readyNowCount = useMemo(() => plans.reduce((s, p) => s + p.candidates.filter(c => c.readiness === "Ready Now").length, 0), [plans]);
  const criticalCount = useMemo(() => plans.filter(p => p.criticality === "High").length, [plans]);
  const coverageRate = useMemo(() => {
    if (plans.length === 0) return 0;
    return Math.round((plans.filter(p => p.candidates.length > 0).length / plans.length) * 100);
  }, [plans]);

  const filtered = useMemo(() => {
    let list = plans;
    if (tab === "critical") list = list.filter(p => p.criticality === "High");
    if (tab === "uncovered") list = list.filter(p => p.candidates.length === 0);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.position.toLowerCase().includes(q) || p.department.toLowerCase().includes(q) || p.currentHolder.toLowerCase().includes(q));
    }
    return list;
  }, [plans, tab, search]);

  if (loading) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Succession Planning</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{plans.length} positions · {coverageRate}% coverage</p>
        </div>
        {/*
          An "Add Plan" button used to sit here, opening a dialog that only
          ever wrote into local component state. The toast said "Plan
          added"; nothing was added anywhere durable, and no one else viewing
          this page would ever see it. There is no succession API to save a
          plan to, so the control is gone rather than left promising a save
          that can't happen.
        */}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Key Positions", value: plans.length, icon: Briefcase, color: "from-violet-500 to-purple-600" },
          { label: "Critical Roles", value: criticalCount, icon: Shield, color: "from-red-500 to-rose-600" },
          { label: "Ready Now", value: readyNowCount, icon: Star, color: "from-emerald-500 to-green-600" },
          { label: "Coverage", value: `${coverageRate}%`, icon: BarChart3, color: "from-blue-500 to-cyan-500" },
        ].map(kpi => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.color)}>
                <kpi.icon className="h-5 w-5 text-white" />
              </div>
              <div><p className="text-xs text-muted-foreground">{kpi.label}</p><p className="text-lg font-bold">{kpi.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search positions, departments…" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All ({plans.length})</TabsTrigger>
          <TabsTrigger value="critical">Critical ({criticalCount})</TabsTrigger>
          <TabsTrigger value="uncovered">Uncovered ({plans.filter(p => p.candidates.length === 0).length})</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          {filtered.length === 0 ? (
            <DataEmptyState icon={Users} title="No succession plans" description="Positions here are derived from employees whose title includes manager, director, head, or lead — none currently match." />
          ) : (
            <div className="space-y-3">
              {filtered.map(plan => (
                <Card key={plan.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedPlan(plan)}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", GRADIENTS[plans.indexOf(plan) % GRADIENTS.length])}>
                        <Briefcase className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-sm">{plan.position}</h3>
                        <p className="text-xs text-muted-foreground">{plan.department} · Current: {plan.currentHolder}</p>
                      </div>
                      <Badge className={cn("text-xs", plan.criticality === "High" ? "bg-red-100 text-red-700" : plan.criticality === "Medium" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700")}>{plan.criticality}</Badge>
                      <Badge variant="secondary" className="text-xs">{plan.candidates.length} candidate(s)</Badge>
                    </div>
                    {plan.candidates.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {plan.candidates.map((c, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <Avatar className="h-6 w-6">
                              <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-[10px]">
                                {c.name.split(" ").map(n => n[0]).join("")}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-xs">{c.name}</span>
                            <Badge className={cn("text-[10px]", READINESS_COLORS[c.readiness])}>{c.readiness}</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedPlan} onOpenChange={() => setSelectedPlan(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{selectedPlan?.position} — Succession</DialogTitle></DialogHeader>
          {selectedPlan && (
            <div className="space-y-4">
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">Department:</span> {selectedPlan.department}</p>
                <p><span className="text-muted-foreground">Current Holder:</span> {selectedPlan.currentHolder}</p>
              </div>
              <h4 className="text-sm font-semibold">Candidates ({selectedPlan.candidates.length})</h4>
              {selectedPlan.candidates.length === 0 ? (
                <p className="text-xs text-muted-foreground">No candidates added yet.</p>
              ) : (
                <div className="space-y-2">
                  {selectedPlan.candidates.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                      <Avatar className="h-8 w-8"><AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-xs">{c.name.split(" ").map(n => n[0]).join("")}</AvatarFallback></Avatar>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{c.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge className={cn("text-[10px]", READINESS_COLORS[c.readiness])}>{c.readiness}</Badge>
                          <span className="text-[10px] text-muted-foreground">Goals: {c.goalCompletion}%</span>
                        </div>
                      </div>
                      <Progress value={c.goalCompletion} className="h-1.5 w-16" />
                    </div>
                  ))}
                </div>
              )}
              {/*
                An "Add Candidate" form used to sit here (employee + readiness
                selects, a "candidate added" toast). It wrote into the same
                local-only state as "Add Plan" above and vanished on refresh
                for the same reason: no succession endpoint exists to persist
                a candidate to. Removed rather than left implying a save that
                never happens; candidates above are exactly what has actually
                been recorded, which today is none.
              */}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}