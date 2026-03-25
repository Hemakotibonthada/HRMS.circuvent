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
  Briefcase, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useRBAC } from "@/hooks/use-rbac";
import {
  useEmployeeStore, useLeaveStore, useGoalStore, useAttendanceStore,
  useExpenseStore, useTicketStore, startSync,
} from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { useEffect } from "react";
import Link from "next/link";

const QUICK_ACTIONS = [
  { label: "Apply Leave", icon: CalendarDays, href: "/leave", color: "from-blue-500 to-cyan-500" },
  { label: "View Payslip", icon: DollarSign, href: "/payroll", color: "from-green-500 to-emerald-500" },
  { label: "Clock In", icon: Clock, href: "/attendance", color: "from-orange-500 to-amber-500" },
  { label: "Helpdesk", icon: Headphones, href: "/helpdesk", color: "from-purple-500 to-violet-500" },
  { label: "Training", icon: GraduationCap, href: "/training", color: "from-pink-500 to-rose-500" },
  { label: "HR Bot", icon: Bot, href: "/hrbot", color: "from-indigo-500 to-blue-500" },
  { label: "My Goals", icon: Target, href: "/goals", color: "from-teal-500 to-cyan-500" },
  { label: "Expenses", icon: FileText, href: "/expenses", color: "from-red-500 to-orange-500" },
] as const;

export default function SelfServicePage() {
  const { user } = useAuth();
  const { role } = useRBAC();
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

  const anyLoading = empStore.loading || leaveStore.loading || goalStore.loading;

  if (anyLoading && !empStore.initialized) return <DataLoadingSkeleton rows={6} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Self Service</h1>
          <p className="text-muted-foreground">
            Welcome back, {user?.displayName || user?.email || "Employee"} — {role}
          </p>
        </div>
        {myProfile && (
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
            <Briefcase className="h-3.5 w-3.5" />
            {myProfile.department} · {myProfile.designation}
          </Badge>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Leave Balance", value: `${approvedLeaves} approved`, sub: `${pendingLeaves} pending · ${totalLeaveDays} days used`, icon: CalendarDays, color: "text-blue-600" },
          { label: "Active Goals", value: activeGoals, sub: `${completedGoals} completed · ${goalProgress}% avg`, icon: Target, color: "text-green-600" },
          { label: "Attendance Days", value: attendanceDays, sub: `Total recorded sessions`, icon: Clock, color: "text-orange-600" },
          { label: "Open Tickets", value: openTickets, sub: `${pendingExpenses} pending expenses`, icon: Headphones, color: "text-purple-600" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
                  <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{kpi.sub}</p>
                </div>
                <div className={cn("h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center", kpi.color)}>
                  <kpi.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="actions">
        <TabsList>
          <TabsTrigger value="actions">Quick Actions</TabsTrigger>
          <TabsTrigger value="activity">Recent Activity</TabsTrigger>
          <TabsTrigger value="goals">My Goals</TabsTrigger>
        </TabsList>

        {/* Quick Actions Grid */}
        <TabsContent value="actions">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_ACTIONS.map((action) => (
              <Link key={action.label} href={action.href}>
                <Card className="cursor-pointer hover:shadow-md transition-all group">
                  <CardContent className="p-5 flex items-center gap-4">
                    <div className={cn("h-12 w-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shrink-0", action.color)}>
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

        {/* Recent Activity — from real stores */}
        <TabsContent value="activity">
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
                  {myExpenses.slice(0, 2).map((ex) => (
                    <div key={ex.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                      <DollarSign className="h-4 w-4 text-green-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">Expense: {ex.category}</p>
                        <p className="text-xs text-muted-foreground">₹{ex.amount?.toLocaleString()}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{ex.status}</Badge>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* My Goals tab */}
        <TabsContent value="goals">
          <Card>
            <CardHeader><CardTitle className="text-base">My Goals</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {myGoals.length === 0 ? (
                <DataEmptyState {...EMPTY_STATES.goals} compact />
              ) : (
                myGoals.map((g) => (
                  <div key={g.id} className="flex items-center gap-3 p-3 rounded-lg border">
                    <Target className={cn("h-5 w-5 shrink-0", g.status === "completed" ? "text-green-600" : g.status === "at-risk" ? "text-red-500" : "text-blue-500")} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{g.title}</p>
                      <p className="text-xs text-muted-foreground">{g.category} · Due {g.dueDate}</p>
                      <Progress value={g.progress || 0} className="h-1.5 mt-1.5" />
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold">{g.progress || 0}%</p>
                      <Badge variant="outline" className="text-xs mt-0.5">{g.status}</Badge>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
