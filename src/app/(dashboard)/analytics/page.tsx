"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  BarChart3, Users, TrendingUp, TrendingDown, CalendarDays,
  DollarSign, Briefcase, Clock, Target, Award, Activity,
  Building2, UserPlus, UserMinus, Percent, ArrowUpRight,
  ArrowDownRight, Star, Zap, Heart, CheckCircle2,
  AlertTriangle, PieChart as PieIcon, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, AreaChart, Area, LineChart, Line,
  Tooltip as RTooltip, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, ComposedChart, ScatterChart, Scatter, ZAxis,
} from "recharts";
import {
  useEmployeeStore, useLeaveStore, useExpenseStore,
  useJobStore, useAttendanceStore, startSync,
  type EmployeeDoc,
} from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// HR ANALYTICS — Comprehensive dashboard with workforce, leave,
// expense, recruitment, and engagement analytics computed from
// real Zustand store data backed by Firestore
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const DEPARTMENTS = ["Engineering", "HR", "Design", "Sales", "Marketing", "Finance", "Support", "Operations"];

export default function AnalyticsPage() {
  const empStore = useEmployeeStore();
  const leaveStore = useLeaveStore();
  const expenseStore = useExpenseStore();
  const jobStore = useJobStore();
  const attStore = useAttendanceStore();

  const [tab, setTab] = useState("workforce");
  const [deptFilter, setDeptFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("all");

  // Initialize all stores
  useEffect(() => { if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore); }, [empStore.initialized, empStore]);
  useEffect(() => { if (!leaveStore.initialized) startSync(COLLECTIONS.leaves, leaveStore); }, [leaveStore.initialized, leaveStore]);
  useEffect(() => { if (!expenseStore.initialized) startSync(COLLECTIONS.expenses, expenseStore); }, [expenseStore.initialized, expenseStore]);
  useEffect(() => { if (!jobStore.initialized) startSync(COLLECTIONS.recruitment, jobStore); }, [jobStore.initialized, jobStore]);
  useEffect(() => { if (!attStore.initialized) startSync(COLLECTIONS.attendance, attStore); }, [attStore.initialized, attStore]);

  // The recruitment funnel below used to split the applicant total across
  // fixed 60/30/10/5% stages, so it drew the same shape no matter how many
  // candidates actually advanced. Real per-stage counts come from the
  // application event log via the same report ats/page.tsx already uses.
  const [funnelStages, setFunnelStages] = useState<{ name: string; entered: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ats/reports?report=funnel");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "Could not load the pipeline funnel");
        setFunnelStages(data.stages ?? []);
      } catch {
        if (!cancelled) setFunnelStages([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loading = (empStore.loading && !empStore.initialized);
  const employees = empStore.items;
  const leaves = leaveStore.items;
  const expenses = expenseStore.items;
  const jobs = jobStore.items;
  const attendance = attStore.items;

  // ── Global KPIs ──────────────────────────────────────────
  const totalEmployees = employees.length;
  const activeEmployees = employees.filter(e => e.status === "active").length;
  const attritionRate = totalEmployees > 0
    ? Math.round((employees.filter(e => e.status === "notice_period" || e.status === "terminated").length / totalEmployees) * 100)
    : 0;
  const avgTenure = useMemo(() => {
    if (employees.length === 0) return "0";
    const now = new Date();
    const totalMonths = employees.reduce((s, e) => {
      if (!e.joiningDate) return s;
      const d = new Date(e.joiningDate);
      return s + (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30);
    }, 0);
    const avg = totalMonths / employees.length;
    return avg >= 12 ? `${(avg / 12).toFixed(1)}y` : `${Math.round(avg)}m`;
  }, [employees]);
  // eNPS requires survey responses, which this page does not load. It was
  // previously Math.random() presented as a measured score; null renders as a
  // dash rather than a fabricated number.
  const eNPS: number | null = null;

  // ── Workforce Analytics ──────────────────────────────────
  const headcountByDept = useMemo(() => {
    const counts: Record<string, number> = {};
    employees.forEach(e => {
      counts[e.department || "Other"] = (counts[e.department || "Other"] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [employees]);

  const employmentTypeData = useMemo(() => {
    const counts: Record<string, number> = {};
    employees.forEach(e => {
      counts[e.employmentType || "Full-time"] = (counts[e.employmentType || "Full-time"] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [employees]);

  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    employees.forEach(e => {
      counts[e.status || "active"] = (counts[e.status || "active"] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name: name.replace("_", " "), value }));
  }, [employees]);

  const hiringTrend = useMemo(() => {
    const byMonth: Record<string, number> = {};
    employees.forEach(e => {
      if (!e.joiningDate) return;
      const d = new Date(e.joiningDate);
      const key = d.toLocaleString("default", { month: "short", year: "2-digit" });
      byMonth[key] = (byMonth[key] || 0) + 1;
    });
    return Object.entries(byMonth).slice(-12).map(([name, value]) => ({ name, value }));
  }, [employees]);

  const locationData = useMemo(() => {
    const counts: Record<string, number> = {};
    employees.forEach(e => {
      counts[e.location || "Unknown"] = (counts[e.location || "Unknown"] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [employees]);

  // ── Leave Analytics ──────────────────────────────────────
  const leaveByType = useMemo(() => {
    const counts: Record<string, number> = {};
    leaves.filter(l => l.status === "approved").forEach(l => {
      counts[l.leaveType || "casual"] = (counts[l.leaveType || "casual"] || 0) + (l.days || 0);
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [leaves]);

  const leaveByDept = useMemo(() => {
    const counts: Record<string, number> = {};
    leaves.filter(l => l.status === "approved").forEach(l => {
      counts[l.department || "Other"] = (counts[l.department || "Other"] || 0) + (l.days || 0);
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [leaves]);

  const leaveStatusData = useMemo(() => {
    const counts: Record<string, number> = {};
    leaves.forEach(l => {
      counts[l.status || "pending"] = (counts[l.status || "pending"] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [leaves]);

  const leaveMonthly = useMemo(() => {
    const byMonth: Record<string, number> = {};
    leaves.forEach(l => {
      if (!l.fromDate) return;
      const d = new Date(l.fromDate);
      const key = d.toLocaleString("default", { month: "short" });
      byMonth[key] = (byMonth[key] || 0) + (l.days || 0);
    });
    return Object.entries(byMonth).map(([name, value]) => ({ name, value }));
  }, [leaves]);

  const totalLeaveDays = leaves.filter(l => l.status === "approved").reduce((s, l) => s + (l.days || 0), 0);
  const avgLeavePerEmp = totalEmployees > 0 ? (totalLeaveDays / totalEmployees).toFixed(1) : "0";
  const pendingLeaves = leaves.filter(l => l.status === "pending").length;

  // ── Expense Analytics ────────────────────────────────────
  const expenseByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    expenses.forEach(e => {
      counts[e.category || "Other"] = (counts[e.category || "Other"] || 0) + (e.amount || 0);
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [expenses]);

  const expenseByDept = useMemo(() => {
    const counts: Record<string, number> = {};
    expenses.forEach(e => {
      counts[e.department || "Other"] = (counts[e.department || "Other"] || 0) + (e.amount || 0);
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [expenses]);

  const expenseMonthly = useMemo(() => {
    const byMonth: Record<string, number> = {};
    expenses.forEach(e => {
      if (!e.date) return;
      const d = new Date(e.date);
      const key = d.toLocaleString("default", { month: "short" });
      byMonth[key] = (byMonth[key] || 0) + (e.amount || 0);
    });
    return Object.entries(byMonth).map(([name, value]) => ({ name, value }));
  }, [expenses]);

  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const avgExpensePerEmp = totalEmployees > 0 ? Math.round(totalExpenses / totalEmployees) : 0;
  const pendingExpenses = expenses.filter(e => e.status === "submitted" || e.status === "pending").length;

  // ── Recruitment Analytics ────────────────────────────────
  const recruitByDept = useMemo(() => {
    const counts: Record<string, number> = {};
    jobs.forEach(j => {
      counts[j.department || "Other"] = (counts[j.department || "Other"] || 0) + (j.openings || 0);
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [jobs]);

  const recruitFunnel = useMemo(
    () => funnelStages.map(s => ({ name: s.name, value: s.entered })),
    [funnelStages]
  );

  const openPositions = jobs.filter(j => j.status === "open").length;
  const totalApplicants = jobs.reduce((s, j) => s + (j.applicants || 0), 0);

  // ── Attendance Analytics ─────────────────────────────────
  const attendanceRate = useMemo(() => {
    if (attendance.length === 0) return [];
    const byDate: Record<string, { present: number; total: number }> = {};
    attendance.forEach(a => {
      if (!a.date) return;
      if (!byDate[a.date]) byDate[a.date] = { present: 0, total: 0 };
      byDate[a.date].total++;
      if (a.status === "present" || a.status === "late" || a.status === "wfh") byDate[a.date].present++;
    });
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-15)
      .map(([name, v]) => ({
        name: name.slice(5),
        rate: v.total > 0 ? Math.round((v.present / v.total) * 100) : 0,
      }));
  }, [attendance]);

  // ── Department Heath Radar ───────────────────────────────
  const deptRadar = useMemo(() => {
    return headcountByDept.slice(0, 6).map(d => ({
      dept: d.name.length > 10 ? d.name.substring(0, 10) + "…" : d.name,
      headcount: d.value,
      leaveUtil: Math.round(leaves.filter(l => l.department === d.name && l.status === "approved").reduce((s, l) => s + (l.days || 0), 0) / Math.max(d.value, 1) * 10),
      expenses: Math.min(100, Math.round(expenses.filter(e => e.department === d.name).reduce((s, e) => s + (e.amount || 0), 0) / 10000)),
      // A "tickets" field used to sit here (open job count * 20, capped at
      // 100) even though this page has no support-ticket data — the name
      // claimed something never measured. It was never wired into a <Radar>
      // axis below, so removing it changes nothing on screen.
    }));
  }, [headcountByDept, leaves, expenses]);

  // ── Tenure scatter ───────────────────────────────────────
  const tenureScatter = useMemo(() => {
    return employees.filter(e => e.joiningDate).map(e => {
      const months = Math.round((new Date().getTime() - new Date(e.joiningDate!).getTime()) / (1000 * 60 * 60 * 24 * 30));
      return { name: e.firstName || "?", tenure: months, department: e.department || "Other" };
    });
  }, [employees]);

  // ── Monthly expense vs hiring composed ───────────────────
  const monthlyComposed = useMemo(() => {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months.map((m, i) => ({
      month: m,
      hired: employees.filter(e => e.joiningDate && new Date(e.joiningDate).getMonth() === i).length,
      expenses: expenses.filter(e => e.date && new Date(e.date).getMonth() === i).reduce((s, e) => s + (e.amount || 0), 0),
      leaves: leaves.filter(l => l.fromDate && new Date(l.fromDate).getMonth() === i).reduce((s, l) => s + (l.days || 0), 0),
    }));
  }, [employees, expenses, leaves]);

  if (loading) return <DataLoadingSkeleton />;
  if (employees.length === 0 && leaves.length === 0 && expenses.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.analytics} />;
  }

  const globalKpis = [
    { label: "Total Employees", value: totalEmployees, change: `+${employees.filter(e => { const d = new Date(e.joiningDate || ""); const now = new Date(); return d.getMonth() === now.getMonth(); }).length} this month`, up: true, icon: Users, gradient: "from-violet-500 to-purple-600" },
    { label: "Attrition Rate", value: `${attritionRate}%`, change: attritionRate > 10 ? "Above target" : "On track", up: attritionRate <= 10, icon: TrendingDown, gradient: "from-red-500 to-rose-600" },
    { label: "Avg Tenure", value: avgTenure, change: "Across workforce", up: true, icon: Clock, gradient: "from-blue-500 to-cyan-500" },
    { label: "eNPS Score", value: eNPS ?? "—", change: eNPS === null ? "Survey data not connected" : eNPS >= 70 ? "Excellent" : "Good", up: (eNPS ?? 0) >= 70, icon: Heart, gradient: "from-emerald-500 to-green-600" },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">HR Analytics</h1>
          <p className="text-muted-foreground mt-1">Comprehensive workforce insights and trends</p>
        </div>
        <div className="flex gap-2">
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Department" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={periodFilter} onValueChange={setPeriodFilter}>
            <SelectTrigger className="w-[130px]"><SelectValue placeholder="Period" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="quarter">This Quarter</SelectItem>
              <SelectItem value="year">This Year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Global KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {globalKpis.map((kpi) => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                  <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                  <p className={cn("text-xs mt-1 flex items-center gap-1", kpi.up ? "text-emerald-600" : "text-red-600")}>
                    {kpi.up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {kpi.change}
                  </p>
                </div>
                <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.gradient)}>
                  <kpi.icon className="h-5 w-5 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="workforce">Workforce</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="recruitment">Recruitment</TabsTrigger>
          <TabsTrigger value="engagement">Engagement</TabsTrigger>
        </TabsList>

        {/* Workforce Tab */}
        <TabsContent value="workforce" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Headcount by Department</CardTitle></CardHeader>
              <CardContent>
                {headcountByDept.length === 0 ? (
                  <DataEmptyState title="No employee data" description="Add employees to see department breakdown." compact />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={headcountByDept}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <RTooltip />
                      <Bar dataKey="value" name="Employees" radius={[4, 4, 0, 0]}>
                        {headcountByDept.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Employment Type</CardTitle></CardHeader>
              <CardContent>
                {employmentTypeData.length === 0 ? (
                  <DataEmptyState title="No data" description="Employment type distribution will appear here." compact />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={employmentTypeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                        {employmentTypeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Hiring Trend</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={hiringTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Area type="monotone" dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Employee Status</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label>
                      {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Location Distribution</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={locationData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={100} />
                  <RTooltip />
                  <Bar dataKey="value" name="Employees" fill="#06b6d4" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Leave Tab */}
        <TabsContent value="leave" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Total Leave Days</p>
                <p className="text-2xl font-bold mt-1">{totalLeaveDays}</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Avg/Employee</p>
                <p className="text-2xl font-bold mt-1">{avgLeavePerEmp} days</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Pending Requests</p>
                <p className="text-2xl font-bold mt-1">{pendingLeaves}</p>
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Leave by Type</CardTitle></CardHeader>
              <CardContent>
                {leaveByType.length === 0 ? (
                  <DataEmptyState title="No leave data" description="Leave utilization breakdown will appear here." compact />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={leaveByType}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <RTooltip />
                      <Bar dataKey="value" name="Days" radius={[4, 4, 0, 0]}>
                        {leaveByType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Leave Status Distribution</CardTitle></CardHeader>
              <CardContent>
                {leaveStatusData.length === 0 ? (
                  <DataEmptyState title="No data" description="Leave status will appear here." compact />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={leaveStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                        {leaveStatusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Leave by Department</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={leaveByDept}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="value" name="Days" fill="#ec4899" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Monthly Leave Trend</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={leaveMonthly}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Area type="monotone" dataKey="value" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Expenses Tab */}
        <TabsContent value="expenses" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Total Expenses</p>
                <p className="text-2xl font-bold mt-1">₹{totalExpenses.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Avg/Employee</p>
                <p className="text-2xl font-bold mt-1">₹{avgExpensePerEmp.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Pending Claims</p>
                <p className="text-2xl font-bold mt-1">{pendingExpenses}</p>
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Expense by Category</CardTitle></CardHeader>
              <CardContent>
                {expenseByCategory.length === 0 ? (
                  <DataEmptyState title="No expense data" description="Submit expenses to see category breakdown." compact />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={expenseByCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                        {expenseByCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Expense by Department</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={expenseByDept}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="value" name="Amount (₹)" fill="#10b981" radius={[4, 4, 0, 0]}>
                      {expenseByDept.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Monthly Expense Trend</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={expenseMonthly}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <RTooltip />
                  <Area type="monotone" dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Recruitment Tab */}
        <TabsContent value="recruitment" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Open Positions</p>
                <p className="text-2xl font-bold mt-1">{openPositions}</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Total Applicants</p>
                <p className="text-2xl font-bold mt-1">{totalApplicants}</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Active Jobs</p>
                <p className="text-2xl font-bold mt-1">{jobs.length}</p>
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Recruitment Funnel</CardTitle></CardHeader>
              <CardContent>
                {recruitFunnel.length === 0 || recruitFunnel.every(r => r.value === 0) ? (
                  <DataEmptyState title="No recruitment data" description="No applications have moved through the hiring pipeline yet, so there is nothing to draw a funnel from." compact />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={recruitFunnel} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={80} />
                      <RTooltip />
                      <Bar dataKey="value" name="Candidates" radius={[0, 6, 6, 0]}>
                        {recruitFunnel.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Openings by Department</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={recruitByDept} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                      {recruitByDept.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Engagement Tab */}
        <TabsContent value="engagement" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { label: "eNPS Score", value: eNPS ?? "—", icon: Heart, gradient: "from-pink-500 to-rose-600" },
              { label: "Headcount", value: employees.length, icon: Star, gradient: "from-amber-500 to-orange-500" },
              { label: "Open roles", value: jobStore.items.filter(j => j.status === "open").length, icon: Zap, gradient: "from-violet-500 to-purple-600" },
              { label: "Retention", value: `${100 - attritionRate}%`, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
            ].map((kpi) => (
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

          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Attendance Rate Trend</CardTitle></CardHeader>
            <CardContent>
              {attendanceRate.length === 0 ? (
                <DataEmptyState title="No attendance data" description="Clock-in data will populate this chart." compact />
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={attendanceRate}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis domain={[0, 100]} />
                    <RTooltip />
                    <Line type="monotone" dataKey="rate" name="Attendance %" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: "#8b5cf6" }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Department Retention</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {headcountByDept.slice(0, 6).map((dept) => {
                    // Share of the department still active. This replaces a
                    // "health score" that was Math.random() rendered as a
                    // measured percentage.
                    const inDept = employees.filter(e => (e.department || "Other") === dept.name);
                    const stable = inDept.filter(
                      e => e.status !== "notice_period" && e.status !== "terminated"
                    ).length;
                    const score = inDept.length > 0
                      ? Math.round((stable / inDept.length) * 100)
                      : 0;
                    return (
                      <div key={dept.name} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">{dept.name}</span>
                          <span className={cn("text-xs", score >= 80 ? "text-emerald-600" : score >= 60 ? "text-amber-600" : "text-red-600")}>
                            {score}% retained ({inDept.length})
                          </span>
                        </div>
                        <Progress value={score} className={cn("h-2", score < 60 ? "[&>div]:bg-red-500" : score < 80 ? "[&>div]:bg-amber-500" : "")} />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Key Metrics Summary</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { metric: "Workforce", value: `${totalEmployees} employees`, badge: "active" },
                    { metric: "Avg Leave/Employee", value: `${avgLeavePerEmp} days`, badge: Number(avgLeavePerEmp) > 10 ? "high" : "normal" },
                    { metric: "Expense/Head", value: `₹${avgExpensePerEmp.toLocaleString()}`, badge: "info" },
                    { metric: "Open Positions", value: `${openPositions} roles`, badge: openPositions > 5 ? "high" : "normal" },
                    { metric: "Attrition", value: `${attritionRate}%`, badge: attritionRate > 10 ? "high" : "normal" },
                  ].map((item) => (
                    <div key={item.metric} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                      <span className="text-sm font-medium">{item.metric}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{item.value}</span>
                        <Badge variant="outline" className={cn("text-xs",
                          item.badge === "active" ? "text-emerald-600 border-emerald-200" :
                          item.badge === "high" ? "text-amber-600 border-amber-200" :
                          "text-blue-600 border-blue-200"
                        )}>
                          {item.badge === "high" ? "↑" : "●"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Department Performance Radar */}
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Department Performance Radar</CardTitle></CardHeader>
            <CardContent>
              {deptRadar.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <RadarChart data={deptRadar}>
                    <PolarGrid stroke="hsl(var(--border))" />
                    <PolarAngleAxis dataKey="dept" tick={{ fontSize: 10 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                    <Radar name="Headcount" dataKey="headcount" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} />
                    <Radar name="Leave Usage" dataKey="leaveUtil" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} />
                    <Radar name="Expenses" dataKey="expenses" stroke="#10b981" fill="#10b981" fillOpacity={0.1} />
                    <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                    <RTooltip />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <DataEmptyState title="No data" description="Department performance radar will appear with data." compact />
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Combined Trend — Composed */}
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Monthly Activity Composed</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={monthlyComposed}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                    <RTooltip />
                    <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                    <Bar yAxisId="left" dataKey="hired" name="Hired" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="left" dataKey="leaves" name="Leave Days" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="expenses" name="Expenses (₹)" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Tenure Scatter */}
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Employee Tenure Scatter</CardTitle></CardHeader>
              <CardContent>
                {tenureScatter.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" dataKey="tenure" name="Months" tick={{ fontSize: 10 }} label={{ value: "Tenure (months)", position: "insideBottom", offset: -5, style: { fontSize: 10 } }} />
                      <YAxis type="category" dataKey="department" name="Dept" tick={{ fontSize: 9 }} width={80} />
                      <ZAxis range={[30, 150]} />
                      <RTooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
                        if (!active || !payload?.[0]) return null;
                        const d = payload[0].payload;
                        return <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2 shadow-xl text-xs"><p className="font-semibold">{d.name}</p><p>{d.department} · {d.tenure} months</p></div>;
                      }} />
                      <Scatter name="Employees" data={tenureScatter} fill="#ec4899" />
                    </ScatterChart>
                  </ResponsiveContainer>
                ) : (
                  <DataEmptyState title="No data" description="Add employees with joining dates to see tenure distribution." compact />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
