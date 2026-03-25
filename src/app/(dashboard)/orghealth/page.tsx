"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Activity, Users, TrendingDown, TrendingUp, Heart, Brain,
  AlertTriangle, Building2, Target, CalendarDays, Award,
  BarChart3, Shield, Smile, Frown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  AreaChart, Area, Tooltip as RTooltip, Legend,
} from "recharts";
import {
  useEmployeeStore, useDepartmentStore, useGoalStore, useLeaveStore,
  startSync,
} from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/firestore-service";
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

  // Overall health score (composite)
  const healthScore = useMemo(() => {
    if (employees.length === 0) return 0;
    const activeRate = employees.filter(e => e.status === "active").length / employees.length;
    const goalProgress = goals.length > 0 ? goals.reduce((s, g) => s + (g.progress || 0), 0) / goals.length / 100 : 0.5;
    const leaveRate = leaves.length > 0 ? 1 - (leaves.filter(l => l.status === "approved").reduce((s, l) => s + (l.days || 0), 0) / (employees.length * 20)) : 0.8;
    return Math.round((activeRate * 40 + goalProgress * 30 + Math.max(0, leaveRate) * 30));
  }, [employees, goals, leaves]);

  // Attrition risk
  const attritionRisk = useMemo(() => {
    const exiting = employees.filter(e => e.status === "exiting" || e.status === "resigned" || e.status === "terminated").length;
    return employees.length > 0 ? Math.round((exiting / employees.length) * 100) : 0;
  }, [employees]);

  // Engagement metric (derived from goals & leaves)
  const engagementScore = useMemo(() => {
    const goalsActive = goals.filter(g => g.status === "Active" || g.status === "In Progress").length;
    const goalsCompleted = goals.filter(g => g.status === "Completed").length;
    return goals.length > 0 ? Math.round(((goalsActive + goalsCompleted * 2) / (goals.length * 2)) * 100) : 60;
  }, [goals]);

  // Department health scores
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
      const score = Math.round(
        (deptEmps.length > 0 ? (activeCount / deptEmps.length) * 40 : 20) +
        avgGoalProgress * 0.3 +
        Math.max(0, 30 - leavedays * 0.5)
      );
      return {
        name: dept.name, headcount: deptEmps.length,
        activeRate: deptEmps.length > 0 ? Math.round((activeCount / deptEmps.length) * 100) : 0,
        goalProgress: avgGoalProgress, leaveDays: leavedays, score: Math.min(100, score),
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

  // Radar chart dimensions
  const radarData = useMemo(() => [
    { dimension: "Retention", value: Math.max(0, 100 - attritionRisk) },
    { dimension: "Goal Progress", value: goals.length > 0 ? Math.round(goals.reduce((s, g) => s + (g.progress || 0), 0) / goals.length) : 50 },
    { dimension: "Engagement", value: engagementScore },
    { dimension: "Attendance", value: Math.min(95, 100 - attritionRisk + 10) },
    { dimension: "Wellbeing", value: Math.round((healthScore + engagementScore) / 2) },
    { dimension: "Development", value: goals.filter(g => g.category === "Development" || g.category === "Training").length > 0 ? 70 : 50 },
  ], [attritionRisk, goals, engagementScore, healthScore]);

  // Wellbeing metrics
  const wellbeingMetrics = useMemo(() => [
    { label: "Work-Life Balance", value: Math.max(40, 100 - leaves.filter(l => l.status === "rejected").length * 10), icon: Heart },
    { label: "Stress Index", value: Math.max(20, 100 - goals.filter(g => (g.progress || 0) < 30).length * 15), icon: Brain },
    { label: "Team Morale", value: engagementScore, icon: Smile },
    { label: "Burnout Risk", value: Math.min(100, attritionRisk * 2 + 10), icon: Frown },
  ], [leaves, goals, engagementScore, attritionRisk]);

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && employees.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.analytics} />;
  }

  const kpis = [
    { label: "Health Score", value: `${healthScore}%`, icon: Activity, gradient: "from-violet-500 to-purple-600",
      sub: healthScore >= 70 ? "Healthy" : healthScore >= 50 ? "Needs Attention" : "Critical" },
    { label: "Attrition Risk", value: `${attritionRisk}%`, icon: TrendingDown, gradient: "from-red-500 to-orange-500",
      sub: attritionRisk <= 5 ? "Low" : attritionRisk <= 15 ? "Medium" : "High" },
    { label: "Engagement", value: `${engagementScore}%`, icon: Award, gradient: "from-emerald-500 to-green-600",
      sub: engagementScore >= 70 ? "High" : engagementScore >= 50 ? "Moderate" : "Low" },
    { label: "Headcount", value: employees.length, icon: Users, gradient: "from-blue-500 to-cyan-500",
      sub: `${employees.filter(e => e.status === "active").length} active` },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Organization Health</h1>
        <p className="text-muted-foreground mt-1">Holistic view of workforce health, engagement &amp; attrition</p>
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Radar Chart */}
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Health Dimensions</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} />
                    <Radar name="Score" dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.3} />
                    <RTooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            {/* Headcount by Type */}
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
          </div>

          {/* Risk Indicators */}
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Risk Indicators</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { label: "Attrition Risk", value: attritionRisk, color: attritionRisk > 15 ? "red" : attritionRisk > 5 ? "amber" : "emerald" },
                  { label: "Unfilled Positions", value: Math.max(0, departments.reduce((s, d) => s + (d.employees || 0), 0) - employees.length) * 3, color: "amber" },
                  { label: "Overdue Goals", value: Math.round(goals.filter(g => (g.progress || 0) < 30 && g.status === "Active").length / Math.max(1, goals.length) * 100), color: "red" },
                ].map(r => (
                  <div key={r.label} className="p-4 rounded-lg bg-muted/30 text-center">
                    <AlertTriangle className={cn("h-5 w-5 mx-auto mb-2", `text-${r.color}-500`)} />
                    <p className="text-2xl font-bold">{r.value}%</p>
                    <p className="text-sm text-muted-foreground">{r.label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="departments" className="space-y-3 mt-4">
          {deptHealth.length === 0 ? (
            <DataEmptyState icon={Building2} title="No departments" description="Add departments to see health scores." compact />
          ) : deptHealth.map(dept => (
            <Card key={dept.name} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center bg-gradient-to-br",
                      dept.score >= 70 ? "from-emerald-500 to-green-600" : dept.score >= 50 ? "from-amber-500 to-orange-500" : "from-red-500 to-rose-600")}>
                      <Building2 className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{dept.name}</h3>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span>{dept.headcount} employees</span>
                        <span>{dept.activeRate}% active</span>
                        <span>Goal avg: {dept.goalProgress}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right w-24">
                      <p className="text-lg font-bold">{dept.score}%</p>
                      <Progress value={dept.score} className={cn("h-2",
                        dept.score < 50 ? "[&>div]:bg-red-500" : dept.score < 70 ? "[&>div]:bg-amber-500" : "")} />
                    </div>
                    <Badge className={cn(
                      dept.score >= 70 ? "status-active" : dept.score >= 50 ? "status-pending" : "status-rejected"
                    )}>
                      {dept.score >= 70 ? "Healthy" : dept.score >= 50 ? "Fair" : "At Risk"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="wellbeing" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {wellbeingMetrics.map(m => (
              <Card key={m.label} className="border-0 shadow-sm">
                <CardContent className="p-5 text-center">
                  <m.icon className={cn("h-8 w-8 mx-auto mb-3",
                    m.value >= 70 ? "text-emerald-500" : m.value >= 40 ? "text-amber-500" : "text-red-500")} />
                  <p className="text-3xl font-bold">{m.value}%</p>
                  <p className="text-sm text-muted-foreground mt-1">{m.label}</p>
                  <Progress value={m.value} className={cn("h-2 mt-3",
                    m.value < 40 ? "[&>div]:bg-red-500" : m.value < 70 ? "[&>div]:bg-amber-500" : "")} />
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Wellbeing Pulse</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Organization wellbeing is computed from leave patterns, goal progress, attrition data, and engagement metrics.
              </p>
              <div className="p-4 rounded-lg bg-gradient-to-r from-violet-500/10 to-purple-500/10 text-center">
                <p className="text-sm text-muted-foreground">Overall Wellbeing Score</p>
                <p className="text-4xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent mt-1">
                  {Math.round((healthScore + engagementScore) / 2)}%
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {Math.round((healthScore + engagementScore) / 2) >= 70 ? "Your organization is in good shape!" : "Some areas need attention."}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
