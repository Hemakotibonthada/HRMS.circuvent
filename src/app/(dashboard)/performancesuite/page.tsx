"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Target, Search, CheckCircle2, Clock, Star,
  TrendingUp, Users, Award, BarChart3, ArrowUpRight,
  Calendar, ClipboardList, Eye, Link as LinkIcon,
  Zap, Medal, Crown, GaugeCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend,
  AreaChart, Area, Tooltip as RTooltip,
} from "recharts";
import { useGoalStore, useEmployeeStore, startSync, type GoalDoc } from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// PERFORMANCE SUITE — Comprehensive performance overview
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const RATING_LABELS = ["Exceeds", "Meets", "Below", "Improvement Needed"];
const STATUS_MAP: Record<string, { label: string; className: string }> = {
  Active: { label: "Active", className: "status-pending" },
  "In Progress": { label: "In Progress", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  Completed: { label: "Completed", className: "status-active" },
  Overdue: { label: "Overdue", className: "status-rejected" },
};

export default function PerformanceSuitePage() {
  const goalStore = useGoalStore();
  const empStore = useEmployeeStore();
  const { items: goals, loading, initialized } = goalStore;
  const { items: employees } = empStore;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("overview");
  const [detailGoal, setDetailGoal] = useState<GoalDoc | null>(null);

  useEffect(() => {
    if (!goalStore.initialized) startSync(COLLECTIONS.goals, goalStore);
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
  }, [goalStore, empStore]);

  // KPIs
  const totalGoals = goals.length;
  const avgProgress = totalGoals > 0 ? Math.round(goals.reduce((s, g) => s + (g.progress || 0), 0) / totalGoals) : 0;
  const completedGoals = goals.filter(g => g.status === "Completed" || (g.progress || 0) >= 100).length;
  const onTrackGoals = goals.filter(g => (g.progress || 0) >= 50 && g.status !== "Completed").length;

  // Review cycle cards
  const reviewCycles = useMemo(() => [
    { name: "Q1 Review", period: "Jan — Mar", status: "Completed", completion: 100 },
    { name: "Q2 Review", period: "Apr — Jun", status: "Active", completion: avgProgress },
    { name: "Mid-Year Review", period: "Jul", status: "Upcoming", completion: 0 },
    { name: "Annual Review", period: "Dec", status: "Upcoming", completion: 0 },
  ], [avgProgress]);

  // Goal status distribution
  const statusDist = useMemo(() => {
    const counts: Record<string, number> = {};
    goals.forEach(g => { counts[g.status || "Active"] = (counts[g.status || "Active"] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [goals]);

  // Rating distribution (simulated from goal progress)
  const ratingDist = useMemo(() => {
    const ratings = { "Exceeds": 0, "Meets": 0, "Below": 0, "Improvement Needed": 0 };
    goals.forEach(g => {
      const p = g.progress || 0;
      if (p >= 90) ratings["Exceeds"]++;
      else if (p >= 60) ratings["Meets"]++;
      else if (p >= 30) ratings["Below"]++;
      else ratings["Improvement Needed"]++;
    });
    return Object.entries(ratings).map(([name, value]) => ({ name, value }));
  }, [goals]);

  // Top performers (by goal progress)
  const topPerformers = useMemo(() => {
    const empProgress: Record<string, { total: number; count: number }> = {};
    goals.forEach(g => {
      if (!g.employeeId) return;
      if (!empProgress[g.employeeId]) empProgress[g.employeeId] = { total: 0, count: 0 };
      empProgress[g.employeeId].total += (g.progress || 0);
      empProgress[g.employeeId].count++;
    });
    return Object.entries(empProgress)
      .map(([empId, data]) => {
        const emp = employees.find(e => e.id === empId);
        return {
          name: emp ? `${emp.firstName} ${emp.lastName}` : empId,
          department: emp?.department || "",
          avgProgress: Math.round(data.total / data.count),
          goalCount: data.count,
        };
      })
      .sort((a, b) => b.avgProgress - a.avgProgress)
      .slice(0, 6);
  }, [goals, employees]);

  // Goal progress by category
  const categoryProgress = useMemo(() => {
    const cats: Record<string, { total: number; count: number }> = {};
    goals.forEach(g => {
      const cat = g.category || "General";
      if (!cats[cat]) cats[cat] = { total: 0, count: 0 };
      cats[cat].total += (g.progress || 0);
      cats[cat].count++;
    });
    return Object.entries(cats).map(([name, data]) => ({
      name, avgProgress: Math.round(data.total / data.count), count: data.count,
    }));
  }, [goals]);

  const filtered = useMemo(() => {
    if (!search) return goals;
    const q = search.toLowerCase();
    return goals.filter(g =>
      g.title?.toLowerCase().includes(q) ||
      g.category?.toLowerCase().includes(q) ||
      g.description?.toLowerCase().includes(q)
    );
  }, [goals, search]);

  // Self vs Manager comparison (simulated)
  const selfVsManager = useMemo(() => {
    return categoryProgress.slice(0, 5).map(c => ({
      name: c.name,
      self: Math.min(100, c.avgProgress + Math.floor(Math.random() * 10)),
      manager: c.avgProgress,
    }));
  }, [categoryProgress]);

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && goals.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.performance} />;
  }

  const kpis = [
    { label: "Total Goals", value: totalGoals, icon: Target, gradient: "from-violet-500 to-purple-600" },
    { label: "Avg Progress", value: `${avgProgress}%`, icon: TrendingUp, gradient: "from-blue-500 to-cyan-500" },
    { label: "Completed", value: completedGoals, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "On Track", value: onTrackGoals, icon: Zap, gradient: "from-amber-500 to-orange-500" },
  ];

  const quickLinks = [
    { label: "Goal Reviews", icon: ClipboardList, href: "/goals" },
    { label: "360 Feedback", icon: Users, href: "/feedback" },
    { label: "Awards", icon: Award, href: "/engagement" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Performance Suite</h1>
          <p className="text-muted-foreground mt-1">Comprehensive performance reviews, goals &amp; analytics</p>
        </div>
        <div className="flex gap-2">
          {quickLinks.map(l => (
            <Button key={l.label} variant="outline" size="sm" className="gap-1.5 text-xs">
              <l.icon className="h-3.5 w-3.5" />{l.label}
            </Button>
          ))}
        </div>
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
                </div>
                <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.gradient)}>
                  <kpi.icon className="h-5 w-5 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search goals..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          {/* Review Cycles */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {reviewCycles.map(cycle => (
              <Card key={cycle.name} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-sm">{cycle.name}</h3>
                    <Badge className={cn(
                      cycle.status === "Completed" ? "status-active" :
                      cycle.status === "Active" ? "status-pending" : "bg-gray-100 text-gray-700 dark:bg-gray-900/30"
                    )}>{cycle.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{cycle.period}</p>
                  <Progress value={cycle.completion} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-1">{cycle.completion}% complete</p>
                </CardContent>
              </Card>
            ))}
          </div>
          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Goal Status Distribution</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={statusDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                      {statusDist.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Rating Distribution</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={ratingDist}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="value" name="Employees" fill="#10b981" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Goals */}
        <TabsContent value="goals" className="space-y-3 mt-4">
          {/* Goal Progress Cards */}
          {filtered.slice(0, 12).map(goal => {
            const st = STATUS_MAP[goal.status] || STATUS_MAP.Active;
            const emp = employees.find(e => e.id === goal.employeeId);
            return (
              <Card key={goal.id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setDetailGoal(goal)}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center bg-gradient-to-br",
                        (goal.progress || 0) >= 80 ? "from-emerald-500 to-green-600" :
                        (goal.progress || 0) >= 40 ? "from-blue-500 to-cyan-500" : "from-amber-500 to-orange-500")}>
                        <Target className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">{goal.title}</h3>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <span>{emp ? `${emp.firstName} ${emp.lastName}` : goal.employeeId}</span>
                          <span>&middot;</span>
                          <span>{goal.category}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-32">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium">{goal.progress || 0}%</span>
                          <span className="text-muted-foreground">W:{goal.weight}%</span>
                        </div>
                        <Progress value={goal.progress || 0} className="h-2" />
                      </div>
                      <Badge className={st.className}>{st.label}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Reviews */}
        <TabsContent value="reviews" className="space-y-4 mt-4">
          {/* Self vs Manager */}
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Self vs Manager Assessment</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={selfVsManager}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} />
                  <RTooltip />
                  <Legend />
                  <Bar dataKey="self" name="Self Review" fill="#8b5cf6" radius={[4,4,0,0]} />
                  <Bar dataKey="manager" name="Manager Review" fill="#06b6d4" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          {/* Top Performers */}
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Crown className="h-4 w-4 text-amber-500" /> Top Performers</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {topPerformers.map((tp, i) => (
                <div key={tp.name} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                  <div className={cn("h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold",
                    i === 0 ? "bg-gradient-to-br from-amber-500 to-yellow-400" :
                    i === 1 ? "bg-gradient-to-br from-gray-400 to-gray-300" :
                    i === 2 ? "bg-gradient-to-br from-amber-700 to-amber-600" :
                    "bg-gradient-to-br from-violet-500 to-purple-600")}>
                    {i < 3 ? <Medal className="h-4 w-4" /> : i + 1}
                  </div>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-xs">
                      {tp.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{tp.name}</p>
                    <p className="text-xs text-muted-foreground">{tp.department} &middot; {tp.goalCount} goals</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">{tp.avgProgress}%</p>
                    <Progress value={tp.avgProgress} className="h-1.5 w-16" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Goal Progress by Category</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={categoryProgress} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" domain={[0, 100]} />
                  <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                  <RTooltip />
                  <Bar dataKey="avgProgress" name="Avg Progress %" fill="#8b5cf6" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Goal Detail Dialog */}
      <Dialog open={!!detailGoal} onOpenChange={v => { if (!v) setDetailGoal(null); }}>
        <DialogContent>
          {detailGoal && (
            <>
              <DialogHeader><DialogTitle>{detailGoal.title}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <Badge className={(STATUS_MAP[detailGoal.status] || STATUS_MAP.Active).className}>{detailGoal.status}</Badge>
                <Separator />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Category</p><p className="font-medium">{detailGoal.category}</p></div>
                  <div><p className="text-muted-foreground">Due Date</p><p className="font-medium">{detailGoal.dueDate}</p></div>
                  <div><p className="text-muted-foreground">Weight</p><p className="font-medium">{detailGoal.weight}%</p></div>
                  <div><p className="text-muted-foreground">Progress</p><p className="font-bold text-lg">{detailGoal.progress}%</p></div>
                </div>
                <Progress value={detailGoal.progress || 0} className="h-3" />
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Description</p>
                  <p className="text-sm">{detailGoal.description || "No description"}</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDetailGoal(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
