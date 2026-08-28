"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { dateKeyInZone } from "@/lib/date-keys";
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
  CalendarDays, Plus, Search, Users, CheckCircle2, XCircle, Clock,
  AlertTriangle, TrendingUp, Eye, Calendar, ChevronRight, Filter,
  Palmtree, Stethoscope, Baby, Heart, GraduationCap, Briefcase,
  ArrowRight, ThumbsUp, ThumbsDown, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRBAC } from "@/hooks/use-rbac";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
  Tooltip as RTooltip,
} from "recharts";
import { useLeaveStore, startSync, type LeaveDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// LEAVE MANAGEMENT — Leave balance, requests, calendar,
// approve/reject workflow, and leave analytics
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const LEAVE_TYPES = [
  { value: "casual", label: "Casual Leave", icon: Palmtree, total: 12, color: "#8b5cf6" },
  { value: "sick", label: "Sick Leave", icon: Stethoscope, total: 10, color: "#ef4444" },
  { value: "earned", label: "Earned Leave", icon: Briefcase, total: 15, color: "#10b981" },
  { value: "maternity", label: "Maternity Leave", icon: Baby, total: 180, color: "#ec4899" },
  { value: "paternity", label: "Paternity Leave", icon: Heart, total: 15, color: "#06b6d4" },
  { value: "study", label: "Study Leave", icon: GraduationCap, total: 5, color: "#f59e0b" },
];
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "status-pending" },
  approved: { label: "Approved", className: "status-active" },
  rejected: { label: "Rejected", className: "status-rejected" },
  cancelled: { label: "Cancelled", className: "status-inactive" },
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function LeavePage() {
  const rbac = useRBAC();
  const store = useLeaveStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("requests");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedLeave, setSelectedLeave] = useState<LeaveDoc | null>(null);
  const [form, setForm] = useState({
    employeeName: "", department: "", leaveType: "",
    fromDate: "", toDate: "", reason: "",
  });

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.leaves, store); }, [initialized, store]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(l =>
        l.employeeName?.toLowerCase().includes(q) ||
        l.department?.toLowerCase().includes(q)
      );
    }
    if (typeFilter !== "all") result = result.filter(l => l.leaveType === typeFilter);
    if (statusFilter !== "all") result = result.filter(l => l.status === statusFilter);
    return result;
  }, [items, search, typeFilter, statusFilter]);

  // KPIs
  const pending = items.filter(l => l.status === "pending").length;
  const approved = items.filter(l => l.status === "approved").length;
  const rejected = items.filter(l => l.status === "rejected").length;
  const totalDays = items.filter(l => l.status === "approved").reduce((s, l) => s + (l.days || 0), 0);

  // Leave usage by type
  const leaveByType = useMemo(() => {
    const counts: Record<string, number> = {};
    items.filter(l => l.status === "approved").forEach(l => {
      counts[l.leaveType || "Other"] = (counts[l.leaveType || "Other"] || 0) + (l.days || 0);
    });
    return LEAVE_TYPES.map(lt => ({
      name: lt.label,
      used: counts[lt.value] || 0,
      total: lt.total,
    }));
  }, [items]);

  // Monthly trend
  const monthlyTrend = useMemo(() => {
    const months: Record<string, number> = {};
    items.forEach(l => {
      if (!l.fromDate) return;
      const d = new Date(l.fromDate);
      const key = d.toLocaleString("default", { month: "short" });
      months[key] = (months[key] || 0) + (l.days || 0);
    });
    return Object.entries(months).map(([name, value]) => ({ name, value }));
  }, [items]);

  // Leave balance computation
  const balances = useMemo(() => {
    const used: Record<string, number> = {};
    items.filter(l => l.status === "approved").forEach(l => {
      used[l.leaveType || "casual"] = (used[l.leaveType || "casual"] || 0) + (l.days || 0);
    });
    return LEAVE_TYPES.map(lt => ({
      ...lt,
      used: used[lt.value] || 0,
      remaining: lt.total - (used[lt.value] || 0),
      percent: Math.round(((used[lt.value] || 0) / lt.total) * 100),
    }));
  }, [items]);

  const calcDays = (from: string, to: string) => {
    if (!from || !to) return 0;
    const d1 = new Date(from);
    const d2 = new Date(to);
    return Math.max(1, Math.ceil((d2.getTime() - d1.getTime()) / 86400000) + 1);
  };

  const resetForm = () => setForm({ employeeName: "", department: "", leaveType: "", fromDate: "", toDate: "", reason: "" });

  const handleCreate = async () => {
    if (!form.employeeName || !form.leaveType || !form.fromDate || !form.toDate) {
      toast.error("Please fill required fields"); return;
    }
    try {
      const days = calcDays(form.fromDate, form.toDate);
      await genericService(COLLECTIONS.leaves).create({
        ...form,
        days,
        status: "pending",
        appliedOn: dateKeyInZone(new Date()),
      });
      toast.success("Leave request submitted successfully!");
      setCreateOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to submit leave request");
    }
  };

  const handleAction = async (id: string, action: "approved" | "rejected") => {
    try {
      await genericService(COLLECTIONS.leaves).update(id, { status: action, approvedBy: "Manager" });
      toast.success(`Leave request ${action}`);
      if (selectedLeave?.id === id) setSelectedLeave(null);
    } catch {
      toast.error(`Failed to ${action.slice(0, -1)} leave`);
    }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && items.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.leave} onAction={() => setCreateOpen(true)} />;
  }

  const kpis = [
    { label: "Pending", value: pending, icon: Clock, gradient: "from-amber-500 to-orange-500" },
    { label: "Approved", value: approved, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "Rejected", value: rejected, icon: XCircle, gradient: "from-red-500 to-rose-600" },
    { label: "Total Days Taken", value: totalDays, icon: CalendarDays, gradient: "from-violet-500 to-purple-600" },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Leave Management</h1>
          <p className="text-muted-foreground mt-1">Track leave balances, requests, and approvals</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Apply Leave
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
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

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name, department..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Leave Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {LEAVE_TYPES.map(lt => <SelectItem key={lt.value} value={lt.value}>{lt.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="balance">My Balance</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="policy">Policy</TabsTrigger>
        </TabsList>

        {/* Requests Tab */}
        <TabsContent value="requests" className="space-y-3 mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.leave} compact onAction={() => setCreateOpen(true)} />
          ) : (
            filtered.map((leave) => {
              const st = STATUS_CONF[leave.status] || STATUS_CONF.pending;
              const ltConf = LEAVE_TYPES.find(t => t.value === leave.leaveType);
              return (
                <Card key={leave.id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedLeave(leave)}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <Avatar className="h-10 w-10">
                          <AvatarFallback className="text-xs bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                            {leave.employeeName?.split(" ").map(n => n[0]).join("").slice(0, 2) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{leave.employeeName}</h3>
                            <Badge variant="outline" className="text-xs">{ltConf?.label || leave.leaveType}</Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{leave.fromDate} → {leave.toDate}</span>
                            <span>{leave.days || 0} day{(leave.days || 0) > 1 ? "s" : ""}</span>
                            <span>{leave.department}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={st.className}>{st.label}</Badge>
                        {rbac.can("leave.approve") && leave.status === "pending" && (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" onClick={(e) => { e.stopPropagation(); handleAction(leave.id, "approved"); }}>
                              <ThumbsUp className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); handleAction(leave.id, "rejected"); }}>
                              <ThumbsDown className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                    {leave.reason && (
                      <p className="text-sm text-muted-foreground mt-2 ml-14">{leave.reason}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* Balance Tab */}
        <TabsContent value="balance" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {balances.map((b) => (
              <Card key={b.value} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${b.color}20` }}>
                      <b.icon className="h-5 w-5" style={{ color: b.color }} />
                    </div>
                    <div>
                      <p className="font-semibold">{b.label}</p>
                      <p className="text-xs text-muted-foreground">{b.remaining} remaining of {b.total}</p>
                    </div>
                  </div>
                  <div className="relative">
                    <Progress value={b.percent} className="h-3" />
                    <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                      <span>Used: {b.used}</span>
                      <span>{b.percent}%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Leave Usage by Type</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={leaveByType}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <RTooltip />
                  <Legend />
                  <Bar dataKey="used" name="Used" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="total" name="Total" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Calendar Tab */}
        <TabsContent value="calendar" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Who&apos;s on Leave</CardTitle></CardHeader>
            <CardContent>
              {items.filter(l => l.status === "approved").length === 0 ? (
                <DataEmptyState title="No upcoming leaves" description="Approved leaves will appear on the calendar." compact />
              ) : (
                <div className="space-y-2">
                  {items.filter(l => l.status === "approved").slice(0, 10).map((leave) => (
                    <div key={leave.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs bg-gradient-to-br from-emerald-500 to-green-600 text-white">
                            {leave.employeeName?.split(" ").map(n => n[0]).join("").slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{leave.employeeName}</p>
                          <p className="text-xs text-muted-foreground">{leave.department} · {leave.leaveType}</p>
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-medium">{leave.fromDate} → {leave.toDate}</p>
                        <p className="text-xs text-muted-foreground">{leave.days} day{(leave.days || 0) > 1 ? "s" : ""}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm mt-4">
            <CardHeader><CardTitle className="text-base">Monthly Leave Trend</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={monthlyTrend}>
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

        {/* Policy Tab */}
        <TabsContent value="policy" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Leave Policy Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {LEAVE_TYPES.map((lt) => (
                  <div key={lt.value} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                    <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${lt.color}20` }}>
                      <lt.icon className="h-4 w-4" style={{ color: lt.color }} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-sm">{lt.label}</p>
                        <Badge variant="outline">{lt.total} days/year</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {lt.value === "casual" && "For personal or unforeseen circumstances. Max 3 consecutive days."}
                        {lt.value === "sick" && "Medical leave with certificate required for 3+ days."}
                        {lt.value === "earned" && "Accrued at 1.25 days/month. Encashable upon separation."}
                        {lt.value === "maternity" && "26 weeks for first two children. As per Maternity Benefit Act."}
                        {lt.value === "paternity" && "15 days within 6 months of childbirth."}
                        {lt.value === "study" && "For exams and educational pursuits. Prior approval needed."}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Leave Detail Dialog */}
      <Dialog open={!!selectedLeave} onOpenChange={(v) => { if (!v) setSelectedLeave(null); }}>
        <DialogContent>
          {selectedLeave && (
            <>
              <DialogHeader><DialogTitle>Leave Request Details</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                      {selectedLeave.employeeName?.split(" ").map(n => n[0]).join("").slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold">{selectedLeave.employeeName}</p>
                    <p className="text-sm text-muted-foreground">{selectedLeave.department}</p>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Leave Type</p><p className="font-medium">{LEAVE_TYPES.find(t => t.value === selectedLeave.leaveType)?.label || selectedLeave.leaveType}</p></div>
                  <div><p className="text-muted-foreground">Status</p><Badge className={(STATUS_CONF[selectedLeave.status] || STATUS_CONF.pending).className}>{(STATUS_CONF[selectedLeave.status] || STATUS_CONF.pending).label}</Badge></div>
                  <div><p className="text-muted-foreground">From</p><p className="font-medium">{selectedLeave.fromDate}</p></div>
                  <div><p className="text-muted-foreground">To</p><p className="font-medium">{selectedLeave.toDate}</p></div>
                  <div><p className="text-muted-foreground">Duration</p><p className="font-medium">{selectedLeave.days} day{(selectedLeave.days || 0) > 1 ? "s" : ""}</p></div>
                  <div><p className="text-muted-foreground">Applied On</p><p className="font-medium">{selectedLeave.appliedOn}</p></div>
                </div>
                {selectedLeave.reason && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Reason</p>
                      <p className="text-sm">{selectedLeave.reason}</p>
                    </div>
                  </>
                )}
              </div>
              <DialogFooter className="gap-2">
                {selectedLeave.status === "pending" && (
                  <>
                    <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => handleAction(selectedLeave.id, "rejected")}>
                      <ThumbsDown className="h-4 w-4 mr-2" /> Reject
                    </Button>
                    <Button className="bg-gradient-to-r from-emerald-500 to-green-600 text-white border-0" onClick={() => handleAction(selectedLeave.id, "approved")}>
                      <ThumbsUp className="h-4 w-4 mr-2" /> Approve
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Apply Leave Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Apply for Leave</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Employee Name *</Label>
                <Input value={form.employeeName} onChange={(e) => setForm(f => ({ ...f, employeeName: e.target.value }))} placeholder="Your name" />
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={form.department} onChange={(e) => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Department" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Leave Type *</Label>
              <Select value={form.leaveType} onValueChange={(v) => setForm(f => ({ ...f, leaveType: v }))}>
                <SelectTrigger><SelectValue placeholder="Select leave type" /></SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map(lt => {
                    const b = balances.find(x => x.value === lt.value);
                    return (
                      <SelectItem key={lt.value} value={lt.value}>
                        {lt.label} ({b?.remaining || lt.total} remaining)
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>From Date *</Label>
                <Input type="date" value={form.fromDate} onChange={(e) => setForm(f => ({ ...f, fromDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>To Date *</Label>
                <Input type="date" value={form.toDate} onChange={(e) => setForm(f => ({ ...f, toDate: e.target.value }))} />
              </div>
            </div>
            {form.fromDate && form.toDate && (
              <div className="p-2 rounded-lg bg-muted/30 text-sm text-center">
                Duration: <span className="font-bold">{calcDays(form.fromDate, form.toDate)} day{calcDays(form.fromDate, form.toDate) > 1 ? "s" : ""}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea value={form.reason} onChange={(e) => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Reason for leave..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" /> Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
