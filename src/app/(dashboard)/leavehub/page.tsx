"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useToday } from "@/hooks/use-now";
import { addDaysToKey, dateKeyInZone } from "@/lib/date-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  CalendarDays, Plus, Search, CheckCircle2, Clock, XCircle,
  TrendingUp, Users, Calendar, Palmtree, Heart, Baby,
  Briefcase, AlertTriangle, ArrowUpRight, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip,
} from "recharts";
import { useLeaveStore, useEmployeeStore, startSync, type LeaveDoc } from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// LEAVE HUB — Leave balances, calendar, applications
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const LEAVE_TYPES = ["Casual Leave", "Sick Leave", "Earned Leave", "Maternity Leave", "Paternity Leave", "Comp Off", "Loss of Pay"];
const LEAVE_LIMITS: Record<string, number> = {
  "Casual Leave": 12, "Sick Leave": 10, "Earned Leave": 15,
  "Maternity Leave": 180, "Paternity Leave": 15, "Comp Off": 5, "Loss of Pay": 999,
};
const LEAVE_ICONS: Record<string, typeof Palmtree> = {
  "Casual Leave": Palmtree, "Sick Leave": Heart, "Maternity Leave": Baby,
  "Paternity Leave": Baby, "Earned Leave": Briefcase, "Comp Off": Clock, "Loss of Pay": AlertTriangle,
};
const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "status-pending" },
  approved: { label: "Approved", className: "status-active" },
  rejected: { label: "Rejected", className: "status-rejected" },
  cancelled: { label: "Cancelled", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
};

export default function LeaveHubPage() {
  const leaveStore = useLeaveStore();
  const empStore = useEmployeeStore();
  const { items: leaves, loading, initialized } = leaveStore;
  const { items: employees } = empStore;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("overview");
  const [applyOpen, setApplyOpen] = useState(false);
  const [form, setForm] = useState({
    employeeName: "", department: "", leaveType: "",
    fromDate: "", toDate: "", reason: "",
  });

  useEffect(() => {
    if (!leaveStore.initialized) startSync(COLLECTIONS.leaves, leaveStore);
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
  }, [leaveStore, empStore]);

  // KPIs
  const totalRequests = leaves.length;
  const pendingCount = leaves.filter(l => l.status === "pending").length;
  const approvedCount = leaves.filter(l => l.status === "approved").length;
  const avgDays = leaves.length > 0 ? Math.round(leaves.reduce((s, l) => s + (l.days || 0), 0) / leaves.length * 10) / 10 : 0;

  // Balance per leave type
  const balances = useMemo(() => {
    return LEAVE_TYPES.filter(t => t !== "Loss of Pay").map(type => {
      const used = leaves.filter(l => l.leaveType === type && (l.status === "approved" || l.status === "pending"))
        .reduce((s, l) => s + (l.days || 0), 0);
      const total = LEAVE_LIMITS[type] || 0;
      const remaining = Math.max(0, total - used);
      const percent = total > 0 ? Math.round((used / total) * 100) : 0;
      return { type, total, used, remaining, percent };
    });
  }, [leaves]);

  // Pending vs approved split
  const splitData = useMemo(() => {
    const pending = leaves.filter(l => l.status === "pending").length;
    const approved = leaves.filter(l => l.status === "approved").length;
    const rejected = leaves.filter(l => l.status === "rejected").length;
    return [
      { name: "Pending", value: pending },
      { name: "Approved", value: approved },
      { name: "Rejected", value: rejected },
    ].filter(d => d.value > 0);
  }, [leaves]);

  // Team calendar data — who is on leave today and this week
  const today = useToday();
  const teamCalendar = useMemo(() => {
    // `toISOString()` is UTC, so before 05:30 IST this asked about yesterday
    // and quietly dropped anyone whose leave started today.
    if (!today) return [];
    const weekEnd = addDaysToKey(today, 7);
    return leaves
      .filter(l => l.status === "approved" && l.fromDate <= weekEnd && l.toDate >= today)
      .map(l => ({
        ...l,
        initials: l.employeeName?.split(" ").map(n => n[0]).join("").slice(0, 2) || "??",
      }));
  }, [leaves, today]);

  // Leave type distribution for chart
  const typeDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    leaves.forEach(l => { counts[l.leaveType || "Other"] = (counts[l.leaveType || "Other"] || 0) + (l.days || 0); });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [leaves]);

  const filtered = useMemo(() => {
    if (!search) return leaves;
    const q = search.toLowerCase();
    return leaves.filter(l =>
      l.employeeName?.toLowerCase().includes(q) ||
      l.leaveType?.toLowerCase().includes(q) ||
      l.department?.toLowerCase().includes(q)
    );
  }, [leaves, search]);

  const handleApply = async () => {
    if (!form.employeeName || !form.leaveType || !form.fromDate || !form.toDate) {
      toast.error("Please fill required fields"); return;
    }
    const from = new Date(form.fromDate);
    const to = new Date(form.toDate);
    const days = Math.ceil((to.getTime() - from.getTime()) / 86400000) + 1;
    try {
      const { genericService } = await import("@/lib/collection-service");
      await genericService(COLLECTIONS.leaves).create({
        ...form,
        days,
        status: "pending",
        appliedOn: dateKeyInZone(new Date()),
      });
      toast.success("Leave application submitted!");
      setApplyOpen(false);
      setForm({ employeeName: "", department: "", leaveType: "", fromDate: "", toDate: "", reason: "" });
    } catch { toast.error("Failed to apply leave"); }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && leaves.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.leave} onAction={() => setApplyOpen(true)} />;
  }

  const kpis = [
    { label: "Total Requests", value: totalRequests, icon: CalendarDays, gradient: "from-violet-500 to-purple-600" },
    { label: "Pending", value: pendingCount, icon: Clock, gradient: "from-amber-500 to-orange-500" },
    { label: "Approved", value: approvedCount, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "Avg Days", value: avgDays, icon: TrendingUp, gradient: "from-blue-500 to-cyan-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Leave Hub</h1>
          <p className="text-muted-foreground mt-1">Manage leave balances, requests &amp; team calendar</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setApplyOpen(true)}>
          <Plus className="h-4 w-4" /> Apply Leave
        </Button>
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

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search leaves..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="balance">Balance</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Status Split */}
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Request Status Split</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={splitData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                      {splitData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            {/* Type Distribution */}
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Leave Type Distribution (Days)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={typeDistribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="value" name="Days" fill="#8b5cf6" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          {/* Recent Requests */}
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Recent Requests</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {filtered.slice(0, 8).map(l => {
                const st = STATUS_MAP[l.status] || STATUS_MAP.pending;
                return (
                  <div key={l.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-xs">
                          {l.employeeName?.split(" ").map(n => n[0]).join("").slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-sm">{l.employeeName}</p>
                        <p className="text-xs text-muted-foreground">{l.leaveType} &middot; {l.days} day{l.days !== 1 ? "s" : ""}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{l.fromDate} — {l.toDate}</span>
                      <Badge className={st.className}>{st.label}</Badge>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Balance */}
        <TabsContent value="balance" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {balances.map(b => {
              const Icon = LEAVE_ICONS[b.type] || CalendarDays;
              return (
                <Card key={b.type} className="border-0 shadow-sm">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                        <Icon className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{b.type}</p>
                        <p className="text-xs text-muted-foreground">{b.used} used of {b.total}</p>
                      </div>
                    </div>
                    {/* Circular-style progress */}
                    <div className="flex items-center gap-4">
                      <div className="relative h-16 w-16">
                        <svg className="h-16 w-16 -rotate-90" viewBox="0 0 36 36">
                          <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="3" />
                          <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none" stroke="url(#grad)" strokeWidth="3"
                            strokeDasharray={`${b.percent}, 100`} strokeLinecap="round" />
                          <defs><linearGradient id="grad"><stop offset="0%" stopColor="#8b5cf6" /><stop offset="100%" stopColor="#a855f7" /></linearGradient></defs>
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">{b.percent}%</span>
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Remaining</span>
                          <span className="font-semibold text-emerald-600">{b.remaining}</span>
                        </div>
                        <Progress value={b.percent} className="h-1.5" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Calendar */}
        <TabsContent value="calendar" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" /> Team On Leave This Week
              </CardTitle>
            </CardHeader>
            <CardContent>
              {teamCalendar.length === 0 ? (
                <DataEmptyState icon={CalendarDays} title="No one on leave" description="No approved leave for this week." compact />
              ) : (
                <div className="space-y-3">
                  {teamCalendar.map(l => (
                    <div key={l.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-green-600 text-white text-xs">
                            {l.initials}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-sm">{l.employeeName}</p>
                          <p className="text-xs text-muted-foreground">{l.department} &middot; {l.leaveType}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{l.fromDate} — {l.toDate}</p>
                        <p className="text-xs text-muted-foreground">{l.days} day{l.days !== 1 ? "s" : ""}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Apply Leave Dialog */}
      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Apply Leave</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Employee Name *</Label>
                <Input value={form.employeeName} onChange={e => setForm(f => ({ ...f, employeeName: e.target.value }))} placeholder="Your name" />
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Department" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Leave Type *</Label>
              <Select value={form.leaveType} onValueChange={v => setForm(f => ({ ...f, leaveType: v }))}>
                <SelectTrigger><SelectValue placeholder="Select leave type" /></SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>From Date *</Label>
                <Input type="date" value={form.fromDate} onChange={e => setForm(f => ({ ...f, fromDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>To Date *</Label>
                <Input type="date" value={form.toDate} onChange={e => setForm(f => ({ ...f, toDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Reason for leave..." rows={3} />
            </div>
            {form.leaveType && (
              <div className="p-2 rounded-lg bg-muted/30 text-xs text-muted-foreground">
                Balance for {form.leaveType}: {LEAVE_LIMITS[form.leaveType] || 0} days/year
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleApply}>
              <Plus className="h-4 w-4 mr-2" /> Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
