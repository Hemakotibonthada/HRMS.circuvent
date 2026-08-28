"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Clock, Plus, Search, Users, CheckCircle2, XCircle, AlertTriangle,
  TrendingUp, Calendar, MapPin, Timer, LogIn, LogOut, Eye,
  Building2, Laptop, Palmtree, RefreshCw, Smartphone, CreditCard,
  Radio, Sparkles, Check, CheckCheck, X, FileEdit, History,
  ShieldCheck, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRBAC } from "@/hooks/use-rbac";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
  Tooltip as RTooltip,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE — Web Clock In/Out, Smartcard & Biometric Tapping,
// Regularization Requests, Hardware Sync, & Live Analytics
// ═══════════════════════════════════════════════════════════════

const STATUS_CONF: Record<string, { label: string; badgeClass: string; icon: React.ElementType }> = {
  present: { label: "Present", badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300", icon: CheckCircle2 },
  absent: { label: "Absent", badgeClass: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-300", icon: XCircle },
  late: { label: "Late", badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300", icon: AlertTriangle },
  wfh: { label: "WFH", badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300", icon: Laptop },
  leave: { label: "On Leave", badgeClass: "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-300", icon: Palmtree },
  half_day: { label: "Half Day", badgeClass: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300 border-cyan-300", icon: Timer },
};

const METHOD_CONF: Record<string, { label: string; icon: React.ElementType }> = {
  web: { label: "Web Portal", icon: Laptop },
  biometric: { label: "Smartcard / NFC", icon: CreditCard },
  mobile: { label: "Mobile App", icon: Smartphone },
  geo_fence: { label: "Geo-fence", icon: MapPin },
  manual: { label: "Manual Admin", icon: FileEdit },
};

export interface AttendanceItem {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeCode?: string;
  workDate: string;
  clockInAt?: string;
  clockOutAt?: string;
  status: string;
  workedMinutes?: number;
  overtimeMinutes?: number;
  lateByMinutes?: number;
  clockInMethod?: string;
  isRegularized?: boolean;
}

export interface RegularisationItem {
  id: string;
  employeeId: string;
  employeeName?: string;
  date: string;
  reason: string;
  status: string;
  inTime?: string;
  outTime?: string;
  note?: string;
  createdAt: string;
}

function formatMinutes(minutes?: number): string {
  if (!minutes || minutes <= 0) return "0h 0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatTime(isoString?: string): string {
  if (!isoString) return "--:--";
  const date = new Date(isoString);
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export default function AttendancePage() {
  const { user } = useAuth();
  const { role, isManager, isAdmin } = useRBAC();

  // Live state
  const [records, setRecords] = useState<AttendanceItem[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [regularisations, setRegularisations] = useState<RegularisationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Time & Session
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeRecord, setActiveRecord] = useState<AttendanceItem | null>(null);

  // Filters & Tabs
  const [tab, setTab] = useState("daily");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Modals
  const [smartcardModalOpen, setSmartcardModalOpen] = useState(false);
  const [smartcardId, setSmartcardId] = useState("");
  const [cardTapped, setCardTapped] = useState(false);

  const [regularizeOpen, setRegularizeOpen] = useState(false);
  const [regForm, setRegForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    reason: "missed_punch",
    inTime: "09:30",
    outTime: "18:30",
    note: "",
  });

  // Ticker for Live Clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Today ISO
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Load Attendance Data
  const loadData = useCallback(async () => {
    try {
      setRefreshing(true);
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      const [listRes, summaryRes, regRes] = await Promise.all([
        fetch("/api/attendance?pageSize=100", { credentials: "include" }),
        fetch(`/api/attendance/summary?month=${month}&year=${year}`, { credentials: "include" }),
        fetch("/api/attendance/regularisation?queue=1", { credentials: "include" }),
      ]);

      if (listRes.ok) {
        const data = await listRes.json();
        const items: AttendanceItem[] = data.items || data.data || [];
        setRecords(items);

        // Find today's active session
        const todayMatch = items.find((r) => r.workDate === todayIso);
        setActiveRecord(todayMatch || null);
      }

      if (summaryRes.ok) {
        const sumData = await summaryRes.json();
        setSummary(sumData);
      }

      if (regRes.ok) {
        const regData = await regRes.json();
        setRegularisations(regData.items || regData.requests || []);
      }
    } catch (err) {
      console.error("Attendance data fetch failed:", err);
      toast.error("Could not refresh attendance records");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [todayIso]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Is currently clocked in
  const isClockedIn = useMemo(() => {
    return !!activeRecord?.clockInAt && !activeRecord?.clockOutAt;
  }, [activeRecord]);

  // Calculate elapsed time today
  const elapsedWorkingTime = useMemo(() => {
    if (!activeRecord?.clockInAt) return "0h 00m 00s";
    const start = new Date(activeRecord.clockInAt).getTime();
    const end = activeRecord.clockOutAt ? new Date(activeRecord.clockOutAt).getTime() : currentTime.getTime();
    const diffSeconds = Math.max(0, Math.floor((end - start) / 1000));

    const h = Math.floor(diffSeconds / 3600);
    const m = Math.floor((diffSeconds % 3600) / 60);
    const s = diffSeconds % 60;
    return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }, [activeRecord, currentTime]);

  // Handle Standard Web Clock In / Clock Out
  const handleClockToggle = async () => {
    setActionLoading(true);
    const action = isClockedIn ? "out" : "in";
    try {
      const res = await fetch("/api/attendance/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action,
          method: "web",
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || `Failed to clock ${action}`);
        return;
      }

      toast.success(
        action === "in"
          ? "Clocked In successfully! Working session started."
          : `Clocked Out! Total worked time: ${formatMinutes(body.workedMinutes)}.`
      );
      loadData();
    } catch {
      toast.error(`Failed to clock ${action}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Smartcard / NFC Biometric Punch
  const handleSmartcardPunch = async () => {
    if (!smartcardId.trim()) {
      toast.error("Please scan or enter Smartcard ID");
      return;
    }

    setActionLoading(true);
    setCardTapped(true);
    const action = isClockedIn ? "out" : "in";

    try {
      const res = await fetch("/api/attendance/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action,
          method: "biometric",
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Smartcard validation failed");
        setCardTapped(false);
        return;
      }

      toast.success(
        `Smartcard [${smartcardId.toUpperCase()}] Verified! Clocked ${action.toUpperCase()} via Biometric Terminal.`
      );
      setSmartcardModalOpen(false);
      setSmartcardId("");
      setCardTapped(false);
      loadData();
    } catch {
      toast.error("Smartcard reader connection error");
      setCardTapped(false);
    } finally {
      setActionLoading(false);
    }
  };

  // Trigger Hardware Device Sync (AttendanceDesk / Home.circuvent.com)
  const handleDeviceSync = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/attendance/device-sync", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Device sync failed");
        return;
      }
      toast.success(`Biometric Hardware Synced: ${data.recordsIngested || 0} smartcard punches imported.`);
      loadData();
    } catch {
      toast.error("Failed to connect to AttendanceDesk hardware service");
    } finally {
      setActionLoading(false);
    }
  };

  // Regularization Submit
  const handleRegularizeSubmit = async () => {
    if (!regForm.date || !regForm.reason) {
      toast.error("Please fill required fields");
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch("/api/attendance/regularisation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(regForm),
      });

      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || "Failed to submit regularization request");
        return;
      }

      toast.success("Regularization request submitted for manager review!");
      setRegularizeOpen(false);
      setRegForm({
        date: new Date().toISOString().slice(0, 10),
        reason: "missed_punch",
        inTime: "09:30",
        outTime: "18:30",
        note: "",
      });
      loadData();
    } catch {
      toast.error("Failed to submit regularization request");
    } finally {
      setActionLoading(false);
    }
  };

  // Decide Regularization (Approve / Reject)
  const handleDecideRegularisation = async (id: string, decision: "approved" | "rejected") => {
    try {
      const res = await fetch("/api/attendance/regularisation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, status: decision }),
      });

      if (!res.ok) {
        toast.error(`Could not ${decision} request`);
        return;
      }

      toast.success(`Regularization request ${decision}!`);
      loadData();
    } catch {
      toast.error("Failed to update regularization");
    }
  };

  // Filtered Records
  const filteredRecords = useMemo(() => {
    let list = records;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.employeeName?.toLowerCase().includes(q) ||
          r.employeeCode?.toLowerCase().includes(q) ||
          r.workDate.includes(q)
      );
    }
    if (statusFilter !== "all") {
      list = list.filter((r) => r.status === statusFilter);
    }
    return list;
  }, [records, search, statusFilter]);

  // Today KPIs
  const todayRecords = useMemo(() => records.filter((r) => r.workDate === todayIso), [records, todayIso]);
  const presentCount = todayRecords.filter((r) => r.status === "present" || r.status === "late").length;
  const lateCount = todayRecords.filter((r) => r.status === "late" || (r.lateByMinutes && r.lateByMinutes > 0)).length;
  const wfhCount = todayRecords.filter((r) => r.status === "wfh").length;

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header & Live Clock */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center shadow-md">
            <Clock className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent">
              Attendance &amp; Time Tracking
            </h1>
            <p className="text-sm text-muted-foreground">
              Live clock in/out, smartcard RFID reader, device sync &amp; regularisation management
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDeviceSync}
            disabled={actionLoading}
            className="gap-1.5"
          >
            <Radio className="h-4 w-4 text-emerald-500 animate-pulse" />
            Hardware Device Sync
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={refreshing}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* LIVE PUNCH & TERMINAL CONSOLE CARD                              */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Card className="border-0 shadow-lg bg-gradient-to-br from-violet-900 via-indigo-900 to-slate-900 text-white overflow-hidden relative">
        <div className="absolute top-0 right-0 p-6 opacity-10">
          <Clock className="w-64 h-64" />
        </div>

        <CardContent className="p-6 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            {/* Left: Live Time & Status */}
            <div className="lg:col-span-5 space-y-3">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "h-3 w-3 rounded-full animate-pulse",
                    isClockedIn ? "bg-emerald-400 shadow-[0_0_12px_#34d399]" : "bg-amber-400"
                  )}
                />
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  {isClockedIn ? "Session Active • Clocked In" : "Not Clocked In • Ready to Punch"}
                </span>
              </div>

              <div className="flex items-baseline gap-3">
                <h2 className="text-4xl sm:text-5xl font-black font-mono tracking-tight text-white">
                  {currentTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}
                </h2>
              </div>

              <p className="text-xs text-slate-300">
                {currentTime.toLocaleDateString("en-US", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>

              {isClockedIn && (
                <div className="p-3 rounded-xl bg-white/10 backdrop-blur-md border border-white/10 space-y-1">
                  <div className="flex justify-between text-xs text-slate-300">
                    <span>Clocked in at:</span>
                    <span className="font-mono font-bold text-emerald-300">{formatTime(activeRecord?.clockInAt)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-300">
                    <span>Active Duration:</span>
                    <span className="font-mono font-bold text-white">{elapsedWorkingTime}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Middle: Shift & Work Policy */}
            <div className="lg:col-span-3 space-y-2 border-y lg:border-y-0 lg:border-x border-white/10 py-4 lg:py-0 lg:px-6">
              <div className="text-xs text-slate-300 uppercase tracking-wider font-semibold">Standard Shift</div>
              <p className="text-lg font-bold text-white">09:30 AM – 06:30 PM</p>
              <p className="text-xs text-slate-300">General Day Shift (8.0h working + 1.0h break)</p>
              <div className="flex items-center gap-2 pt-1">
                <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs">
                  Grace Period: 15 min
                </Badge>
              </div>
            </div>

            {/* Right: Primary Action Buttons */}
            <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3 justify-center">
              <Button
                size="lg"
                onClick={handleClockToggle}
                disabled={actionLoading}
                className={cn(
                  "h-14 font-bold text-base shadow-xl gap-2 transition-all border-0",
                  isClockedIn
                    ? "bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 text-white"
                    : "bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white"
                )}
              >
                {isClockedIn ? <LogOut className="h-5 w-5" /> : <LogIn className="h-5 w-5" />}
                {isClockedIn ? "Clock Out (End Session)" : "Clock In (Web Punch)"}
              </Button>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSmartcardModalOpen(true)}
                  className="flex-1 bg-white/10 hover:bg-white/20 text-white border-white/20 text-xs gap-1.5 h-10"
                >
                  <CreditCard className="h-4 w-4 text-cyan-300" />
                  Smartcard / NFC Tap
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRegularizeOpen(true)}
                  className="flex-1 bg-white/10 hover:bg-white/20 text-white border-white/20 text-xs gap-1.5 h-10"
                >
                  <FileEdit className="h-4 w-4 text-purple-300" />
                  Regularize Day
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* KPI METRIC TILES                                                */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Present Today</p>
                <p className="text-2xl font-bold mt-1 text-emerald-600">{presentCount || summary?.presentDays || 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Active team members</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Late Arrivals</p>
                <p className="text-2xl font-bold mt-1 text-amber-600">{lateCount || summary?.lateDays || 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Arrived post grace period</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center text-amber-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Remote / WFH</p>
                <p className="text-2xl font-bold mt-1 text-blue-600">{wfhCount || summary?.wfhDays || 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Working from home</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-950/50 flex items-center justify-center text-blue-600">
                <Laptop className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Monthly Avg Hours</p>
                <p className="text-2xl font-bold mt-1 text-violet-600">
                  {summary?.totalWorkedMinutes ? (summary.totalWorkedMinutes / (summary.presentDays || 1) / 60).toFixed(1) : "8.2"}h
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Avg daily engagement</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-violet-100 dark:bg-violet-950/50 flex items-center justify-center text-violet-600">
                <Timer className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* TABS: ATTENDANCE LOGS & REGULARIZATION QUEUE                     */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-2">
          <TabsList className="bg-muted/60 p-1">
            <TabsTrigger value="daily" className="gap-2">
              <Calendar className="h-4 w-4" /> Attendance Register
            </TabsTrigger>
            <TabsTrigger value="regularisations" className="gap-2">
              <FileEdit className="h-4 w-4 text-purple-500" /> Regularization Requests ({regularisations.length})
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1: Attendance Register */}
        <TabsContent value="daily" className="space-y-4 mt-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by employee name, code, or date..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-card"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px] bg-card">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="present">Present</SelectItem>
                <SelectItem value="late">Late</SelectItem>
                <SelectItem value="half_day">Half Day</SelectItem>
                <SelectItem value="absent">Absent</SelectItem>
                <SelectItem value="wfh">WFH</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className="border shadow-sm bg-card/80 backdrop-blur-sm">
            <CardContent className="p-0">
              {filteredRecords.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                  <Clock className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
                  <p className="font-semibold text-base">No attendance records found</p>
                  <p className="text-xs mt-1">Clock in above to start your daily session.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Employee</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Clock In</TableHead>
                        <TableHead>Clock Out</TableHead>
                        <TableHead>Total Hours</TableHead>
                        <TableHead>Punch Method</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRecords.map((rec) => {
                        const statusObj = STATUS_CONF[rec.status] || STATUS_CONF.present;
                        const methodObj = METHOD_CONF[rec.clockInMethod || "web"] || METHOD_CONF.web;
                        const MethodIcon = methodObj.icon;

                        return (
                          <TableRow key={rec.id} className="hover:bg-muted/40">
                            <TableCell>
                              <div>
                                <p className="font-bold text-sm">{rec.employeeName || user?.displayName || user?.email || "Vema Naidu"}</p>
                                <p className="font-mono text-[11px] text-muted-foreground">{rec.employeeCode || "EMP-0002"}</p>
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs font-medium">
                              {rec.workDate}
                            </TableCell>
                            <TableCell>
                              <span className="font-mono text-xs font-semibold text-emerald-600">
                                {formatTime(rec.clockInAt)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="font-mono text-xs font-semibold text-slate-600 dark:text-slate-300">
                                {formatTime(rec.clockOutAt)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="font-mono text-xs font-bold">
                                {formatMinutes(rec.workedMinutes)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <MethodIcon className="h-3.5 w-3.5 text-violet-500" />
                                <span>{methodObj.label}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge className={cn("text-xs gap-1 border", statusObj.badgeClass)}>
                                <statusObj.icon className="h-3 w-3" />
                                {statusObj.label}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Regularizations Queue */}
        <TabsContent value="regularisations" className="space-y-4 mt-4">
          <Card className="border shadow-sm bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileEdit className="h-5 w-5 text-purple-500" /> Attendance Regularization Queue
              </CardTitle>
              <CardDescription>
                Review and approve correction requests submitted for missed punches, on-duty travel, or system glitches.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {regularisations.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-500 mb-2" />
                  <p className="font-semibold text-base">No pending regularization requests</p>
                  <p className="text-xs mt-1">All attendance adjustments are up to date.</p>
                </div>
              ) : (
                <div className="border rounded-xl overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Employee</TableHead>
                        <TableHead>Date to Correct</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Requested Timings</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {regularisations.map((req) => (
                        <TableRow key={req.id}>
                          <TableCell>
                            <p className="font-bold text-sm">{req.employeeName || "Employee"}</p>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{req.date}</TableCell>
                          <TableCell className="text-xs capitalize font-medium">
                            {req.reason.replace(/_/g, " ")}
                            {req.note && <p className="text-[11px] text-muted-foreground">{req.note}</p>}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {req.inTime || "09:30"} – {req.outTime || "18:30"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={cn(
                                "text-xs capitalize",
                                req.status === "approved"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : req.status === "rejected"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-amber-100 text-amber-800"
                              )}
                            >
                              {req.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {req.status === "pending" && (isAdmin || isManager) ? (
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-emerald-600 hover:bg-emerald-50 border-emerald-200 gap-1"
                                  onClick={() => handleDecideRegularisation(req.id, "approved")}
                                >
                                  <Check className="h-3.5 w-3.5" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-red-600 hover:bg-red-50 border-red-200 gap-1"
                                  onClick={() => handleDecideRegularisation(req.id, "rejected")}
                                >
                                  <X className="h-3.5 w-3.5" /> Reject
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">Processed</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: SMARTCARD & NFC BIOMETRIC TAP SIMULATOR                  */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={smartcardModalOpen} onOpenChange={setSmartcardModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-cyan-500" /> Smartcard / NFC Biometric Terminal
            </DialogTitle>
            <DialogDescription>
              Simulate or scan your physical employee smartcard badge at the office terminal.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Visual Smartcard Badge */}
            <div className="p-6 rounded-2xl bg-gradient-to-br from-cyan-600 via-blue-600 to-indigo-700 text-white shadow-xl relative overflow-hidden">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-bold tracking-widest uppercase text-cyan-200">CIRCUVENT TECHNOLOGIES</p>
                  <p className="text-lg font-bold mt-1">Smart Access Pass</p>
                </div>
                <Radio className="h-6 w-6 text-cyan-200 animate-pulse" />
              </div>

              <div className="mt-8 flex justify-between items-end">
                <div>
                  <p className="text-[10px] text-cyan-200 uppercase">Cardholder</p>
                  <p className="font-bold text-sm">{user?.displayName || user?.email || "Vema Naidu"}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-cyan-200 uppercase">Badge ID</p>
                  <p className="font-mono font-bold text-sm">{smartcardId || "CIR-CARD-001"}</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Smartcard RFID / NFC Badge ID</Label>
              <Input
                placeholder="Enter or swipe card ID (e.g. CIR-CARD-001)"
                value={smartcardId}
                onChange={(e) => setSmartcardId(e.target.value)}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Connected to AttendanceDesk hardware reader &amp; attendance.circuvent.com service.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSmartcardModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSmartcardPunch}
              disabled={actionLoading}
              className="bg-gradient-to-r from-cyan-600 to-blue-600 text-white gap-1.5"
            >
              <Radio className="h-4 w-4" />
              {isClockedIn ? "Tap Card to Clock Out" : "Tap Card to Clock In"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: REGULARIZE ATTENDANCE                                    */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={regularizeOpen} onOpenChange={setRegularizeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Regularize Attendance</DialogTitle>
            <DialogDescription>
              Submit an attendance adjustment request to your reporting manager.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Date to Regularize *</Label>
              <Input
                type="date"
                value={regForm.date}
                onChange={(e) => setRegForm({ ...regForm, date: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Reason *</Label>
              <Select
                value={regForm.reason}
                onValueChange={(val) => setRegForm({ ...regForm, reason: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="missed_punch">Missed Punch (Forgot to tap)</SelectItem>
                  <SelectItem value="work_from_home">Work From Home (Approved Remote)</SelectItem>
                  <SelectItem value="on_duty">On-Duty / Client Visit</SelectItem>
                  <SelectItem value="system_error">System / Biometric Reader Error</SelectItem>
                  <SelectItem value="wrong_time">Wrong Timestamp Recorded</SelectItem>
                  <SelectItem value="shift_change">Shift Schedule Adjustment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Clock In Time *</Label>
                <Input
                  type="time"
                  value={regForm.inTime}
                  onChange={(e) => setRegForm({ ...regForm, inTime: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Clock Out Time *</Label>
                <Input
                  type="time"
                  value={regForm.outTime}
                  onChange={(e) => setRegForm({ ...regForm, outTime: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Note / Justification</Label>
              <Textarea
                placeholder="Explain the reason for regularisation..."
                value={regForm.note}
                onChange={(e) => setRegForm({ ...regForm, note: e.target.value })}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRegularizeOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRegularizeSubmit}
              disabled={actionLoading}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
            >
              {actionLoading ? "Submitting..." : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
