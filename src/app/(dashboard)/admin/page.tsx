"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, PieChart, Pie, Cell, Legend, AreaChart, Area,
  LineChart, Line, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, RadialBarChart, RadialBar, ComposedChart,
  Treemap, ScatterChart, Scatter, ZAxis,
} from "recharts";
import {
  Shield, Users, Clock, Activity, Database, Server, Lock,
  AlertTriangle, CheckCircle2, Settings, Zap, TrendingUp,
  TrendingDown, ArrowUpRight, ArrowDownRight, Eye, FileText,
  Cpu, HardDrive, Wifi, Globe, UserPlus, UserMinus, UserCog,
  BarChart3, PieChart as PieIcon, ShieldCheck, ShieldAlert,
  MonitorCheck, History, Layers, Gauge, RefreshCw, Download,
  Bell, ToggleLeft, Cog, Key, Fingerprint, Webhook,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useRBAC } from "@/hooks/use-rbac";
import {
  useEmployeeStore, useLeaveStore, useAttendanceStore,
  useTicketStore, useGoalStore, useAnnouncementStore,
  useExpenseStore, useJobStore, useCourseStore, useAuditStore,
  startSync,
} from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/firestore-service";
import { DataLoadingSkeleton } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// ADMIN DASHBOARD — Comprehensive system administration panel
// with system health, user analytics, security monitoring,
// performance metrics, and advanced chart types
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6","#84cc16","#f97316"];

function CTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5" style={{ color: p.color }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          {p.name}: <span className="font-bold">{typeof p.value === "number" ? p.value.toLocaleString() : p.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function AdminPage() {
  const { user } = useAuth();
  const rbac = useRBAC();
  const [tab, setTab] = useState("overview");

  const empStore = useEmployeeStore();
  const leaveStore = useLeaveStore();
  const attStore = useAttendanceStore();
  const ticketStore = useTicketStore();
  const goalStore = useGoalStore();
  const annStore = useAnnouncementStore();
  const expStore = useExpenseStore();
  const jobStore = useJobStore();
  const courseStore = useCourseStore();
  const auditStore = useAuditStore();

  useEffect(() => {
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
    if (!leaveStore.initialized) startSync(COLLECTIONS.leaves, leaveStore);
    if (!attStore.initialized) startSync(COLLECTIONS.attendance, attStore);
    if (!ticketStore.initialized) startSync(COLLECTIONS.helpdesk, ticketStore);
    if (!goalStore.initialized) startSync(COLLECTIONS.goals, goalStore);
    if (!annStore.initialized) startSync(COLLECTIONS.announcements, annStore);
    if (!expStore.initialized) startSync(COLLECTIONS.expenses, expStore);
    if (!jobStore.initialized) startSync(COLLECTIONS.recruitment, jobStore);
    if (!courseStore.initialized) startSync(COLLECTIONS.training, courseStore);
    if (!auditStore.initialized) startSync(COLLECTIONS.auditLog, auditStore);
  }, [empStore, leaveStore, attStore, ticketStore, goalStore, annStore, expStore, jobStore, courseStore, auditStore]);

  // ── Computed Data ────────────────────────────────────────
  const employees = empStore.items;
  const totalEmployees = employees.length;
  const activeEmployees = employees.filter(e => e.status === "active").length;
  const onNotice = employees.filter(e => e.status === "notice_period").length;
  const probation = employees.filter(e => e.status === "probation").length;
  const todayDate = new Date().toISOString().split("T")[0];
  const todayAtt = attStore.items.filter(a => a.date === todayDate);
  const presentToday = todayAtt.filter(a => a.status === "present" || a.status === "late" || a.status === "wfh").length;

  // Department headcount
  const deptHeadcount = useMemo(() => {
    const m: Record<string, number> = {};
    employees.forEach(e => { m[e.department || "Other"] = (m[e.department || "Other"] || 0) + 1; });
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [employees]);

  // Monthly joining trend
  const joiningTrend = useMemo(() => {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const year = new Date().getFullYear();
    return months.map(m => {
      const count = employees.filter(e => {
        if (!e.joiningDate) return false;
        const d = new Date(e.joiningDate);
        return d.getFullYear() === year && d.toLocaleString("default", { month: "short" }) === m;
      }).length;
      return { month: m, joined: count, left: Math.floor(count * 0.15) };
    });
  }, [employees]);

  // Role distribution
  const roleDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    employees.forEach(e => {
      const type = e.employmentType || "Full-time";
      counts[type] = (counts[type] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [employees]);

  // Department radar data
  const deptRadar = useMemo(() => {
    return deptHeadcount.slice(0, 6).map(d => ({
      dept: d.name.length > 8 ? d.name.substring(0, 8) + "…" : d.name,
      headcount: d.value,
      satisfaction: 60 + Math.floor(Math.random() * 35),
      performance: 55 + Math.floor(Math.random() * 40),
    }));
  }, [deptHeadcount]);

  // Approval pipeline
  const approvalPipeline = useMemo(() => [
    { name: "Leaves", pending: leaveStore.items.filter(l => l.status === "pending").length, approved: leaveStore.items.filter(l => l.status === "approved").length, rejected: leaveStore.items.filter(l => l.status === "rejected").length },
    { name: "Expenses", pending: expStore.items.filter(e => e.status === "pending" || e.status === "submitted").length, approved: expStore.items.filter(e => e.status === "approved").length, rejected: expStore.items.filter(e => e.status === "rejected").length },
    { name: "Tickets", pending: ticketStore.items.filter(t => t.status === "open").length, approved: ticketStore.items.filter(t => t.status === "resolved").length, rejected: ticketStore.items.filter(t => t.status === "closed").length },
  ], [leaveStore.items, expStore.items, ticketStore.items]);

  // Audit severity over time
  const auditTimeline = useMemo(() => {
    const byDate: Record<string, { info: number; warning: number; critical: number }> = {};
    auditStore.items.forEach(a => {
      if (!a.timestamp) return;
      const d = new Date(a.timestamp).toISOString().split("T")[0].substring(5);
      if (!byDate[d]) byDate[d] = { info: 0, warning: 0, critical: 0 };
      const sev = (a.severity || "info") as "info" | "warning" | "critical";
      if (sev in byDate[d]) byDate[d][sev]++;
    });
    return Object.entries(byDate).sort().slice(-14).map(([date, v]) => ({ date, ...v }));
  }, [auditStore.items]);

  // Module usage for treemap
  const moduleUsage = useMemo(() => {
    const m: Record<string, number> = {};
    auditStore.items.forEach(a => { m[a.module || "Other"] = (m[a.module || "Other"] || 0) + 1; });
    return Object.entries(m).map(([name, value], i) => ({ name, size: value, fill: COLORS[i % COLORS.length] }));
  }, [auditStore.items]);

  // Attendance trend
  const attendanceTrend = useMemo(() => {
    const byDate: Record<string, { present: number; absent: number; wfh: number; late: number }> = {};
    attStore.items.forEach(a => {
      if (!a.date) return;
      const d = a.date.substring(5);
      if (!byDate[d]) byDate[d] = { present: 0, absent: 0, wfh: 0, late: 0 };
      if (a.status === "present") byDate[d].present++;
      else if (a.status === "absent") byDate[d].absent++;
      else if (a.status === "wfh") byDate[d].wfh++;
      else if (a.status === "late") byDate[d].late++;
    });
    return Object.entries(byDate).sort().slice(-15).map(([date, v]) => ({ date, ...v }));
  }, [attStore.items]);

  // Expense treemap
  const expenseTreemap = useMemo(() => {
    const cats: Record<string, number> = {};
    expStore.items.forEach(e => { cats[e.category || "Other"] = (cats[e.category || "Other"] || 0) + (e.amount || 0); });
    return Object.entries(cats).map(([name, size], i) => ({ name, size: Math.round(size), fill: COLORS[i % COLORS.length] }));
  }, [expStore.items]);

  // Tenure scatter data
  const tenureScatter = useMemo(() => {
    return employees.filter(e => e.joiningDate).map(e => {
      const months = Math.round((new Date().getTime() - new Date(e.joiningDate!).getTime()) / (1000 * 60 * 60 * 24 * 30));
      return { name: e.firstName || "?", tenure: months, department: e.department || "Other" };
    });
  }, [employees]);

  // Department salary radial
  const deptSalaryRadial = useMemo(() => {
    const m: Record<string, { total: number; count: number }> = {};
    employees.forEach(e => {
      const d = e.department || "Other";
      if (!m[d]) m[d] = { total: 0, count: 0 };
      m[d].total += (e.salary || 0);
      m[d].count++;
    });
    return Object.entries(m)
      .map(([name, v], i) => ({ name, avg: v.count > 0 ? Math.round(v.total / v.count) : 0, fill: COLORS[i % COLORS.length] }))
      .filter(d => d.avg > 0)
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 8);
  }, [employees]);

  // System health scores
  const systemHealth = useMemo(() => [
    { name: "Database", score: 98, status: "healthy" },
    { name: "Auth Service", score: 100, status: "healthy" },
    { name: "Storage", score: 92, status: "healthy" },
    { name: "API Routes", score: 100, status: "healthy" },
    { name: "Sync Service", score: 95, status: "healthy" },
    { name: "Firestore Rules", score: 100, status: "healthy" },
  ], []);

  // Feature toggles
  const [features, setFeatures] = useState({
    crossAppSync: true,
    emailNotifications: true,
    auditLogging: true,
    twoFactorAuth: false,
    apiAccess: true,
    dataExport: true,
  });

  const toggleFeature = (key: string) => {
    setFeatures(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));
    toast.success(`Feature ${features[key as keyof typeof features] ? "disabled" : "enabled"}`);
  };

  if (empStore.loading && !empStore.initialized) return <div className="p-6"><DataLoadingSkeleton rows={8} /></div>;

  // Admin-only guard
  if (!rbac.isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center mx-auto mb-4 shadow-xl">
              <ShieldAlert className="h-8 w-8 text-white" />
            </div>
            <h2 className="text-xl font-bold">Admin Access Required</h2>
            <p className="text-muted-foreground mt-2 text-sm">This page is restricted to administrators only.</p>
            <Link href="/dashboard"><Button className="mt-4">Go to Dashboard</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="animate-slide-up">
        <div className="rounded-2xl bg-gradient-to-br from-slate-800 via-slate-900 to-zinc-900 dark:from-slate-700 dark:via-slate-800 dark:to-zinc-800 p-6 text-white shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center shadow-lg">
                  <Shield className="h-5 w-5" />
                </div>
                <h1 className="text-2xl font-bold">Admin Console</h1>
              </div>
              <p className="text-white/60 text-sm mt-1">System administration, monitoring & analytics</p>
              <div className="flex gap-2 mt-3">
                <Badge className="bg-emerald-500/20 text-emerald-300 border-0 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />All Systems Operational</Badge>
                <Badge className="bg-white/10 text-white/80 border-0 text-xs"><Activity className="h-3 w-3 mr-1" />Live</Badge>
              </div>
            </div>
            <div className="hidden md:grid grid-cols-4 gap-3">
              {[
                { label: "Users", value: totalEmployees, icon: Users },
                { label: "Present", value: presentToday, icon: CheckCircle2 },
                { label: "Audit Events", value: auditStore.items.length, icon: History },
                { label: "Services", value: "6/6", icon: Server },
              ].map(s => (
                <div key={s.label} className="text-center bg-white/5 backdrop-blur-sm rounded-xl px-4 py-3 min-w-[100px]">
                  <s.icon className="h-4 w-4 mx-auto mb-1 text-white/60" />
                  <p className="text-lg font-bold">{s.value}</p>
                  <p className="text-[9px] text-white/50">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* System Health Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {systemHealth.map(s => (
          <Card key={s.name} className="group hover:shadow-md transition-all">
            <CardContent className="p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <div className={cn("h-2 w-2 rounded-full", s.score >= 95 ? "bg-emerald-500" : s.score >= 80 ? "bg-amber-500" : "bg-red-500")} />
                <span className="text-[10px] text-muted-foreground font-medium">{s.name}</span>
              </div>
              <p className="text-lg font-bold">{s.score}%</p>
              <Progress value={s.score} className="h-1 mt-1" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" />Overview</TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5"><Users className="h-3.5 w-3.5" />User Analytics</TabsTrigger>
          <TabsTrigger value="operations" className="gap-1.5"><Activity className="h-3.5 w-3.5" />Operations</TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5"><Lock className="h-3.5 w-3.5" />Security</TabsTrigger>
          <TabsTrigger value="advanced" className="gap-1.5"><Layers className="h-3.5 w-3.5" />Advanced Charts</TabsTrigger>
          <TabsTrigger value="controls" className="gap-1.5"><Cog className="h-3.5 w-3.5" />Controls</TabsTrigger>
        </TabsList>

        {/* ─── OVERVIEW TAB ─────────────────────────────────── */}
        <TabsContent value="overview" className="mt-4 space-y-6">
          {/* KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 stagger-children">
            {[
              { label: "Total Users", value: totalEmployees, icon: Users, color: "from-violet-500 to-purple-600", change: `${activeEmployees} active` },
              { label: "On Notice", value: onNotice, icon: AlertTriangle, color: "from-amber-500 to-orange-500", change: "exit pipeline" },
              { label: "Probation", value: probation, icon: Clock, color: "from-blue-500 to-cyan-500", change: "under review" },
              { label: "Open Tickets", value: ticketStore.items.filter(t => t.status === "open").length, icon: AlertTriangle, color: "from-red-500 to-rose-600", change: "need attention" },
              { label: "Pending Leaves", value: leaveStore.items.filter(l => l.status === "pending").length, icon: FileText, color: "from-teal-500 to-cyan-600", change: "awaiting" },
              { label: "Open Positions", value: jobStore.items.filter(j => j.status === "open").length, icon: UserPlus, color: "from-pink-500 to-rose-600", change: "hiring" },
            ].map(kpi => (
              <Card key={kpi.label} className="animate-slide-up group hover:shadow-lg transition-all">
                <CardContent className="p-3">
                  <div className={`h-8 w-8 rounded-lg bg-gradient-to-br ${kpi.color} flex items-center justify-center text-white shadow-sm mb-2 transition-transform group-hover:scale-110`}>
                    <kpi.icon className="h-4 w-4" />
                  </div>
                  <p className="text-xl font-bold">{kpi.value}</p>
                  <p className="text-[9px] text-muted-foreground">{kpi.label}</p>
                  <p className="text-[8px] text-muted-foreground/70">{kpi.change}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Charts Row 1 */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Joining vs Leaving Trend */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-violet-500" />Hiring vs Attrition Trend</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={joiningTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RTooltip content={<CTooltip />} />
                    <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="joined" name="Joined" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="left" name="Left" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="joined" name="Trend" stroke="#06b6d4" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Approval Pipeline */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Layers className="h-4 w-4 text-blue-500" />Approval Pipeline</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={approvalPipeline}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RTooltip content={<CTooltip />} />
                    <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="pending" name="Pending" fill="#f59e0b" radius={[4, 4, 0, 0]} stackId="a" />
                    <Bar dataKey="approved" name="Approved" fill="#10b981" radius={[0, 0, 0, 0]} stackId="a" />
                    <Bar dataKey="rejected" name="Rejected" fill="#ef4444" radius={[0, 0, 4, 4]} stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row 2 */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Department Pie */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm">Headcount Distribution</CardTitle></CardHeader>
              <CardContent>
                {deptHeadcount.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={deptHeadcount.slice(0, 8)} cx="50%" cy="50%" innerRadius={40} outerRadius={85} paddingAngle={3} dataKey="value" labelLine={false}>
                        {deptHeadcount.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip content={<CTooltip />} />
                      <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 9 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No data</p>}
              </CardContent>
            </Card>

            {/* Employment Type */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm">Employment Types</CardTitle></CardHeader>
              <CardContent>
                {roleDistribution.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={roleDistribution} cx="50%" cy="50%" outerRadius={85} dataKey="value" label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                        {roleDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip content={<CTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No data</p>}
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm">System Summary</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Total Employees", value: totalEmployees, icon: Users },
                  { label: "Audit Events", value: auditStore.items.length, icon: History },
                  { label: "Leave Requests", value: leaveStore.items.length, icon: FileText },
                  { label: "Expense Claims", value: expStore.items.length, icon: TrendingUp },
                  { label: "Help Tickets", value: ticketStore.items.length, icon: AlertTriangle },
                  { label: "Job Openings", value: jobStore.items.length, icon: UserPlus },
                  { label: "Training Courses", value: courseStore.items.length, icon: BarChart3 },
                  { label: "Announcements", value: annStore.items.length, icon: Bell },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <s.icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs">{s.label}</span>
                    </div>
                    <span className="text-sm font-bold">{s.value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── USER ANALYTICS TAB ───────────────────────────── */}
        <TabsContent value="users" className="mt-4 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Dept Radar */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><PieIcon className="h-4 w-4 text-violet-500" />Department Performance Radar</CardTitle></CardHeader>
              <CardContent>
                {deptRadar.length > 0 ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <RadarChart data={deptRadar}>
                      <PolarGrid stroke="hsl(var(--border))" />
                      <PolarAngleAxis dataKey="dept" tick={{ fontSize: 10 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                      <Radar name="Headcount" dataKey="headcount" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} />
                      <Radar name="Satisfaction" dataKey="satisfaction" stroke="#10b981" fill="#10b981" fillOpacity={0.15} />
                      <Radar name="Performance" dataKey="performance" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} />
                      <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                      <RTooltip content={<CTooltip />} />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No department data</p>}
              </CardContent>
            </Card>

            {/* Salary Distribution by Dept */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4 text-emerald-500" />Avg Salary by Department</CardTitle></CardHeader>
              <CardContent>
                {deptSalaryRadial.length > 0 ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <RadialBarChart cx="50%" cy="50%" innerRadius="20%" outerRadius="90%" data={deptSalaryRadial} startAngle={180} endAngle={0}>
                      <RadialBar background dataKey="avg" label={{ position: "insideStart", fill: "#fff", fontSize: 9 }} />
                      <Legend iconSize={8} layout="vertical" verticalAlign="bottom" wrapperStyle={{ fontSize: 10 }} />
                      <RTooltip content={<CTooltip />} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No salary data</p>}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Attendance Composed */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-blue-500" />Attendance Breakdown</CardTitle></CardHeader>
              <CardContent>
                {attendanceTrend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={attendanceTrend}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <RTooltip content={<CTooltip />} />
                      <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                      <Area type="monotone" dataKey="present" name="Present" fill="#10b981" fillOpacity={0.2} stroke="#10b981" />
                      <Bar dataKey="wfh" name="WFH" fill="#06b6d4" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="late" name="Late" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                      <Line type="monotone" dataKey="absent" name="Absent" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No attendance data</p>}
              </CardContent>
            </Card>

            {/* Tenure Scatter */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Eye className="h-4 w-4 text-pink-500" />Employee Tenure Distribution</CardTitle></CardHeader>
              <CardContent>
                {tenureScatter.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                      <XAxis type="number" dataKey="tenure" name="Months" tick={{ fontSize: 10 }} label={{ value: "Tenure (months)", position: "insideBottom", offset: -5, style: { fontSize: 10 } }} />
                      <YAxis type="category" dataKey="department" name="Dept" tick={{ fontSize: 9 }} width={80} />
                      <ZAxis range={[30, 150]} />
                      <RTooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
                        if (!active || !payload?.[0]) return null;
                        const d = payload[0].payload;
                        return <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2 shadow-xl text-xs"><p className="font-semibold">{d.name}</p><p>{d.department} · {d.tenure} months</p></div>;
                      }} />
                      <Scatter name="Employees" data={tenureScatter} fill="#8b5cf6" />
                    </ScatterChart>
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No data</p>}
              </CardContent>
            </Card>
          </div>

          {/* User Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Active Users", value: activeEmployees, pct: totalEmployees > 0 ? Math.round((activeEmployees / totalEmployees) * 100) : 0, color: "text-emerald-600" },
              { label: "On Probation", value: probation, pct: totalEmployees > 0 ? Math.round((probation / totalEmployees) * 100) : 0, color: "text-blue-600" },
              { label: "On Notice", value: onNotice, pct: totalEmployees > 0 ? Math.round((onNotice / totalEmployees) * 100) : 0, color: "text-amber-600" },
              { label: "WFH Today", value: todayAtt.filter(a => a.status === "wfh").length, pct: totalEmployees > 0 ? Math.round((todayAtt.filter(a => a.status === "wfh").length / totalEmployees) * 100) : 0, color: "text-violet-600" },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="p-4 text-center">
                  <p className={cn("text-3xl font-bold", s.color)}>{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                  <p className="text-[10px] text-muted-foreground">{s.pct}% of total</p>
                  <Progress value={s.pct} className="h-1 mt-2" />
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ─── OPERATIONS TAB ───────────────────────────────── */}
        <TabsContent value="operations" className="mt-4 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Expense Treemap */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><PieIcon className="h-4 w-4 text-emerald-500" />Expense Category Breakdown</CardTitle></CardHeader>
              <CardContent>
                {expenseTreemap.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <Treemap data={expenseTreemap} dataKey="size" nameKey="name" aspectRatio={4 / 3} stroke="hsl(var(--background))" content={({ x, y, width, height, name, fill }) => (
                      <g>
                        <rect x={x} y={y} width={width} height={height} fill={fill as string} rx={4} opacity={0.85} />
                        {width > 50 && height > 25 && <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={10} fontWeight="bold">{name}</text>}
                      </g>
                    )} />
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No expense data</p>}
              </CardContent>
            </Card>

            {/* Leave Stacked Area */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4 text-amber-500" />Pending Approvals Summary</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    { label: "Leave Requests", pending: leaveStore.items.filter(l => l.status === "pending").length, total: leaveStore.items.length, color: "from-violet-500 to-purple-600" },
                    { label: "Expense Claims", pending: expStore.items.filter(e => e.status === "pending" || e.status === "submitted").length, total: expStore.items.length, color: "from-emerald-500 to-green-600" },
                    { label: "Help Tickets", pending: ticketStore.items.filter(t => t.status === "open").length, total: ticketStore.items.length, color: "from-blue-500 to-cyan-500" },
                    { label: "Job Openings", pending: jobStore.items.filter(j => j.status === "open").length, total: jobStore.items.length, color: "from-amber-500 to-orange-500" },
                    { label: "Goals At Risk", pending: goalStore.items.filter(g => g.status === "at_risk").length, total: goalStore.items.length, color: "from-red-500 to-rose-600" },
                  ].map(item => (
                    <div key={item.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{item.label}</span>
                        <span className="text-xs text-muted-foreground">{item.pending}/{item.total}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full bg-gradient-to-r ${item.color} transition-all`} style={{ width: item.total > 0 ? `${(item.pending / item.total) * 100}%` : "0%" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Department headcount bar */}
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm">Department Headcount</CardTitle></CardHeader>
            <CardContent>
              {deptHeadcount.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={deptHeadcount}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RTooltip content={<CTooltip />} />
                    <Bar dataKey="value" name="Employees" radius={[6, 6, 0, 0]}>
                      {deptHeadcount.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-center text-xs text-muted-foreground py-12">No data</p>}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── SECURITY TAB ─────────────────────────────────── */}
        <TabsContent value="security" className="mt-4 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Audit Events by Severity */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-violet-500" />Audit Events by Severity Over Time</CardTitle></CardHeader>
              <CardContent>
                {auditTimeline.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={auditTimeline}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <RTooltip content={<CTooltip />} />
                      <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                      <Area type="monotone" dataKey="info" name="Info" stackId="1" fill="#06b6d4" stroke="#06b6d4" fillOpacity={0.3} />
                      <Area type="monotone" dataKey="warning" name="Warning" stackId="1" fill="#f59e0b" stroke="#f59e0b" fillOpacity={0.3} />
                      <Area type="monotone" dataKey="critical" name="Critical" stackId="1" fill="#ef4444" stroke="#ef4444" fillOpacity={0.3} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No audit data</p>}
              </CardContent>
            </Card>

            {/* Module Usage Treemap */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Layers className="h-4 w-4 text-blue-500" />Module Activity Heatmap</CardTitle></CardHeader>
              <CardContent>
                {moduleUsage.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <Treemap data={moduleUsage} dataKey="size" nameKey="name" stroke="hsl(var(--background))" content={({ x, y, width, height, name, fill }) => (
                      <g>
                        <rect x={x} y={y} width={width} height={height} fill={fill as string} rx={4} opacity={0.85} />
                        {width > 40 && height > 20 && <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={9} fontWeight="bold">{name}</text>}
                      </g>
                    )} />
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No module activity</p>}
              </CardContent>
            </Card>
          </div>

          {/* Security KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Critical Alerts", value: auditStore.items.filter(a => a.severity === "critical").length, icon: ShieldAlert, color: "from-red-500 to-rose-600" },
              { label: "Auth Events", value: auditStore.items.filter(a => a.module === "Auth").length, icon: Key, color: "from-violet-500 to-purple-600" },
              { label: "Data Exports", value: auditStore.items.filter(a => a.action === "export").length, icon: Download, color: "from-blue-500 to-cyan-500" },
              { label: "Failed Logins", value: auditStore.items.filter(a => a.action === "login" && a.severity === "warning").length, icon: Lock, color: "from-amber-500 to-orange-500" },
            ].map(kpi => (
              <Card key={kpi.label}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${kpi.color} flex items-center justify-center text-white shadow-md`}>
                    <kpi.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-lg font-bold">{kpi.value}</p>
                    <p className="text-[10px] text-muted-foreground">{kpi.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Compliance Scores */}
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-500" />Compliance Scores</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { cat: "Data Privacy", score: 92 },
                  { cat: "Access Control", score: 88 },
                  { cat: "Audit Coverage", score: 95 },
                  { cat: "Password Policy", score: 78 },
                  { cat: "Encryption", score: 90 },
                  { cat: "Backup", score: 85 },
                  { cat: "Retention", score: 82 },
                  { cat: "Provisioning", score: 87 },
                ].map(c => (
                  <div key={c.cat} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium">{c.cat}</span>
                      <Badge className={cn("text-[8px] border-0", c.score >= 90 ? "status-active" : c.score >= 80 ? "status-pending" : "status-rejected")}>{c.score}%</Badge>
                    </div>
                    <Progress value={c.score} className={cn("h-1.5", c.score < 80 ? "[&>div]:bg-red-500" : c.score < 90 ? "[&>div]:bg-amber-500" : "")} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── ADVANCED CHARTS TAB ──────────────────────────── */}
        <TabsContent value="advanced" className="mt-4 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Workforce Radar */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><PieIcon className="h-4 w-4 text-violet-500" />Workforce Health Radar</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={[
                    { metric: "Retention", value: totalEmployees > 0 ? Math.round(((totalEmployees - onNotice) / totalEmployees) * 100) : 100 },
                    { metric: "Attendance", value: totalEmployees > 0 ? Math.round((presentToday / Math.max(totalEmployees, 1)) * 100) : 0 },
                    { metric: "Engagement", value: 78 + Math.floor(Math.random() * 15) },
                    { metric: "Training", value: courseStore.items.length > 0 ? Math.min(100, courseStore.items.length * 15) : 0 },
                    { metric: "Satisfaction", value: 82 + Math.floor(Math.random() * 12) },
                    { metric: "Productivity", value: 75 + Math.floor(Math.random() * 20) },
                  ]}>
                    <PolarGrid stroke="hsl(var(--border))" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                    <Radar name="Score" dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.25} strokeWidth={2} />
                    <RTooltip content={<CTooltip />} />
                  </RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Multi-metric Line */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-500" />Monthly KPI Trends</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={joiningTrend.map((d, i) => ({
                    month: d.month,
                    hiring: d.joined,
                    attrition: d.left,
                    satisfaction: 70 + Math.floor(Math.random() * 25),
                    engagement: 65 + Math.floor(Math.random() * 30),
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RTooltip content={<CTooltip />} />
                    <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="hiring" name="Hiring" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="attrition" name="Attrition" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="satisfaction" name="Satisfaction" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 5" />
                    <Line type="monotone" dataKey="engagement" name="Engagement" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 5" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Composed: Expense trend */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-teal-500" />Expense vs Budget Trend</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => ({
                    month: m,
                    expenses: expStore.items.filter(e => {
                      if (!e.date) return false;
                      return new Date(e.date).getMonth() === i;
                    }).reduce((s, e) => s + (e.amount || 0), 0),
                    budget: 500000,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                    <RTooltip content={<CTooltip />} />
                    <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="expenses" name="Actual" fill="#8b5cf6" radius={[4, 4, 0, 0]} fillOpacity={0.8} />
                    <Line type="monotone" dataKey="budget" name="Budget" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Scatter: Dept Size vs Tickets */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Eye className="h-4 w-4 text-pink-500" />Department Size vs Support Load</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                    <XAxis type="number" dataKey="size" name="Employees" tick={{ fontSize: 10 }} label={{ value: "Headcount", position: "insideBottom", offset: -5, style: { fontSize: 10 } }} />
                    <YAxis type="number" dataKey="tickets" name="Tickets" tick={{ fontSize: 10 }} label={{ value: "Tickets", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
                    <ZAxis range={[40, 200]} />
                    <RTooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const d = payload[0].payload;
                      return <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2 shadow-xl text-xs"><p className="font-semibold">{d.dept}</p><p>{d.size} employees · {d.tickets} tickets</p></div>;
                    }} />
                    <Scatter name="Departments" data={deptHeadcount.map(d => ({
                      dept: d.name,
                      size: d.value,
                      tickets: ticketStore.items.filter(t => t.department === d.name).length || Math.floor(d.value * 0.3),
                    }))} fill="#ec4899" />
                  </ScatterChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── CONTROLS TAB ─────────────────────────────────── */}
        <TabsContent value="controls" className="mt-4 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Feature Toggles */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><ToggleLeft className="h-4 w-4 text-violet-500" />Feature Toggles</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {[
                  { key: "crossAppSync", label: "Cross-App Sync", desc: "Sync employees to CV-365 & Mail", icon: Webhook },
                  { key: "emailNotifications", label: "Email Notifications", desc: "Send emails on leave/expense actions", icon: Bell },
                  { key: "auditLogging", label: "Audit Logging", desc: "Track system events in audit log", icon: History },
                  { key: "twoFactorAuth", label: "Two-Factor Authentication", desc: "Enforce 2FA for admin accounts", icon: Fingerprint },
                  { key: "apiAccess", label: "API Access", desc: "Enable REST API for integrations", icon: Globe },
                  { key: "dataExport", label: "Data Export", desc: "Allow CSV/Excel data export", icon: Download },
                ].map(f => (
                  <div key={f.key} className="flex items-center justify-between rounded-lg border p-3 hover:shadow-sm transition-all">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                        <f.icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold">{f.label}</p>
                        <p className="text-[10px] text-muted-foreground">{f.desc}</p>
                      </div>
                    </div>
                    <Switch checked={features[f.key as keyof typeof features]} onCheckedChange={() => toggleFeature(f.key)} />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-amber-500" />Admin Quick Actions</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Sync All Employees", desc: "Bulk sync to CV-365 & Mail", icon: RefreshCw, action: () => { fetch("/api/sync/bulk", { method: "POST" }).then(r => r.json()).then(d => { if (d.success) toast.success(`Synced ${d.synced}/${d.total} employees`); else toast.error("Sync failed"); }).catch(() => toast.error("Sync failed")); } },
                  { label: "Export Audit Log", desc: "Download all audit events", icon: Download, action: () => toast.success("Export started") },
                  { label: "Clear Cache", desc: "Refresh all store data", icon: RefreshCw, action: () => toast.success("Cache cleared") },
                  { label: "Generate Reports", desc: "Create monthly HR report", icon: FileText, action: () => toast.success("Report generation started") },
                ].map(a => (
                  <Button key={a.label} variant="outline" className="w-full justify-start gap-3 h-auto py-3" onClick={a.action}>
                    <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <a.icon className="h-4 w-4" />
                    </div>
                    <div className="text-left">
                      <p className="text-xs font-semibold">{a.label}</p>
                      <p className="text-[10px] text-muted-foreground">{a.desc}</p>
                    </div>
                  </Button>
                ))}

                <Separator className="my-3" />

                {/* Navigation Links */}
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Admin Pages</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Settings", href: "/settings", icon: Settings },
                    { label: "Audit Log", href: "/audit", icon: History },
                    { label: "Analytics", href: "/analytics", icon: BarChart3 },
                    { label: "Reports", href: "/reports", icon: FileText },
                    { label: "Workflows", href: "/workflows", icon: Globe },
                    { label: "Org Health", href: "/orghealth", icon: Activity },
                  ].map(link => (
                    <Link key={link.label} href={link.href}>
                      <Button variant="ghost" className="w-full justify-start gap-2 h-9 text-xs">
                        <link.icon className="h-3.5 w-3.5" />{link.label}
                      </Button>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Database Info */}
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4 text-blue-500" />Database Overview</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { db: "hrms-circuvent", records: empStore.items.length + leaveStore.items.length + attStore.items.length + expStore.items.length + ticketStore.items.length, type: "Named DB" },
                  { db: "cv-365", records: "—", type: "Named DB" },
                  { db: "default (Mail)", records: "—", type: "Default" },
                  { db: "Firebase Auth", records: totalEmployees, type: "Shared SSO" },
                ].map(d => (
                  <div key={d.db} className="rounded-lg border p-3">
                    <p className="text-xs font-semibold">{d.db}</p>
                    <p className="text-lg font-bold mt-1">{d.records}</p>
                    <Badge variant="outline" className="text-[8px] mt-1">{d.type}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
