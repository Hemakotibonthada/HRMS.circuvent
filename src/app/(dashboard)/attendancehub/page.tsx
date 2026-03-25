"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Clock, Users, CheckCircle2, XCircle, Home, AlertTriangle,
  Timer, ArrowUpRight, LogIn, CalendarDays, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, Legend, Cell,
} from "recharts";
import { useAttendanceStore, startSync, type AttendanceDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE HUB — Live stats, weekly chart, regularization queue
// ═══════════════════════════════════════════════════════════════

const STATUS_COLORS: Record<string, string> = {
  present: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  absent: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  wfh: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  late: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "half-day": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};
const BAR_COLORS = ["#8b5cf6", "#06b6d4", "#ef4444", "#f59e0b"];

export default function AttendanceHubPage() {
  const store = useAttendanceStore();
  const [tab, setTab] = useState("overview");
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (!store.initialized) startSync(COLLECTIONS.attendance, store);
  }, [store]);

  const loading = store.loading && !store.initialized;

  const todayStr = new Date().toISOString().slice(0, 10);

  const todayRecords = useMemo(() =>
    store.items.filter(a => a.date === todayStr),
  [store.items, todayStr]);

  const todayStats = useMemo(() => {
    const present = todayRecords.filter(a => a.status === "present").length;
    const absent = todayRecords.filter(a => a.status === "absent").length;
    const wfh = todayRecords.filter(a => a.status === "wfh").length;
    const late = todayRecords.filter(a => a.status === "late").length;
    const total = todayRecords.length;
    return { present, absent, wfh, late, total };
  }, [todayRecords]);

  const weeklyData = useMemo(() => {
    const now = new Date();
    const days: { name: string; present: number; absent: number; wfh: number; late: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayRecords = store.items.filter(a => a.date === dateStr);
      days.push({
        name: d.toLocaleDateString("en-US", { weekday: "short" }),
        present: dayRecords.filter(a => a.status === "present").length,
        absent: dayRecords.filter(a => a.status === "absent").length,
        wfh: dayRecords.filter(a => a.status === "wfh").length,
        late: dayRecords.filter(a => a.status === "late").length,
      });
    }
    return days;
  }, [store.items]);

  const regularizationQueue = useMemo(() =>
    store.items.filter(a => !a.clockOut && a.clockIn && a.date < todayStr).slice(0, 10),
  [store.items, todayStr]);

  const avgHours = useMemo(() => {
    const withHours = store.items.filter(a => a.hours > 0);
    if (withHours.length === 0) return 0;
    return (withHours.reduce((s, a) => s + a.hours, 0) / withHours.length).toFixed(1);
  }, [store.items]);

  const handleClockIn = useCallback(async () => {
    try {
      const now = new Date();
      await genericService(COLLECTIONS.attendance).create({
        employeeId: "current-user",
        employeeName: "Current User",
        date: now.toISOString().slice(0, 10),
        clockIn: now.toISOString(),
        clockOut: "",
        status: now.getHours() >= 10 ? "late" : "present",
        hours: 0, overtime: 0, location: "Office",
      });
      toast.success("Clocked in successfully!");
    } catch { toast.error("Failed to clock in"); }
  }, []);

  const handleRegularize = useCallback(async (record: AttendanceDoc) => {
    try {
      await genericService(COLLECTIONS.attendance).update(record.id, {
        clockOut: new Date(record.clockIn).toISOString().replace(/T.*/, "T18:00:00.000Z"),
        hours: 8, status: "present",
      });
      toast.success("Attendance regularized");
    } catch { toast.error("Failed to regularize"); }
  }, []);

  const attendanceRate = todayStats.total > 0
    ? Math.round(((todayStats.present + todayStats.wfh) / todayStats.total) * 100)
    : 0;

  if (loading) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Attendance Hub</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{store.items.length} records · Today: {todayStats.total} entries</p>
        </div>
        <Button className="gap-2 bg-gradient-to-r from-emerald-500 to-green-600 text-white border-0" onClick={handleClockIn}>
          <LogIn className="h-4 w-4" /> Clock In
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Present Today", value: todayStats.present, icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Absent", value: todayStats.absent, icon: XCircle, color: "from-red-500 to-rose-600" },
          { label: "Work from Home", value: todayStats.wfh, icon: Home, color: "from-blue-500 to-cyan-500" },
          { label: "Late Arrivals", value: todayStats.late, icon: AlertTriangle, color: "from-amber-500 to-orange-500" },
          { label: "Avg Hours", value: avgHours, icon: Timer, color: "from-violet-500 to-purple-600" },
        ].map(kpi => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.color)}>
                <kpi.icon className="h-5 w-5 text-white" />
              </div>
              <div><p className="text-xs text-muted-foreground">{kpi.label}</p><p className="text-lg font-bold">{kpi.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Attendance Rate</p>
            <span className="text-sm font-bold text-violet-600">{attendanceRate}%</span>
          </div>
          <Progress value={attendanceRate} className="h-2" />
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="overview">Weekly Overview</TabsTrigger><TabsTrigger value="regularize">Regularization ({regularizationQueue.length})</TabsTrigger></TabsList>

        <TabsContent value="overview">
          {store.items.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.attendance} />
          ) : (
            <Card>
              <CardHeader><CardTitle className="text-sm">Weekly Attendance Trend</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={weeklyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" className="text-xs" />
                    <YAxis className="text-xs" />
                    <RTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Legend />
                    <Bar dataKey="present" fill="#10b981" radius={[4, 4, 0, 0]} name="Present" />
                    <Bar dataKey="absent" fill="#ef4444" radius={[4, 4, 0, 0]} name="Absent" />
                    <Bar dataKey="wfh" fill="#3b82f6" radius={[4, 4, 0, 0]} name="WFH" />
                    <Bar dataKey="late" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Late" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="regularize">
          {regularizationQueue.length === 0 ? (
            <DataEmptyState icon={CheckCircle2} title="All caught up" description="No pending regularizations." />
          ) : (
            <div className="space-y-2">
              {regularizationQueue.map(r => (
                <Card key={r.id}>
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-sm">{r.employeeName}</h3>
                      <p className="text-xs text-muted-foreground">{r.date} · Clock In: {new Date(r.clockIn).toLocaleTimeString()} · No clock out</p>
                    </div>
                    <Badge className={cn("text-xs", STATUS_COLORS[r.status] || "bg-gray-100")}>{r.status}</Badge>
                    <Button size="sm" variant="outline" onClick={() => handleRegularize(r)}>Regularize</Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader><CardTitle className="text-sm">Today&apos;s Log</CardTitle></CardHeader>
        <CardContent>
          {todayRecords.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No attendance records for today yet.</p>
          ) : (
            <div className="space-y-2">
              {todayRecords.slice(0, 8).map(r => (
                <div key={r.id} className="flex items-center gap-3 text-sm">
                  <Badge className={cn("text-xs w-16 justify-center", STATUS_COLORS[r.status] || "bg-gray-100")}>{r.status}</Badge>
                  <span className="font-medium flex-1">{r.employeeName}</span>
                  <span className="text-muted-foreground">{r.clockIn ? new Date(r.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "–"}</span>
                  <span className="text-muted-foreground">{r.clockOut ? new Date(r.clockOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "–"}</span>
                  <span className="text-muted-foreground">{r.hours > 0 ? `${r.hours}h` : "–"}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}