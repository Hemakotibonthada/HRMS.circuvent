"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Brain, AlertTriangle, TrendingUp, Target, Users,
  Search, Zap, Shield, ArrowUpRight, BarChart3,
  Eye, Lightbulb, Flame, UserMinus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend,
  Tooltip as RTooltip,
} from "recharts";
import {
  useEmployeeStore, useGoalStore, useLeaveStore, startSync,
} from "@/stores/unified-store";
import { COLLECTIONS, genericService } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];

const SEVERITY_CONF: Record<string, { label: string; className: string }> = {
  critical: { label: "Critical", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  high: { label: "High", className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  medium: { label: "Medium", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  low: { label: "Low", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
};

interface Insight {
  id: string;
  type: string;
  title: string;
  description: string;
  severity: string;
  metric: string;
  affectedCount: number;
  icon: typeof Brain;
}

export default function IntelligencePage() {
  const empStore = useEmployeeStore();
  const goalStore = useGoalStore();
  const leaveStore = useLeaveStore();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");

  useEffect(() => {
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
    if (!goalStore.initialized) startSync(COLLECTIONS.goals, goalStore);
    if (!leaveStore.initialized) startSync(COLLECTIONS.leaves, leaveStore);
  }, [empStore, goalStore, leaveStore]);

  const insights = useMemo((): Insight[] => {
    const result: Insight[] = [];
    const emps = empStore.items;
    const goals = goalStore.items;
    const leaves = leaveStore.items;

    // Flight risk: employees with high leave frequency and low goal progress
    const highLeaveEmps = new Set<string>();
    leaves.forEach(l => {
      if (l.status === "approved") highLeaveEmps.add(l.employeeId);
    });
    const flightRiskEmps = emps.filter(e => {
      const empLeaves = leaves.filter(l => l.employeeId === e.id && l.status === "approved");
      const empGoals = goals.filter(g => g.employeeId === e.id);
      // An employee with no goals has no progress figure to be low, so the
      // old code invented one ("50", i.e. a passing grade) to plug into the
      // comparison below. That silently exempted every goal-less employee
      // from this signal regardless of their leave frequency. Abstaining
      // when there is nothing to measure is honest; inventing a number that
      // happens to clear the threshold is not.
      if (empGoals.length === 0) return false;
      const avgProgress = empGoals.reduce((s, g) => s + (g.progress || 0), 0) / empGoals.length;
      return empLeaves.length > 5 && avgProgress < 40;
    });
    if (flightRiskEmps.length > 0) {
      result.push({
        id: "flight-risk", type: "retention", title: "Flight Risk Detected",
        description: `${flightRiskEmps.length} employee(s) show high leave frequency with low goal progress.`,
        severity: "critical", metric: `${flightRiskEmps.length} employees`, affectedCount: flightRiskEmps.length, icon: Flame,
      });
    }

    // Skill gaps: departments with few employees having skills
    const depts = [...new Set(emps.map(e => e.department))];
    const lowSkillDepts = depts.filter(d => {
      const deptEmps = emps.filter(e => e.department === d);
      const withSkills = deptEmps.filter(e => e.skills && e.skills.length > 0);
      return deptEmps.length > 2 && withSkills.length / deptEmps.length < 0.5;
    });
    if (lowSkillDepts.length > 0) {
      result.push({
        id: "skill-gaps", type: "development", title: "Skill Gaps Identified",
        description: `${lowSkillDepts.length} department(s) have less than 50% employees with documented skills.`,
        severity: "high", metric: `${lowSkillDepts.length} departments`, affectedCount: lowSkillDepts.length, icon: Target,
      });
    }

    // Bench analysis: employees with no goals
    const noGoalEmps = emps.filter(e => e.status === "active" && !goals.some(g => g.employeeId === e.id));
    if (noGoalEmps.length > 0) {
      result.push({
        id: "bench", type: "productivity", title: "Bench/Unassigned Employees",
        description: `${noGoalEmps.length} active employee(s) have no goals assigned.`,
        severity: noGoalEmps.length > 10 ? "high" : "medium",
        metric: `${noGoalEmps.length} employees`, affectedCount: noGoalEmps.length, icon: UserMinus,
      });
    }

    // Goal completion rate
    const completedGoals = goals.filter(g => g.status === "completed" || g.progress >= 100).length;
    const goalRate = goals.length > 0 ? Math.round((completedGoals / goals.length) * 100) : 0;
    if (goals.length > 0) {
      result.push({
        id: "goal-rate", type: "performance", title: "Goal Completion Rate",
        description: `Overall goal completion is at ${goalRate}%. ${goalRate < 50 ? "Needs attention." : "On track."}`,
        severity: goalRate < 30 ? "critical" : goalRate < 50 ? "high" : goalRate < 75 ? "medium" : "low",
        metric: `${goalRate}%`, affectedCount: goals.length, icon: TrendingUp,
      });
    }

    // Leave utilization
    const totalLeaveDays = leaves.filter(l => l.status === "approved").reduce((s, l) => s + (l.days || 1), 0);
    if (totalLeaveDays > 0) {
      result.push({
        id: "leave-util", type: "wellness", title: "Leave Utilization",
        description: `${totalLeaveDays} total leave days consumed across the organization.`,
        severity: "low", metric: `${totalLeaveDays} days`, affectedCount: highLeaveEmps.size, icon: Shield,
      });
    }

    // Department headcount imbalance
    const deptCounts = depts.map(d => ({ name: d, count: emps.filter(e => e.department === d).length }));
    const avgHeadcount = deptCounts.length > 0 ? deptCounts.reduce((s, d) => s + d.count, 0) / deptCounts.length : 0;
    const imbalanced = deptCounts.filter(d => d.count < avgHeadcount * 0.5 || d.count > avgHeadcount * 2);
    if (imbalanced.length > 0) {
      result.push({
        id: "headcount-imbalance", type: "organization", title: "Headcount Imbalance",
        description: `${imbalanced.length} department(s) have significantly above or below average headcount.`,
        severity: "medium", metric: `${imbalanced.length} depts`, affectedCount: imbalanced.length, icon: BarChart3,
      });
    }

    return result;
  }, [empStore.items, goalStore.items, leaveStore.items]);

  const filteredInsights = useMemo(() => {
    let result = insights;
    if (tab !== "all") result = result.filter(i => i.type === tab);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(i => i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
    }
    return result;
  }, [insights, tab, search]);

  const severityData = useMemo(() => {
    const counts: Record<string, number> = {};
    insights.forEach(i => { counts[i.severity] = (counts[i.severity] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [insights]);

  const typeData = useMemo(() => {
    const counts: Record<string, number> = {};
    insights.forEach(i => { counts[i.type] = (counts[i.type] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [insights]);

  const isLoading = empStore.loading && !empStore.initialized;
  if (isLoading) return <DataLoadingSkeleton />;
  if (!isLoading && empStore.initialized && empStore.items.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">HR Intelligence</h1>
          <p className="text-muted-foreground mt-1">AI-powered workforce insights</p>
        </div>
        <DataEmptyState {...EMPTY_STATES.analytics} />
      </div>
    );
  }

  const criticalCount = insights.filter(i => i.severity === "critical").length;
  const highCount = insights.filter(i => i.severity === "high").length;
  const types = [...new Set(insights.map(i => i.type))];

  const kpis = [
    { label: "Total Insights", value: insights.length, icon: Lightbulb, gradient: "from-violet-500 to-purple-600" },
    { label: "Critical", value: criticalCount, icon: AlertTriangle, gradient: "from-red-500 to-rose-500" },
    { label: "High Priority", value: highCount, icon: Zap, gradient: "from-amber-500 to-orange-500" },
    { label: "Categories", value: types.length, icon: Brain, gradient: "from-blue-500 to-cyan-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">HR Intelligence</h1>
        <p className="text-muted-foreground mt-1">AI-powered workforce insights and analytics</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">{kpi.label}</p><p className="text-2xl font-bold mt-1">{kpi.value}</p></div><div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.gradient)}><kpi.icon className="h-5 w-5 text-white" /></div></div></CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">By Severity</CardTitle></CardHeader>
          <CardContent>
            {severityData.length === 0 ? <DataEmptyState compact {...EMPTY_STATES.analytics} /> : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={severityData} cx="50%" cy="50%" outerRadius={80} dataKey="value" nameKey="name" label>
                    {severityData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Legend />
                  <RTooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">By Category</CardTitle></CardHeader>
          <CardContent>
            {typeData.length === 0 ? <DataEmptyState compact {...EMPTY_STATES.analytics} /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={typeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <RTooltip />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search insights…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Tabs value={tab} onValueChange={setTab} className="w-auto">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            {types.map(t => <TabsTrigger key={t} value={t}>{t}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>

      {filteredInsights.length === 0 ? (
        <DataEmptyState icon={Brain} title="No insights available" description="Add more data to generate workforce intelligence." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredInsights.map(insight => (
            <Card key={insight.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                      <insight.icon className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{insight.title}</p>
                      <Badge variant="secondary" className="text-xs mt-0.5">{insight.type}</Badge>
                    </div>
                  </div>
                  <Badge className={cn("text-xs", SEVERITY_CONF[insight.severity]?.className)}>
                    {SEVERITY_CONF[insight.severity]?.label}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{insight.description}</p>
                <Separator />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Metric: {insight.metric}</span>
                  <span>Affected: {insight.affectedCount}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
