"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  User, CalendarDays, DollarSign, Clock, Headphones, GraduationCap,
  Bot, Target, FileText, ArrowRight, Activity, CheckCircle2, AlertTriangle,
  Briefcase, TrendingUp, Shield, UserCog, Users,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line,
} from "recharts";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useRBAC } from "@/hooks/use-rbac";
import {
  useEmployeeStore, useLeaveStore, useGoalStore, useAttendanceStore,
  useExpenseStore, useTicketStore, startSync,
} from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { useEffect } from "react";
import Link from "next/link";

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];

const QUICK_ACTIONS_EMPLOYEE = [
  { label: "Apply Leave", icon: CalendarDays, href: "/leave", color: "from-blue-500 to-cyan-500" },
  { label: "View Payslip", icon: DollarSign, href: "/payslip", color: "from-green-500 to-emerald-500" },
  { label: "Clock In", icon: Clock, href: "/attendance", color: "from-orange-500 to-amber-500" },
  { label: "Helpdesk", icon: Headphones, href: "/helpdesk", color: "from-purple-500 to-violet-500" },
  { label: "Training", icon: GraduationCap, href: "/training", color: "from-pink-500 to-rose-500" },
  { label: "HR Bot", icon: Bot, href: "/chatbot", color: "from-indigo-500 to-blue-500" },
  { label: "My Goals", icon: Target, href: "/performance", color: "from-teal-500 to-cyan-500" },
  { label: "Expenses", icon: FileText, href: "/expenses", color: "from-red-500 to-orange-500" },
] as const;

const QUICK_ACTIONS_MANAGER = [
  { label: "Approve Leaves", icon: CheckCircle2, href: "/leave", color: "from-emerald-500 to-green-500" },
  { label: "Approve Expenses", icon: DollarSign, href: "/expenses", color: "from-violet-500 to-purple-500" },
  { label: "Team Goals", icon: Target, href: "/performance", color: "from-blue-500 to-cyan-500" },
  { label: "Analytics", icon: TrendingUp, href: "/analytics", color: "from-pink-500 to-rose-500" },
] as const;

const QUICK_ACTIONS_HR = [
  { label: "Employees", icon: Users, href: "/employees", color: "from-violet-500 to-purple-500" },
  { label: "Recruitment", icon: UserCog, href: "/recruitment", color: "from-blue-500 to-cyan-500" },
  { label: "Payroll", icon: DollarSign, href: "/payroll", color: "from-emerald-500 to-green-500" },
  { label: "Reports", icon: TrendingUp, href: "/reports", color: "from-amber-500 to-orange-500" },
] as const;

const QUICK_ACTIONS_ADMIN = [
  { label: "Admin Console", icon: Shield, href: "/admin", color: "from-slate-600 to-zinc-700" },
  { label: "Settings", icon: UserCog, href: "/settings", color: "from-violet-500 to-purple-500" },
  { label: "Audit Log", icon: Activity, href: "/audit", color: "from-blue-500 to-cyan-500" },
  { label: "Analytics", icon: TrendingUp, href: "/analytics", color: "from-emerald-500 to-green-500" },
] as const;

export default function SelfServicePage() {
  const { user } = useAuth();
  const { role, isAdmin } = useRBAC();
  const empStore = useEmployeeStore();
  const leaveStore = useLeaveStore();
  const goalStore = useGoalStore();
  const attendanceStore = useAttendanceStore();
  const expenseStore = useExpenseStore();
  const ticketStore = useTicketStore();

  useEffect(() => {
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
    if (!leaveStore.initialized) startSync(COLLECTIONS.leaves, leaveStore);
    if (!goalStore.initialized) startSync(COLLECTIONS.goals, goalStore);
    if (!attendanceStore.initialized) startSync(COLLECTIONS.attendance, attendanceStore);
    if (!expenseStore.initialized) startSync(COLLECTIONS.expenses, expenseStore);
    if (!ticketStore.initialized) startSync(COLLECTIONS.helpdesk, ticketStore);
  }, [empStore, leaveStore, goalStore, attendanceStore, expenseStore, ticketStore]);

  const myProfile = useMemo(() => {
    if (!user?.email) return null;
    return empStore.items.find(
      (e) => e.email?.toLowerCase() === user.email?.toLowerCase()
    );
  }, [empStore.items, user]);

  const myLeaves = useMemo(() => {
    if (!myProfile) return [];
    return leaveStore.items.filter((l) => l.employeeId === myProfile.id);
  }, [leaveStore.items, myProfile]);

  const myGoals = useMemo(() => {
    if (!myProfile) return [];
    return goalStore.items.filter((g) => g.employeeId === myProfile.id);
  }, [goalStore.items, myProfile]);

  const myAttendance = useMemo(() => {
    if (!myProfile) return [];
    return attendanceStore.items.filter((a) => a.employeeId === myProfile.id);
  }, [attendanceStore.items, myProfile]);

  const myExpenses = useMemo(() => {
    if (!myProfile) return [];
    return expenseStore.items.filter((ex) => ex.employeeId === myProfile.id);
  }, [expenseStore.items, myProfile]);

  const myTickets = useMemo(() => {
    if (!myProfile) return [];
    return ticketStore.items.filter(
      (t) => t.reporterName?.toLowerCase() === `${myProfile.firstName} ${myProfile.lastName}`.toLowerCase()
    );
  }, [ticketStore.items, myProfile]);

  // Computed KPIs
  const approvedLeaves = myLeaves.filter((l) => l.status === "approved").length;
  const pendingLeaves = myLeaves.filter((l) => l.status === "pending").length;
  const totalLeaveDays = myLeaves.filter((l) => l.status === "approved").reduce((s, l) => s + (l.days || 0), 0);
  const activeGoals = myGoals.filter((g) => g.status !== "completed").length;
  const completedGoals = myGoals.filter((g) => g.status === "completed").length;
  const goalProgress = myGoals.length > 0
    ? Math.round(myGoals.reduce((s, g) => s + (g.progress || 0), 0) / myGoals.length)
    : 0;
  const attendanceDays = myAttendance.length;
  const pendingExpenses = myExpenses.filter((e) => e.status === "pending").length;
  const openTickets = myTickets.filter((t) => t.status !== "resolved" && t.status !== "closed").length;

  // ── Chart Data ──────────────────────────────────────────
  const leaveByType = useMemo(() => {
    const m: Record<string, number> = {};
    myLeaves.forEach(l => { m[l.leaveType || "Other"] = (m[l.leaveType || "Other"] || 0) + (l.days || 1); });
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, [myLeaves]);

  const expenseByCategory = useMemo(() => {
    const m: Record<string, number> = {};
    myExpenses.forEach(e => { m[e.category || "Other"] = (m[e.category || "Other"] || 0) + (e.amount || 0); });
    return Object.entries(m).map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [myExpenses]);

  const attendanceTrend = useMemo(() => {
    const byDate: Record<string, number> = {};
    myAttendance.forEach(a => {
      if (!a.date) return;
      byDate[a.date.substring(5)] = a.hours || 0;
    });
    return Object.entries(byDate).sort().slice(-10).map(([date, hours]) => ({ date, hours }));
  }, [myAttendance]);

  const goalRadar = useMemo(() => {
    const cats: Record<string, { total: number; sum: number }> = {};
    myGoals.forEach(g => {
      const c = g.category || "General";
      if (!cats[c]) cats[c] = { total: 0, sum: 0 };
      cats[c].total++;
      cats[c].sum += (g.progress || 0);
    });
    return Object.entries(cats).map(([name, v]) => ({
      category: name.length > 10 ? name.substring(0, 10) + "…" : name,
      progress: v.total > 0 ? Math.round(v.sum / v.total) : 0,
    }));
  }, [myGoals]);

  // Manager: team data
  const teamLeaves = useMemo(() => {
    if (role !== "manager" && role !== "hr" && role !== "admin") return [];
    if (!myProfile?.department) return leaveStore.items.filter(l => l.status === "pending");
    return leaveStore.items.filter(l => l.department === myProfile.department && l.status === "pending");
  }, [leaveStore.items, myProfile, role]);

  const teamExpenses = useMemo(() => {
    if (role !== "manager" && role !== "hr" && role !== "admin") return [];
    if (!myProfile?.department) return expenseStore.items.filter(e => e.status === "pending" || e.status === "submitted");
    return expenseStore.items.filter(e => e.department === myProfile.department && (e.status === "pending" || e.status === "submitted"));
  }, [expenseStore.items, myProfile, role]);

  const quickActions = role === "admin"
    ? [...QUICK_ACTIONS_EMPLOYEE, ...QUICK_ACTIONS_ADMIN]
    : role === "hr"
    ? [...QUICK_ACTIONS_EMPLOYEE, ...QUICK_ACTIONS_HR]
    : role === "manager"
    ? [...QUICK_ACTIONS_EMPLOYEE, ...QUICK_ACTIONS_MANAGER]
    : QUICK_ACTIONS_EMPLOYEE;

  const anyLoading = empStore.loading || leaveStore.loading || goalStore.loading;

  if (anyLoading && !empStore.initialized) return <DataLoadingSkeleton rows={6} />;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="animate-slide-up">
        <div className={cn("rounded-2xl p-6 text-white shadow-xl bg-gradient-to-br",
          role === "admin" ? "from-slate-800 via-zinc-800 to-slate-900" :
          role === "hr" ? "from-violet-500 via-purple-500 to-indigo-600" :
          role === "manager" ? "from-amber-500 via-orange-500 to-amber-600" :
          "from-blue-500 via-cyan-500 to-teal-600"
        )}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">
                {role === "admin" ? "Admin" : role === "hr" ? "HR Manager" : role === "manager" ? "Manager" : "Employee"} Self Service
              </h1>
              <p className="text-white/70 text-sm mt-1">
                Welcome back, {user?.displayName || user?.email || "User"}
              </p>
              <div className="flex gap-2 mt-2">
                <Badge className="bg-white/20 text-white border-0 text-xs capitalize">{role}</Badge>
                {myProfile && <Badge className="bg-white/20 text-white border-0 text-xs">{myProfile.department}</Badge>}
                {(role === "manager" || role === "hr") && teamLeaves.length > 0 && (
                  <Badge className="bg-red-500/30 text-white border-0 text-xs">{teamLeaves.length} pending approvals</Badge>
                )}
              </div>
            </div>
            {myProfile && (
              <div className="hidden md:grid grid-cols-3 gap-3">
                {[
                  { label: "Leave Days", value: totalLeaveDays },
                  { label: "Goals", value: `${completedGoals}/${myGoals.length}` },
                  { label: "Attendance", value: attendanceDays },
                ].map(s => (
                  <div key={s.label} className="text-center bg-white/10 backdrop-blur-sm rounded-xl px-4 py-2">
                    <p className="text-lg font-bold">{s.value}</p>
                    <p className="text-[9px] text-white/60">{s.label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Leave Balance", value: `${approvedLeaves} approved`, sub: `${pendingLeaves} pending · ${totalLeaveDays} days used`, icon: CalendarDays, color: "from-blue-500 to-cyan-500" },
          { label: "Active Goals", value: activeGoals, sub: `${completedGoals} completed · ${goalProgress}% avg`, icon: Target, color: "from-emerald-500 to-green-500" },
          { label: "Attendance Days", value: attendanceDays, sub: `Total recorded sessions`, icon: Clock, color: "from-amber-500 to-orange-500" },
          { label: "Open Tickets", value: openTickets, sub: `${pendingExpenses} pending expenses`, icon: Headphones, color: "from-violet-500 to-purple-500" },
        ].map((kpi) => (
          <Card key={kpi.label} className="group hover:shadow-md transition-all">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
                  <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{kpi.sub}</p>
                </div>
                <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shadow-sm transition-transform group-hover:scale-110", kpi.color)}>
                  <kpi.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="actions">
        <TabsList className="flex-wrap">
          <TabsTrigger value="actions">Quick Actions</TabsTrigger>
          <TabsTrigger value="charts">My Analytics</TabsTrigger>
          <TabsTrigger value="activity">Recent Activity</TabsTrigger>
          <TabsTrigger value="goals">My Goals</TabsTrigger>
          {(role === "manager" || role === "hr" || isAdmin) && (
            <TabsTrigger value="approvals">Approvals ({teamLeaves.length + teamExpenses.length})</TabsTrigger>
          )}
        </TabsList>

        {/* Quick Actions Grid */}
        <TabsContent value="actions" className="mt-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {quickActions.map((action) => (
              <Link key={action.label} href={action.href}>
                <Card className="cursor-pointer hover:shadow-md transition-all group h-full">
                  <CardContent className="p-5 flex items-center gap-4">
                    <div className={cn("h-12 w-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shrink-0 shadow-sm transition-transform group-hover:scale-110", action.color)}>
                      <action.icon className="h-6 w-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{action.label}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </TabsContent>

        {/* Personal Analytics Charts */}
        <TabsContent value="charts" className="mt-4 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Leave Usage Donut */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><CalendarDays className="h-4 w-4 text-blue-500" />My Leave Usage</CardTitle></CardHeader>
              <CardContent>
                {leaveByType.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={leaveByType} cx="50%" cy="50%" innerRadius={45} outerRadius={85} paddingAngle={3} dataKey="value" labelLine={false}>
                        {leaveByType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No leave data yet</p>}
              </CardContent>
            </Card>

            {/* Expense Breakdown */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4 text-emerald-500" />My Expense Breakdown</CardTitle></CardHeader>
              <CardContent>
                {expenseByCategory.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={expenseByCategory} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                      <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={v => `₹${v.toLocaleString()}`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                      <RTooltip />
                      <Bar dataKey="value" name="Amount (₹)" radius={[0, 6, 6, 0]}>
                        {expenseByCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No expense data yet</p>}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Attendance Trend — LineChart */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-amber-500" />My Work Hours Trend</CardTitle></CardHeader>
              <CardContent>
                {attendanceTrend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={attendanceTrend}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <RTooltip />
                      <Area type="monotone" dataKey="hours" name="Hours" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No attendance data yet</p>}
              </CardContent>
            </Card>

            {/* Goal Radar */}
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4 text-violet-500" />Goal Progress by Category</CardTitle></CardHeader>
              <CardContent>
                {goalRadar.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <RadarChart data={goalRadar}>
                      <PolarGrid stroke="hsl(var(--border))" />
                      <PolarAngleAxis dataKey="category" tick={{ fontSize: 10 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                      <Radar name="Progress" dataKey="progress" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.25} strokeWidth={2} />
                      <RTooltip />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : <p className="text-center text-xs text-muted-foreground py-12">No goals data yet</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Recent Activity — from real stores */}
        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {myLeaves.length === 0 && myGoals.length === 0 && myAttendance.length === 0 ? (
                <DataEmptyState
                  icon={Activity}
                  title="No recent activity"
                  description="Your leave requests, goals, and attendance records will appear here."
                  compact
                />
              ) : (
                <>
                  {myLeaves.slice(0, 3).map((l) => (
                    <div key={l.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                      <CalendarDays className="h-4 w-4 text-blue-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">Leave: {l.leaveType}</p>
                        <p className="text-xs text-muted-foreground">{l.fromDate} — {l.days} day(s)</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{l.status}</Badge>
                    </div>
                  ))}
                  {myAttendance.slice(0, 3).map((a) => (
                    <div key={a.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                      <Clock className="h-4 w-4 text-orange-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">Attendance: {a.date}</p>
                        <p className="text-xs text-muted-foreground">{a.clockIn} – {a.clockOut} · {a.hours}h</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{a.status}</Badge>
                    </div>
                  ))}
                  {myExpenses.slice(0, 3).map((e) => (
                    <div key={e.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                      <DollarSign className="h-4 w-4 text-green-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{e.category}: ₹{e.amount?.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">{e.date}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{e.status}</Badge>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* My Goals */}
        <TabsContent value="goals" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">My Goals</CardTitle><Link href="/performance"><Button variant="outline" size="sm" className="text-xs">Manage</Button></Link></CardHeader>
            <CardContent>
              {myGoals.length === 0 ? (
                <DataEmptyState icon={Target} title="No goals set" description="Set performance goals to track your progress." compact />
              ) : (
                <div className="space-y-3">
                  {myGoals.map((goal) => (
                    <div key={goal.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-medium line-clamp-1">{goal.title}</p>
                        <Badge className={cn("text-[8px] border-0",
                          goal.status === "on_track" || goal.status === "completed" ? "status-active" :
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
        </TabsContent>

        {/* Manager/HR/Admin Approvals Tab */}
        {(role === "manager" || role === "hr" || isAdmin) && (
          <TabsContent value="approvals" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />Pending Leave Approvals ({teamLeaves.length})</CardTitle></CardHeader>
              <CardContent>
                {teamLeaves.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground py-6">No pending leave requests</p>
                ) : (
                  <div className="space-y-2">
                    {teamLeaves.slice(0, 10).map(l => (
                      <div key={l.id} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50">
                        <CalendarDays className="h-4 w-4 text-blue-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">{l.employeeName}</p>
                          <p className="text-[10px] text-muted-foreground">{l.leaveType} · {l.fromDate} — {l.days} day(s)</p>
                        </div>
                        <Badge className="status-pending text-[8px]">Pending</Badge>
                        <Link href="/leave"><Button size="sm" variant="outline" className="text-xs h-7">Review</Button></Link>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4 text-emerald-500" />Pending Expense Approvals ({teamExpenses.length})</CardTitle></CardHeader>
              <CardContent>
                {teamExpenses.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground py-6">No pending expense claims</p>
                ) : (
                  <div className="space-y-2">
                    {teamExpenses.slice(0, 10).map(e => (
                      <div key={e.id} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50">
                        <DollarSign className="h-4 w-4 text-emerald-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">{e.employeeName}</p>
                          <p className="text-[10px] text-muted-foreground">{e.category} · ₹{e.amount?.toLocaleString()}</p>
                        </div>
                        <Badge className="status-pending text-[8px]">Pending</Badge>
                        <Link href="/expenses"><Button size="sm" variant="outline" className="text-xs h-7">Review</Button></Link>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
