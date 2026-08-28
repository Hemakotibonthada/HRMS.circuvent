"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Users, TrendingDown, Heart, AlertTriangle, Building2, Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip,
} from "recharts";
import {
  useEmployeeStore, useDepartmentStore, useGoalStore, useLeaveStore,
  startSync,
} from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// ORG HEALTH — Organization health dashboard
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];

export default function OrgHealthPage() {
  const empStore = useEmployeeStore();
  const deptStore = useDepartmentStore();
  const goalStore = useGoalStore();
  const leaveStore = useLeaveStore();
  const { items: employees, loading, initialized } = empStore;
  const { items: departments } = deptStore;
  const { items: goals } = goalStore;
  const { items: leaves } = leaveStore;
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
    if (!deptStore.initialized) startSync(COLLECTIONS.departments, deptStore);
    if (!goalStore.initialized) startSync(COLLECTIONS.goals, goalStore);
    if (!leaveStore.initialized) startSync(COLLECTIONS.leaves, leaveStore);
  }, [empStore, deptStore, goalStore, leaveStore]);

  // Attrition rate — a real ratio of employees currently marked exiting/resigned/terminated.
  // Renamed from "Attrition Risk": this is a point-in-time snapshot of status values, not a
  // predictive risk model, so "Risk" claimed more than the number actually measures.
  const attritionRisk = useMemo(() => {
    const exiting = employees.filter(e => e.status === "exiting" || e.status === "resigned" || e.status === "terminated").length;
    return employees.length > 0 ? Math.round((exiting / employees.length) * 100) : 0;
  }, [employees]);

  // Average goal progress — a plain average of the real `progress` field on each goal.
  // Replaces a fabricated "Engagement Score" that arbitrarily weighted goal counts
  // (completed goals counted 2x, active goals 1x, divided by an invented denominator)
  // and defaulted to 60% when there were no goals at all. Neither the weighting nor the
  // fallback measured anything real, and goal completion isn't employee engagement —
  // there is no survey or sentiment data anywhere in this app to measure that from.
  const orgAvgGoalProgress = useMemo(() => {
    return goals.length > 0 ? Math.round(goals.reduce((s, g) => s + (g.progress || 0), 0) / goals.length) : 0;
  }, [goals]);

  // Overdue goals — a real count of goals whose status is explicitly "Overdue" (the same
  // status value performancesuite/page.tsx renders), not a progress-threshold guess.
  const overdueGoalsCount = useMemo(() => {
    return goals.filter(g => g.status === "Overdue").length;
  }, [goals]);

  // Department stats — real per-department headcount, active rate, goal progress and
  // leave days. This used to also compute a "score" from these via invented weights
  // (40% active rate, 30% goal progress, an unexplained leave-day penalty) plus an
  // invented 20-point fallback for departments with zero employees, then rendered that
  // score with a Healthy/Fair/At-Risk badge as if it were a measured department health
  // metric. It wasn't — removed; the real numbers below are shown as-is instead.
  const deptHealth = useMemo(() => {
    return departments.map(dept => {
      const deptEmps = employees.filter(e => e.department === dept.name);
      const activeCount = deptEmps.filter(e => e.status === "active").length;
      const deptGoals = goals.filter(g => deptEmps.some(e => e.id === g.employeeId));
      const avgGoalProgress = deptGoals.length > 0
        ? Math.round(deptGoals.reduce((s, g) => s + (g.progress || 0), 0) / deptGoals.length)
        : 0;
      const deptLeaves = leaves.filter(l => l.department === dept.name && l.status === "approved");
      const leavedays = deptLeaves.reduce((s, l) => s + (l.days || 0), 0);
      return {
        name: dept.name, headcount: deptEmps.length,
        activeRate: deptEmps.length > 0 ? Math.round((activeCount / deptEmps.length) * 100) : 0,
        goalProgress: avgGoalProgress, leaveDays: leavedays,
      };
    });
  }, [departments, employees, goals, leaves]);

  // Headcount trend (by employment type)
  const headcountData = useMemo(() => {
    const types: Record<string, number> = {};
    employees.forEach(e => {
      types[e.employmentType || "Full-time"] = (types[e.employmentType || "Full-time"] || 0) + 1;
    });
    return Object.entries(types).map(([name, value]) => ({ name, value }));
  }, [employees]);

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && employees.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.analytics} />;
  }

  const kpis = [
    { label: "Headcount", value: employees.length, icon: Users, gradient: "from-blue-500 to-cyan-500",
      sub: `${employees.filter(e => e.status === "active").length} active` },
    { label: "Attrition Rate", value: `${attritionRisk}%`, icon: TrendingDown, gradient: "from-red-500 to-orange-500",
      sub: attritionRisk <= 5 ? "Low" : attritionRisk <= 15 ? "Medium" : "High" },
    { label: "Avg Goal Progress", value: `${orgAvgGoalProgress}%`, icon: Target, gradient: "from-emerald-500 to-green-600",
      sub: orgAvgGoalProgress >= 70 ? "On track" : orgAvgGoalProgress >= 40 ? "Moderate" : "Behind" },
    { label: "Overdue Goals", value: overdueGoalsCount, icon: AlertTriangle, gradient: "from-amber-500 to-orange-600",
      sub: overdueGoalsCount === 0 ? "None" : "Needs follow-up" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Organization Health</h1>
        <p className="text-muted-foreground mt-1">Real workforce data: headcount, attrition, and goal progress across departments</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                  <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{kpi.sub}</p>
                </div>
                <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.gradient)}>
                  <kpi.icon className="h-5 w-5 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="wellbeing">Wellbeing</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          {/*
            Removed: a "Health Dimensions" radar chart with six axes. Four were fabricated —
            "Attendance" was attrition math relabeled (this app has no attendance data),
            "Wellbeing" and "Development" were composites built from the invented scores
            below, and "Engagement" reused the fabricated engagement score. The two real
            axes it had (Retention, Goal Progress) are already shown as plain KPIs above —
            a 2-axis radar isn't meaningful on its own, so it's gone rather than kept half-empty.
          */}
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Headcount by Employment Type</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={headcountData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <RTooltip />
                  <Bar dataKey="value" name="Count" fill="#8b5cf6" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/*
            Removed: a "Risk Indicators" card. Two of its three tiles ("Attrition Risk",
            "Overdue Goals") only duplicated the KPIs above under different names. The
            third, "Unfilled Positions", multiplied a declared-vs-actual headcount gap by
            an arbitrary x3 with no stated basis and rendered the result with a "%" suffix
            even though it was never a percentage. A card that was two-thirds redundant and
            one-third invented isn't worth keeping, so it's removed rather than patched.
          */}
        </TabsContent>

        <TabsContent value="departments" className="space-y-3 mt-4">
          {/*
            Removed: a per-department "Health Score" with a Healthy/Fair/At-Risk badge. It
            was computed from invented weights (40% active rate, 30% goal progress, an
            unexplained leave-day penalty) plus an invented 20-point fallback for
            departments with zero employees — none of that was a measured health metric.
            The real per-department numbers are shown below as-is instead.
          */}
          {deptHealth.length === 0 ? (
            <DataEmptyState icon={Building2} title="No departments" description="Add departments to see their stats." compact />
          ) : deptHealth.map(dept => (
            <Card key={dept.name} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-violet-500 to-purple-600">
                    <Building2 className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{dept.name}</h3>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>{dept.headcount} employees</span>
                      <span>{dept.activeRate}% active</span>
                      <span>Goal avg: {dept.goalProgress}%</span>
                      <span>{dept.leaveDays} leave days taken</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="wellbeing" className="space-y-4 mt-4">
          {/*
            This tab used to show "Work-Life Balance", "Stress Index", "Team Morale" and
            "Burnout Risk" scores plus an overall "Wellbeing Score" that told the org it
            was "in good shape". None of it was real: this app has no attendance,
            sentiment, or survey data to measure wellbeing from — the numbers were leave-
            rejection and low-progress-goal counts run through arbitrary floors and
            multipliers, then relabeled as feelings. Asserting a wellbeing verdict the
            system never measured is worse than admitting it isn't tracked yet.
          */}
          <DataEmptyState
            icon={Heart}
            title="Wellbeing isn't measured yet"
            description="This needs real survey, sentiment, or attendance data, none of which this app currently collects. An employee pulse survey would be the natural next step before this tab can show anything real."
            compact
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
