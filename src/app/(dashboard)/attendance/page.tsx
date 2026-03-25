"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
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
  Clock, Plus, Search, Users, CheckCircle2, XCircle, AlertTriangle,
  TrendingUp, Calendar, MapPin, Timer, LogIn, LogOut, Eye,
  ArrowUpRight, ArrowDownRight, Building2, Laptop, Palmtree,
  ThumbsUp, ThumbsDown, Filter, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
  Tooltip as RTooltip,
} from "recharts";
import { useAttendanceStore, startSync, type AttendanceDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE — Clock in/out, daily logs, weekly/monthly trends,
// regularization requests, and attendance analytics
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const STATUS_CONF: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  present: { label: "Present", className: "status-active", icon: CheckCircle2 },
  absent: { label: "Absent", className: "status-rejected", icon: XCircle },
  late: { label: "Late", className: "status-pending", icon: AlertTriangle },
  wfh: { label: "WFH", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: Laptop },
  leave: { label: "On Leave", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", icon: Palmtree },
  half_day: { label: "Half Day", className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400", icon: Timer },
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function AttendancePage() {
  const store = useAttendanceStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("today");
  const [clockedIn, setClockedIn] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [regularizeOpen, setRegularizeOpen] = useState(false);
  const [regForm, setRegForm] = useState({
    employeeName: "", date: "", clockIn: "", clockOut: "", reason: "",
  });

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.attendance, store); }, [initialized, store]);

  // Live clock
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const today = new Date().toISOString().split("T")[0];

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a => a.employeeName?.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") result = result.filter(a => a.status === statusFilter);
    return result;
  }, [items, search, statusFilter]);

  const todayRecords = useMemo(() => items.filter(a => a.date === today), [items, today]);

  // KPIs
  const presentToday = todayRecords.filter(a => a.status === "present" || a.status === "late").length;
  const absentToday = todayRecords.filter(a => a.status === "absent").length;
  const wfhToday = todayRecords.filter(a => a.status === "wfh").length;
  const lateToday = todayRecords.filter(a => a.status === "late").length;
  const avgHours = todayRecords.length > 0
    ? (todayRecords.reduce((s, a) => s + (a.hours || 0), 0) / todayRecords.length).toFixed(1)
    : "0.0";

  // Weekly chart data
  const weeklyData = useMemo(() => {
    const now = new Date();
    return WEEKDAYS.map((day, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay() + i + 1);
      const dateStr = d.toISOString().split("T")[0];
      const dayRecords = items.filter(a => a.date === dateStr);
      return {
        name: day,
        present: dayRecords.filter(a => a.status === "present" || a.status === "late").length,
        absent: dayRecords.filter(a => a.status === "absent").length,
        wfh: dayRecords.filter(a => a.status === "wfh").length,
      };
    });
  }, [items]);

  // Status distribution
  const statusDist = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(a => {
      counts[a.status || "present"] = (counts[a.status || "present"] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({
      name: STATUS_CONF[name]?.label || name,
      value,
    }));
  }, [items]);

  // Monthly trend
  const monthlyTrend = useMemo(() => {
    const byDate: Record<string, number> = {};
    items.forEach(a => {
      if (!a.date) return;
      byDate[a.date] = (byDate[a.date] || 0) + (a.hours || 0);
    });
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([name, value]) => ({ name: name.slice(5), value: Math.round(value) }));
  }, [items]);

  const handleClockIn = async () => {
    try {
      const now = new Date();
      const isLate = now.getHours() >= 10;
      await genericService(COLLECTIONS.attendance).create({
        employeeName: "Current User",
        employeeId: "current",
        date: today,
        clockIn: now.toLocaleTimeString("en-US", { hour12: false }),
        clockOut: "",
        status: isLate ? "late" : "present",
        hours: 0,
        overtime: 0,
        location: "Office",
      });
      setClockedIn(true);
      toast.success(isLate ? "Clocked in (late)" : "Clocked in successfully!");
    } catch {
      toast.error("Failed to clock in");
    }
  };

  const handleClockOut = async () => {
    const myRecord = todayRecords.find(a => a.employeeId === "current");
    if (!myRecord) { toast.error("No clock-in record found"); return; }
    try {
      const now = new Date();
      const clockInTime = myRecord.clockIn;
      const [h, m] = clockInTime.split(":").map(Number);
      const hours = Math.max(0, now.getHours() - h + (now.getMinutes() - m) / 60);
      await genericService(COLLECTIONS.attendance).update(myRecord.id, {
        clockOut: now.toLocaleTimeString("en-US", { hour12: false }),
        hours: Math.round(hours * 10) / 10,
        overtime: Math.max(0, hours - 8),
      });
      setClockedIn(false);
      toast.success(`Clocked out! Worked ${hours.toFixed(1)} hours`);
    } catch {
      toast.error("Failed to clock out");
    }
  };

  const handleRegularize = async () => {
    if (!regForm.employeeName || !regForm.date || !regForm.clockIn) {
      toast.error("Please fill required fields"); return;
    }
    try {
      await genericService(COLLECTIONS.attendance).create({
        ...regForm,
        hours: 8,
        overtime: 0,
        status: "present",
        employeeId: "regularized",
      });
      toast.success("Regularization request submitted!");
      setRegularizeOpen(false);
      setRegForm({ employeeName: "", date: "", clockIn: "", clockOut: "", reason: "" });
    } catch {
      toast.error("Failed to submit regularization");
    }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && items.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.attendance} onAction={handleClockIn} />;
  }

  const kpis = [
    { label: "Present", value: presentToday, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "Absent", value: absentToday, icon: XCircle, gradient: "from-red-500 to-rose-600" },
    { label: "WFH", value: wfhToday, icon: Laptop, gradient: "from-blue-500 to-cyan-500" },
    { label: "Late", value: lateToday, icon: AlertTriangle, gradient: "from-amber-500 to-orange-500" },
    { label: "Avg Hours", value: avgHours, icon: Timer, gradient: "from-violet-500 to-purple-600" },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Attendance</h1>
          <p className="text-muted-foreground mt-1">Track time, manage attendance, and view reports</p>
        </div>
        <div className="flex items-center gap-3">
          <Card className="border-0 shadow-sm px-4 py-2">
            <div className="text-center">
              <p className="text-2xl font-bold font-mono">
                {currentTime.toLocaleTimeString("en-US", { hour12: true })}
              </p>
              <p className="text-xs text-muted-foreground">{currentTime.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</p>
            </div>
          </Card>
          <Button
            className={cn(
              "gap-2 text-white border-0 shadow-md",
              clockedIn
                ? "bg-gradient-to-r from-red-500 to-rose-600"
                : "bg-gradient-to-r from-emerald-500 to-green-600"
            )}
            onClick={clockedIn ? handleClockOut : handleClockIn}
          >
            {clockedIn ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
            {clockedIn ? "Clock Out" : "Clock In"}
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
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

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {Object.entries(STATUS_CONF).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="regularize">Regularize</TabsTrigger>
        </TabsList>

        {/* Today Tab */}
        <TabsContent value="today" className="space-y-3 mt-4">
          <h3 className="font-semibold text-sm text-muted-foreground">Today&apos;s Attendance Log</h3>
          {todayRecords.length === 0 ? (
            <DataEmptyState title="No records today" description="Clock-in records will appear here as employees check in." compact />
          ) : (
            todayRecords.map((a) => {
              const st = STATUS_CONF[a.status] || STATUS_CONF.present;
              return (
                <Card key={a.id} className="border-0 shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarFallback className="text-xs bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                            {a.employeeName?.split(" ").map(n => n[0]).join("").slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{a.employeeName}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                            <span className="flex items-center gap-1"><LogIn className="h-3 w-3" />{a.clockIn || "—"}</span>
                            <span className="flex items-center gap-1"><LogOut className="h-3 w-3" />{a.clockOut || "—"}</span>
                            <span className="flex items-center gap-1"><Timer className="h-3 w-3" />{a.hours || 0}h</span>
                            {a.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{a.location}</span>}
                          </div>
                        </div>
                      </div>
                      <Badge className={st.className}>{st.label}</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
          {/* Also render all records for today not filtered by date */}
          {todayRecords.length === 0 && filtered.length > 0 && (
            <>
              <Separator />
              <h3 className="font-semibold text-sm text-muted-foreground">Recent Records</h3>
              {filtered.slice(0, 10).map((a) => {
                const st = STATUS_CONF[a.status] || STATUS_CONF.present;
                return (
                  <Card key={a.id} className="border-0 shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="text-xs bg-gradient-to-br from-blue-500 to-cyan-500 text-white">
                              {a.employeeName?.split(" ").map(n => n[0]).join("").slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">{a.employeeName}</p>
                            <p className="text-xs text-muted-foreground">{a.date} · {a.clockIn} - {a.clockOut || "—"} · {a.hours || 0}h</p>
                          </div>
                        </div>
                        <Badge className={st.className}>{st.label}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}
        </TabsContent>

        {/* Weekly Tab */}
        <TabsContent value="weekly" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Weekly Attendance Summary</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <RTooltip />
                  <Legend />
                  <Bar dataKey="present" name="Present" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="absent" name="Absent" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="wfh" name="WFH" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Status Distribution</CardTitle></CardHeader>
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
        </TabsContent>

        {/* Monthly Tab */}
        <TabsContent value="monthly" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Monthly Hours Trend</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
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

        {/* Regularize Tab */}
        <TabsContent value="regularize" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Regularization Requests</h3>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setRegularizeOpen(true)}>
              <Plus className="h-4 w-4" /> New Request
            </Button>
          </div>
          {items.filter(a => a.employeeId === "regularized").length === 0 ? (
            <DataEmptyState title="No regularization requests" description="Submit a request to correct missed clock-in/out entries." compact onAction={() => setRegularizeOpen(true)} />
          ) : (
            items.filter(a => a.employeeId === "regularized").map((a) => (
              <Card key={a.id} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{a.employeeName}</p>
                      <p className="text-sm text-muted-foreground">{a.date} · {a.clockIn} - {a.clockOut || "—"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className="status-pending">Pending</Badge>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600"><ThumbsUp className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600"><ThumbsDown className="h-4 w-4" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Regularize Dialog */}
      <Dialog open={regularizeOpen} onOpenChange={setRegularizeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Regularization Request</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Employee Name *</Label>
              <Input value={regForm.employeeName} onChange={(e) => setRegForm(f => ({ ...f, employeeName: e.target.value }))} placeholder="Your name" />
            </div>
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input type="date" value={regForm.date} onChange={(e) => setRegForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Clock In *</Label>
                <Input type="time" value={regForm.clockIn} onChange={(e) => setRegForm(f => ({ ...f, clockIn: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Clock Out</Label>
                <Input type="time" value={regForm.clockOut} onChange={(e) => setRegForm(f => ({ ...f, clockOut: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea value={regForm.reason} onChange={(e) => setRegForm(f => ({ ...f, reason: e.target.value }))} placeholder="Why do you need regularization?" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegularizeOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleRegularize}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
