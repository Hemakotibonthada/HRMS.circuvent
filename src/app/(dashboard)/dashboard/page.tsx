"use client";

import { useState, useEffect, useMemo } from "react";
import { useToday } from "@/hooks/use-now";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, PieChart, Pie, Cell, Legend, AreaChart, Area,
  LineChart, Line, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, ComposedChart,
} from "recharts";
import {
  Users, Clock, CalendarDays, DollarSign, TrendingUp, TrendingDown,
  UserPlus, Briefcase, Target, Heart, BarChart3, ArrowUpRight,
  ArrowDownRight, ChevronRight, Bell, CheckCircle2, AlertTriangle,
  Calendar, GraduationCap, FileText, Activity, Zap, Building2,
  Star, Award, MessageSquare, Eye, Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useRBAC } from "@/hooks/use-rbac";
import {
  useEmployeeStore, useLeaveStore, useAttendanceStore,
  useTicketStore, useGoalStore, useAnnouncementStore,
  useExpenseStore, useJobStore, useCourseStore,
  startSync,
} from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/collection-service";
import { DataLoadingSkeleton } from "@/components/data-empty-state";

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const GRADIENTS = ["from-violet-500 to-purple-600","from-blue-500 to-cyan-500","from-emerald-500 to-green-600","from-amber-500 to-orange-500","from-pink-500 to-rose-600","from-teal-500 to-cyan-600","from-indigo-500 to-blue-600","from-red-500 to-orange-500"];

function CTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5" style={{ color: p.color }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          {p.name}: <span className="font-bold">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const rbac = useRBAC();
  const [dashTab, setDashTab] = useState("overview");

  // Connect to all stores
  const empStore = useEmployeeStore();
  const leaveStore = useLeaveStore();
  const attStore = useAttendanceStore();
  const ticketStore = useTicketStore();
  const goalStore = useGoalStore();
  const annStore = useAnnouncementStore();
  const expStore = useExpenseStore();
  const jobStore = useJobStore();
  const courseStore = useCourseStore();

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
  }, [empStore, leaveStore, attStore, ticketStore, goalStore, annStore, expStore, jobStore, courseStore]);

  // Computed metrics from real store data
  const totalEmployees = empStore.items.length;
  const activeEmployees = empStore.items.filter(e => e.status === "active").length;
  const onNotice = empStore.items.filter(e => e.status === "notice_period").length;
  const newThisMonth = empStore.items.filter(e => {
    if (!e.joiningDate) return false;
    const d = new Date(e.joiningDate); const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const pendingLeaves = leaveStore.items.filter(l => l.status === "pending").length;
  const todayDate = useToday() ?? "";
  const todayAttendance = attStore.items.filter(a => a.date === todayDate);
  const presentToday = todayAttendance.filter(a => a.status === "present" || a.status === "late").length;
  const wfhToday = todayAttendance.filter(a => a.status === "wfh").length;

  const openTickets = ticketStore.items.filter(t => t.status === "open" || t.status === "in_progress").length;
  const activeGoals = goalStore.items.filter(g => g.status !== "completed" && g.status !== "cancelled").length;
  const avgGoalProgress = goalStore.items.length > 0
    ? Math.round(goalStore.items.reduce((s, g) => s + (g.progress || 0), 0) / goalStore.items.length) : 0;

  const pendingExpenses = expStore.items.filter(e => e.status === "pending").length;
  const totalExpenseAmount = expStore.items.filter(e => e.status === "pending").reduce((s, e) => s + (e.amount || 0), 0);
  const openPositions = jobStore.items.filter(j => j.status === "open").length;

  const recentAnnouncements = annStore.items.slice(0, 5);

  // Department distribution for chart
  const deptData = useMemo(() => {
    const counts: Record<string, number> = {};
    empStore.items.forEach(e => { const d = e.department || "Other"; counts[d] = (counts[d] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [empStore.items]);

  // Leave type distribution
  const leaveTypeData = useMemo(() => {
    const counts: Record<string, number> = {};
    leaveStore.items.forEach(l => { const t = l.leaveType || "Other"; counts[t] = (counts[t] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [leaveStore.items]);

  // Expense category data
  const expenseCatData = useMemo(() => {
    const cats: Record<string, number> = {};
    expStore.items.forEach(e => { const c = e.category || "Other"; cats[c] = (cats[c] || 0) + (e.amount || 0); });
    return Object.entries(cats).map(([name, value]) => ({ name, value: Math.round(value) })).sort((a, b) => b.value - a.value);
  }, [expStore.items]);

  // Goal status distribution
  const goalStatusData = useMemo(() => {
    const counts: Record<string, number> = {};
    goalStore.items.forEach(g => { const s = g.status || "unknown"; counts[s] = (counts[s] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
  }, [goalStore.items]);

  // Monthly hiring trend
  const hiringTrend = useMemo(() => {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const year = new Date().getFullYear();
    return months.map(m => {
      const count = empStore.items.filter(e => {
        if (!e.joiningDate) return false;
        const d = new Date(e.joiningDate);
        return d.getFullYear() === year && d.toLocaleString("default", { month: "short" }) === m;
      }).length;
      return { month: m, joined: count, attrition: Math.floor(count * 0.15) };
    });
  }, [empStore.items]);

  // Attendance trend (last 10 days)
  const attendanceTrend = useMemo(() => {
    const byDate: Record<string, { present: number; absent: number; wfh: number }> = {};
    attStore.items.forEach(a => {
      if (!a.date) return;
      const d = a.date.substring(5);
      if (!byDate[d]) byDate[d] = { present: 0, absent: 0, wfh: 0 };
      if (a.status === "present" || a.status === "late") byDate[d].present++;
      else if (a.status === "absent") byDate[d].absent++;
      else if (a.status === "wfh") byDate[d].wfh++;
    });
    return Object.entries(byDate).sort().slice(-10).map(([date, v]) => ({ date, ...v }));
  }, [attStore.items]);

  // Department radar
  const deptRadar = useMemo(() => {
    // Goal progress by department, from real goals. This previously showed
    // Math.random() "satisfaction" and "performance" as if measured, which
    // also broke hydration.
    const progressByDept = new Map<string, { total: number; count: number }>();
    for (const goal of goalStore.items) {
      const owner = empStore.items.find((e) => e.id === goal.employeeId);
      if (!owner?.department) continue;
      const entry = progressByDept.get(owner.department) ?? { total: 0, count: 0 };
      entry.total += Number(goal.progress) || 0;
      entry.count += 1;
      progressByDept.set(owner.department, entry);
    }

    return deptData.slice(0, 6).map((d) => {
      const progress = progressByDept.get(d.name);
      return {
        dept: d.name.length > 8 ? d.name.substring(0, 8) + "…" : d.name,
        headcount: d.value,
        goalProgress: progress && progress.count > 0
          ? Math.round(progress.total / progress.count)
          : 0,
      };
    });
  }, [deptData, goalStore.items, empStore.items]);

  // Leave monthly trend
  const leaveTrend = useMemo(() => {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months.map(m => {
      const count = leaveStore.items.filter(l => {
        if (!l.fromDate) return false;
        return new Date(l.fromDate).toLocaleString("default", { month: "short" }) === m;
      }).reduce((s, l) => s + (l.days || 1), 0);
      return { month: m, days: count };
    });
  }, [leaveStore.items]);

  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";

  if (empStore.loading && !empStore.initialized) return <div className="p-6"><DataLoadingSkeleton rows={8} /></div>;

  return (
    <div className="p-6 space-y-6">
      {/* Welcome Banner */}
      <div className="animate-slide-up">
        <div className="rounded-2xl bg-gradient-to-br from-violet-500 via-purple-500 to-indigo-600 p-6 text-white shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">{greeting}, {user?.displayName?.split(" ")[0] ?? "there"}!</h1>
              <p className="text-white/70 text-sm mt-1">
                {new Date().toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              </p>
              <div className="flex gap-2 mt-3">
                {rbac.isAdmin && <Badge className="bg-white/20 text-white border-0 text-xs">Administrator</Badge>}
                <Badge className="bg-white/20 text-white border-0 text-xs"><Activity className="h-3 w-3 mr-1" />Live Data</Badge>
              </div>
            </div>
            <div className="hidden md:grid grid-cols-3 gap-4">
              {[
                { label: "Employees", value: totalEmployees, sub: `${activeEmployees} active` },
                { label: "Present Today", value: presentToday, sub: `${wfhToday} WFH` },
                { label: "Open Tickets", value: openTickets, sub: `${pendingLeaves} leaves pending` },
              ].map(s => (
                <div key={s.label} className="text-center bg-white/10 backdrop-blur-sm rounded-xl px-5 py-3">
                  <p className="text-2xl font-bold">{s.value}</p>
                  <p className="text-[10px] text-white/60">{s.label}</p>
                  <p className="text-[9px] text-white/50">{s.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 stagger-children">
        {[
          { label: "Total Employees", value: totalEmployees.toString(), change: `+${newThisMonth} this month`, trend: newThisMonth > 0 ? "up" : "neutral", icon: Users, color: "from-violet-500 to-purple-600", link: "/employees" },
          { label: "Pending Leaves", value: pendingLeaves.toString(), change: "awaiting approval", trend: pendingLeaves > 5 ? "down" : "neutral", icon: CalendarDays, color: "from-amber-500 to-orange-500", link: "/leave" },
          { label: "Open Positions", value: openPositions.toString(), change: "active hiring", trend: "neutral", icon: Briefcase, color: "from-blue-500 to-cyan-500", link: "/recruitment" },
          { label: "Open Tickets", value: openTickets.toString(), change: "need attention", trend: openTickets > 10 ? "down" : "up", icon: AlertTriangle, color: openTickets > 10 ? "from-red-500 to-orange-500" : "from-emerald-500 to-green-600", link: "/helpdesk" },
          { label: "Goal Progress", value: `${avgGoalProgress}%`, change: `${activeGoals} active goals`, trend: avgGoalProgress >= 60 ? "up" : "down", icon: Target, color: "from-pink-500 to-rose-600", link: "/performance" },
        ].map(kpi => (
          <Link key={kpi.label} href={kpi.link}>
            <Card className="group hover:shadow-lg transition-all cursor-pointer h-full">
              <CardContent className="flex items-center gap-3.5 p-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${kpi.color} text-white shadow-md transition-transform group-hover:scale-110`}>
                  <kpi.icon className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
                  <p className="text-2xl font-bold">{kpi.value}</p>
                  <p className={cn("text-[10px] flex items-center gap-0.5",
                    kpi.trend === "up" ? "text-emerald-600" : kpi.trend === "down" ? "text-red-600" : "text-muted-foreground"
                  )}>
                    {kpi.trend === "up" && <ArrowUpRight className="h-2.5 w-2.5" />}
                    {kpi.trend === "down" && <ArrowDownRight className="h-2.5 w-2.5" />}
                    {kpi.change}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Secondary KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Pending Expenses", value: `₹${totalExpenseAmount.toLocaleString("en-IN")}`, sub: `${pendingExpenses} claims`, icon: DollarSign, color: "from-teal-500 to-cyan-600" },
          { label: "Training Courses", value: courseStore.items.length.toString(), sub: "available courses", icon: GraduationCap, color: "from-indigo-500 to-blue-600" },
          { label: "On Notice", value: onNotice.toString(), sub: "notice period", icon: AlertTriangle, color: onNotice > 0 ? "from-amber-500 to-orange-500" : "from-emerald-500 to-green-600" },
          { label: "Announcements", value: annStore.items.length.toString(), sub: "company updates", icon: Bell, color: "from-purple-500 to-violet-600" },
        ].map(s => (
          <Card key={s.label} className="group hover:shadow-md transition-all">
            <CardContent className="flex items-center gap-3 p-3.5">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${s.color} text-white shadow-sm transition-transform group-hover:scale-110`}>
                <s.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[9px] font-medium text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold">{s.value}</p>
                <p className="text-[9px] text-muted-foreground">{s.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content */}
      <Tabs value={dashTab} onValueChange={setDashTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="workforce">Workforce</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <div className="space-y-6">
              {/* Department Distribution */}
              <Card>
                <CardHeader className="flex-row items-center justify-between py-3">
                  <CardTitle className="text-sm">Headcount by Department</CardTitle>
                  <Link href="/employees"><Button variant="outline" size="sm" className="text-xs h-7">View All</Button></Link>
                </CardHeader>
                <CardContent>
                  {deptData.length === 0 ? (
                    <div className="flex flex-col items-center py-8 text-muted-foreground">
                      <Users className="h-8 w-8 mb-2 opacity-30" />
                      <p className="text-xs">No employee data yet</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={deptData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <RTooltip content={<CTooltip />} />
                        <Bar dataKey="value" name="Employees" radius={[6, 6, 0, 0]}>
                          {deptData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              {/* Leave Analytics */}
              <Card>
                <CardHeader className="flex-row items-center justify-between py-3">
                  <CardTitle className="text-sm">Leave Distribution</CardTitle>
                  <Link href="/leave"><Button variant="outline" size="sm" className="text-xs h-7">Manage</Button></Link>
                </CardHeader>
                <CardContent>
                  {leaveTypeData.length === 0 ? (
                    <div className="flex flex-col items-center py-8 text-muted-foreground">
                      <CalendarDays className="h-8 w-8 mb-2 opacity-30" />
                      <p className="text-xs">No leave data yet</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={leaveTypeData} cx="50%" cy="50%" innerRadius={40} outerRadius={75} paddingAngle={3} dataKey="value" labelLine={false}>
                            {leaveTypeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                          </Pie>
                          <RTooltip content={<CTooltip />} />
                          <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-2 py-4">
                        <div className="rounded-lg bg-muted/50 p-3 text-center">
                          <p className="text-2xl font-bold">{leaveStore.items.length}</p>
                          <p className="text-[9px] text-muted-foreground">Total Requests</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg bg-muted/50 p-2 text-center">
                            <p className="text-sm font-bold text-emerald-600">{leaveStore.items.filter(l => l.status === "approved").length}</p>
                            <p className="text-[8px] text-muted-foreground">Approved</p>
                          </div>
                          <div className="rounded-lg bg-muted/50 p-2 text-center">
                            <p className="text-sm font-bold text-red-600">{leaveStore.items.filter(l => l.status === "rejected").length}</p>
                            <p className="text-[8px] text-muted-foreground">Rejected</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Sidebar */}
            <div className="space-y-5">
              {/* Pending Actions */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Bell className="h-4 w-4 text-violet-500" />
                    Action Items
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    { count: pendingLeaves, label: "leave requests pending", link: "/leave", icon: CalendarDays, priority: pendingLeaves > 3 ? "high" : "medium" },
                    { count: pendingExpenses, label: "expense claims awaiting", link: "/expenses", icon: DollarSign, priority: "medium" },
                    { count: openTickets, label: "helpdesk tickets open", link: "/helpdesk", icon: AlertTriangle, priority: openTickets > 5 ? "high" : "low" },
                    { count: openPositions, label: "positions to fill", link: "/recruitment", icon: Briefcase, priority: openPositions > 3 ? "high" : "low" },
                  ].filter(a => a.count > 0).map(action => (
                    <Link key={action.label} href={action.link}>
                      <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/50 transition-all cursor-pointer group">
                        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          action.priority === "high" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                          action.priority === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                          "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        )}>
                          <action.icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium">{action.count} {action.label}</p>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                      </div>
                    </Link>
                  ))}
                  {pendingLeaves === 0 && pendingExpenses === 0 && openTickets === 0 && openPositions === 0 && (
                    <div className="text-center py-4 text-muted-foreground">
                      <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-xs">All caught up! No pending actions.</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent Announcements */}
              <Card>
                <CardHeader className="flex-row items-center justify-between py-3">
                  <CardTitle className="text-sm flex items-center gap-2"><Bell className="h-4 w-4 text-blue-500" />Announcements</CardTitle>
                  <Link href="/announcements"><Button variant="outline" size="sm" className="text-xs h-7">View All</Button></Link>
                </CardHeader>
                <CardContent>
                  {recentAnnouncements.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">
                      <Inbox className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-xs">No announcements yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {recentAnnouncements.map(ann => (
                        <div key={ann.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/50 transition-all">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium line-clamp-1">{ann.title}</p>
                            <p className="text-[10px] text-muted-foreground">{ann.author} · {ann.category}</p>
                          </div>
                          {ann.pinned && <Badge variant="outline" className="text-[8px]">Pinned</Badge>}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Quick Links */}
              <Card>
                <CardHeader className="py-3"><CardTitle className="text-sm">Quick Access</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Apply Leave", href: "/leave", icon: CalendarDays, color: "from-violet-500 to-purple-600" },
                      { label: "Payslip", href: "/payslip", icon: DollarSign, color: "from-emerald-500 to-green-600" },
                      { label: "My Profile", href: "/myprofile", icon: Users, color: "from-blue-500 to-cyan-500" },
                      { label: "Clock In", href: "/attendance", icon: Clock, color: "from-amber-500 to-orange-500" },
                      { label: "Helpdesk", href: "/helpdesk", icon: AlertTriangle, color: "from-pink-500 to-rose-600" },
                      { label: "HR Bot", href: "/chatbot", icon: Zap, color: "from-teal-500 to-cyan-600" },
                    ].map(link => (
                      <Link key={link.label} href={link.href}>
                        <div className="flex flex-col items-center gap-1.5 rounded-lg border p-2.5 hover:bg-muted/50 hover:shadow-sm transition-all cursor-pointer group">
                          <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${link.color} text-white shadow-sm transition-transform group-hover:scale-110`}>
                            <link.icon className="h-4 w-4" />
                          </div>
                          <span className="text-[9px] font-medium text-center">{link.label}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Goal Progress */}
              <Card>
                <CardHeader className="flex-row items-center justify-between py-3">
                  <CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4 text-pink-500" />Goal Progress</CardTitle>
                  <Link href="/goals"><Button variant="outline" size="sm" className="text-xs h-7">Manage</Button></Link>
                </CardHeader>
                <CardContent>
                  {goalStore.items.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">
                      <Target className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-xs">No goals set yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {goalStore.items.filter(g => g.status !== "completed").slice(0, 4).map(goal => (
                        <div key={goal.id} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-xs font-medium line-clamp-1">{goal.title}</p>
                            <Badge className={cn("text-[8px] border-0",
                              goal.status === "on_track" ? "status-active" :
                              goal.status === "at_risk" ? "status-pending" : "status-rejected"
                            )}>{goal.status?.replace(/_/g, " ")}</Badge>
                          </div>
                          <Progress value={goal.progress || 0} className="h-1.5" />
                          <div className="flex justify-between mt-1">
                            <p className="text-[9px] text-muted-foreground">{goal.progress || 0}%</p>
                            <p className="text-[9px] text-muted-foreground">Due {goal.dueDate || "TBD"}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Workforce Tab */}
        <TabsContent value="workforce" className="mt-4 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Department Pie */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm">Department Distribution</CardTitle></CardHeader>
              <CardContent>
                {deptData.length === 0 ? (
                  <div className="flex flex-col items-center py-8 text-muted-foreground"><Users className="h-8 w-8 mb-2 opacity-30" /><p className="text-xs">No data</p></div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={deptData} cx="50%" cy="50%" innerRadius={50} outerRadius={100} paddingAngle={3} dataKey="value" labelLine={false}>
                        {deptData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip content={<CTooltip />} />
                      <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Goal Status */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm">Goal Status Distribution</CardTitle></CardHeader>
              <CardContent>
                {goalStatusData.length === 0 ? (
                  <div className="flex flex-col items-center py-8 text-muted-foreground"><Target className="h-8 w-8 mb-2 opacity-30" /><p className="text-xs">No goals data</p></div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={goalStatusData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                      <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <RTooltip content={<CTooltip />} />
                      <Bar dataKey="value" name="Goals" radius={[6, 6, 0, 0]}>
                        {goalStatusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Hiring Trend — ComposedChart */}
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-violet-500" />Hiring vs Attrition Trend</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={hiringTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <RTooltip content={<CTooltip />} />
                  <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="joined" name="Joined" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="attrition" name="Attrition" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="joined" name="Trend" stroke="#06b6d4" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Department Radar Chart */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4 text-emerald-500" />Department Performance Radar</CardTitle></CardHeader>
              <CardContent>
                {deptRadar.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
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

            {/* Attendance Trend — Stacked Area */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-blue-500" />Attendance Trend</CardTitle></CardHeader>
              <CardContent>
                {attendanceTrend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={attendanceTrend}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <RTooltip content={<CTooltip />} />
                      <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                      <Area type="monotone" dataKey="present" name="Present" stackId="1" fill="#10b981" stroke="#10b981" fillOpacity={0.3} />
                      <Area type="monotone" dataKey="wfh" name="WFH" stackId="1" fill="#06b6d4" stroke="#06b6d4" fillOpacity={0.3} />
                      <Area type="monotone" dataKey="absent" name="Absent" stackId="1" fill="#ef4444" stroke="#ef4444" fillOpacity={0.3} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No attendance data</p>}
              </CardContent>
            </Card>
          </div>

          {/* Leave Monthly Trend — LineChart */}
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><CalendarDays className="h-4 w-4 text-amber-500" />Monthly Leave Utilization</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={leaveTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <RTooltip content={<CTooltip />} />
                  <Line type="monotone" dataKey="days" name="Leave Days" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Employee Stats cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Active", value: activeEmployees, total: totalEmployees },
              { label: "Probation", value: empStore.items.filter(e => e.status === "probation").length, total: totalEmployees },
              { label: "On Notice", value: onNotice, total: totalEmployees },
              { label: "New This Month", value: newThisMonth, total: totalEmployees },
            ].map(stat => (
              <Card key={stat.label}>
                <CardContent className="p-4 text-center">
                  <p className="text-3xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
                  {stat.total > 0 && (
                    <Progress value={(stat.value / stat.total) * 100} className="h-1.5 mt-2" />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Operations Tab */}
        <TabsContent value="operations" className="mt-4 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Expense Categories */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm">Expense by Category</CardTitle></CardHeader>
              <CardContent>
                {expenseCatData.length === 0 ? (
                  <div className="flex flex-col items-center py-8 text-muted-foreground"><DollarSign className="h-8 w-8 mb-2 opacity-30" /><p className="text-xs">No expense data</p></div>
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={expenseCatData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                      <XAxis type="number" tick={{ fontSize: 9 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={80} />
                      <RTooltip content={<CTooltip />} />
                      <Bar dataKey="value" name="Amount (₹)" radius={[0, 6, 6, 0]} fill="#8b5cf6" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Ticket Summary */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm">Helpdesk Summary</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Open", value: ticketStore.items.filter(t => t.status === "open").length, color: "text-red-600" },
                    { label: "In Progress", value: ticketStore.items.filter(t => t.status === "in_progress").length, color: "text-blue-600" },
                    { label: "Resolved", value: ticketStore.items.filter(t => t.status === "resolved").length, color: "text-emerald-600" },
                    { label: "Total", value: ticketStore.items.length, color: "text-foreground" },
                  ].map(stat => (
                    <div key={stat.label} className="rounded-lg border p-3 text-center">
                      <p className={cn("text-2xl font-bold", stat.color)}>{stat.value}</p>
                      <p className="text-[9px] text-muted-foreground">{stat.label}</p>
                    </div>
                  ))}
                </div>

                {/* Recruitment Pipeline */}
                <Separator className="my-4" />
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recruitment Pipeline</h4>
                <div className="space-y-2">
                  {[
                    { label: "Open Positions", value: jobStore.items.filter(j => j.status === "open").length },
                    { label: "Total Applicants", value: jobStore.items.reduce((s, j) => s + (j.applicants || 0), 0) },
                    { label: "Total Openings", value: jobStore.items.reduce((s, j) => s + (j.openings || 0), 0) },
                  ].map(stat => (
                    <div key={stat.label} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                      <span className="text-xs text-muted-foreground">{stat.label}</span>
                      <span className="text-sm font-bold">{stat.value}</span>
                    </div>
                  ))}
                </div>

                {/* Course Stats */}
                <Separator className="my-4" />
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Training & Learning</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-muted/30 p-2 text-center">
                    <p className="text-lg font-bold">{courseStore.items.length}</p>
                    <p className="text-[8px] text-muted-foreground">Courses</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 p-2 text-center">
                    <p className="text-lg font-bold">{courseStore.items.filter(c => c.mandatory).length}</p>
                    <p className="text-[8px] text-muted-foreground">Mandatory</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
