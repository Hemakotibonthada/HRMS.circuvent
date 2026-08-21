"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  FileText, Download, Search, Users,
  CalendarDays, DollarSign, Headphones, Clock, FileBarChart,
  Target, TrendingUp, Briefcase, Shield, Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
  Tooltip as RTooltip, LineChart, Line, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, ComposedChart,
} from "recharts";
import {
  useEmployeeStore, useLeaveStore, useExpenseStore, useTicketStore,
  useAttendanceStore, useGoalStore, useJobStore,
  startSync,
} from "@/stores/unified-store";
import { COLLECTIONS, genericService } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];

// This used to be a static list of twelve report names whose "Generate"
// button only called toast.success — no request was ever sent, so every
// report claimed to exist and none of them actually ran. The catalogue and
// the run action below now come from /api/reports and /api/reports/run,
// which execute real, permission-scoped queries against tenant data.
interface ReportPreset {
  id: string;
  name: string;
  description: string;
  definition: { source: string; [key: string]: unknown };
}

interface ReportResult {
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

// Keyed by the real `source` on each preset's definition, not invented per report.
const SOURCE_ICONS: Record<string, LucideIcon> = { employees: Users, leave: CalendarDays, attendance: Clock };

export default function ReportsPage() {
  const empStore = useEmployeeStore();
  const leaveStore = useLeaveStore();
  const expenseStore = useExpenseStore();
  const ticketStore = useTicketStore();
  const attStore = useAttendanceStore();
  const goalStore = useGoalStore();
  const jobStore = useJobStore();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("library");
  const [presets, setPresets] = useState<ReportPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [sourceLabels, setSourceLabels] = useState<Record<string, string>>({});
  const [runningId, setRunningId] = useState<string | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [recruitmentFunnel, setRecruitmentFunnel] = useState<{ stage: string; count: number }[]>([]);

  useEffect(() => {
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
    if (!leaveStore.initialized) startSync(COLLECTIONS.leaves, leaveStore);
    if (!expenseStore.initialized) startSync(COLLECTIONS.expenses, expenseStore);
    if (!ticketStore.initialized) startSync(COLLECTIONS.helpdesk, ticketStore);
    if (!attStore.initialized) startSync(COLLECTIONS.attendance, attStore);
    if (!goalStore.initialized) startSync(COLLECTIONS.goals, goalStore);
    if (!jobStore.initialized) startSync(COLLECTIONS.recruitment, jobStore);
  }, [empStore, leaveStore, expenseStore, ticketStore, attStore, goalStore, jobStore]);

  // Stage counts used to come from applying fixed dropoff percentages (60%,
  // 30%, 10%, 5%) to the total applicant count, so the chart always showed
  // the same shape of funnel no matter how hiring was actually going. The
  // real per-stage counts are tracked in the application event log, so they
  // are fetched from there instead.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ats/reports?report=funnel");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "Could not load the recruitment funnel");
        type FunnelStageRow = { name: string; entered: number };
        setRecruitmentFunnel((data.stages ?? []).map((s: FunnelStageRow) => ({ stage: s.name, count: s.entered })));
      } catch {
        if (!cancelled) setRecruitmentFunnel([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // The report catalogue is server-defined (role-gated presets, e.g. salary
  // reports require payroll.view), so it is fetched rather than hardcoded here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/reports");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "Could not load reports");
        setPresets(data.presets ?? []);
        const labels: Record<string, string> = {};
        for (const s of data.sources ?? []) labels[s.key] = s.label;
        setSourceLabels(labels);
      } catch {
        if (!cancelled) toast.error("Could not load the report catalogue");
      } finally {
        if (!cancelled) setPresetsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filteredPresets = useMemo(() => {
    if (!search) return presets;
    const q = search.toLowerCase();
    return presets.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      (sourceLabels[p.definition.source] ?? "").toLowerCase().includes(q)
    );
  }, [search, presets, sourceLabels]);

  const deptData = useMemo(() => {
    const counts: Record<string, number> = {};
    empStore.items.forEach(e => { counts[e.department || "Other"] = (counts[e.department || "Other"] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [empStore.items]);

  const leaveByType = useMemo(() => {
    const counts: Record<string, number> = {};
    leaveStore.items.forEach(l => { counts[l.leaveType || "Other"] = (counts[l.leaveType || "Other"] || 0) + (l.days || 1); });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [leaveStore.items]);

  const expenseByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    expenseStore.items.forEach(e => { counts[e.category || "Other"] = (counts[e.category || "Other"] || 0) + (e.amount || 0); });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [expenseStore.items]);

  // Monthly hiring trend (ComposedChart data)
  const monthlyTrend = useMemo(() => {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months.map((m, i) => ({
      month: m,
      hired: empStore.items.filter(e => e.joiningDate && new Date(e.joiningDate).getMonth() === i).length,
      leaves: leaveStore.items.filter(l => l.fromDate && new Date(l.fromDate).getMonth() === i).reduce((s, l) => s + (l.days || 0), 0),
      expenses: expenseStore.items.filter(e => e.date && new Date(e.date).getMonth() === i).reduce((s, e) => s + (e.amount || 0), 0),
    }));
  }, [empStore.items, leaveStore.items, expenseStore.items]);

  // Attendance rate trend
  const attendanceRate = useMemo(() => {
    const byDate: Record<string, { present: number; total: number }> = {};
    attStore.items.forEach(a => {
      if (!a.date) return;
      const d = a.date.substring(5);
      if (!byDate[d]) byDate[d] = { present: 0, total: 0 };
      byDate[d].total++;
      if (a.status === "present" || a.status === "late" || a.status === "wfh") byDate[d].present++;
    });
    return Object.entries(byDate).sort().slice(-15).map(([date, v]) => ({
      date, rate: v.total > 0 ? Math.round((v.present / v.total) * 100) : 0,
    }));
  }, [attStore.items]);

  // Performance radar
  const performanceRadar = useMemo(() => {
    const cats: Record<string, { total: number; sum: number }> = {};
    goalStore.items.forEach(g => {
      const c = g.category || "General";
      if (!cats[c]) cats[c] = { total: 0, sum: 0 };
      cats[c].total++;
      cats[c].sum += (g.progress || 0);
    });
    return Object.entries(cats).map(([name, v]) => ({
      category: name.length > 10 ? name.substring(0, 10) + "…" : name,
      progress: v.total > 0 ? Math.round(v.sum / v.total) : 0,
      count: v.total,
    }));
  }, [goalStore.items]);

  const handleGenerate = useCallback(async (preset: ReportPreset) => {
    setRunningId(preset.id);
    try {
      const res = await fetch("/api/reports/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preset.definition),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "The report could not be run");
        return;
      }
      setResult({ name: preset.name, columns: data.columns, rows: data.rows, rowCount: data.rowCount });
      toast.success(`"${preset.name}" ready — ${data.rowCount} row${data.rowCount === 1 ? "" : "s"}`);
    } catch {
      toast.error("The report could not be run");
    } finally {
      setRunningId(null);
    }
  }, []);

  // The dialog only ever renders rows the server just returned for this
  // exact request, so a CSV built from them cannot drift from what's on screen.
  const downloadCsv = useCallback(() => {
    if (!result) return;
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      result.columns.join(","),
      ...result.rows.map(row => result.columns.map(c => escape(row[c])).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const isLoading = empStore.loading && !empStore.initialized;
  if (isLoading) return <DataLoadingSkeleton />;

  const activeEmps = empStore.items.filter(e => e.status === "active").length;
  const pendingLeaves = leaveStore.items.filter(l => l.status === "pending").length;
  const totalExpenses = expenseStore.items.reduce((s, e) => s + (e.amount || 0), 0);
  const openTickets = ticketStore.items.filter(t => t.status === "open" || t.status === "in_progress").length;

  const kpis = [
    { label: "Active Employees", value: activeEmps, icon: Users, gradient: "from-violet-500 to-purple-600" },
    { label: "Pending Leaves", value: pendingLeaves, icon: CalendarDays, gradient: "from-amber-500 to-orange-500" },
    { label: "Total Expenses", value: `₹${totalExpenses.toLocaleString()}`, icon: DollarSign, gradient: "from-emerald-500 to-green-600" },
    { label: "Open Tickets", value: openTickets, icon: Headphones, gradient: "from-blue-500 to-cyan-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Reports</h1>
          <p className="text-muted-foreground mt-1">Generate and view analytics reports</p>
        </div>
      </div>

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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="live">Live Metrics</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="space-y-4 mt-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search reports…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          {presetsLoading ? (
            <DataLoadingSkeleton />
          ) : filteredPresets.length === 0 ? (
            <DataEmptyState
              icon={FileBarChart}
              title={presets.length === 0 ? "No reports available" : "No matching reports"}
              description={presets.length === 0 ? "No report presets are configured for this account." : "Try a different search term."}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {filteredPresets.map(p => {
                const Icon = SOURCE_ICONS[p.definition.source] ?? FileBarChart;
                const isRunning = runningId === p.id;
                return (
                  <Card key={p.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-4 flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                          <Icon className="h-5 w-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{p.name}</p>
                          <Badge variant="secondary" className="text-xs">{sourceLabels[p.definition.source] ?? p.definition.source}</Badge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
                      <Button size="sm" variant="outline" className="gap-2" disabled={isRunning} onClick={() => handleGenerate(p)}>
                        {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                        {isRunning ? "Running…" : "Generate"}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="live" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Department Distribution</CardTitle></CardHeader>
              <CardContent>
                {deptData.length === 0 ? <DataEmptyState compact {...EMPTY_STATES.employees} /> : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={deptData} cx="50%" cy="50%" outerRadius={90} dataKey="value" nameKey="name" label>
                        {deptData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Legend />
                      <RTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Leave by Type</CardTitle></CardHeader>
              <CardContent>
                {leaveByType.length === 0 ? <DataEmptyState compact {...EMPTY_STATES.leave} /> : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={leaveByType}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <RTooltip />
                      <Bar dataKey="value" fill="#8b5cf6" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Expense by Category</CardTitle></CardHeader>
              <CardContent>
                {expenseByCategory.length === 0 ? <DataEmptyState compact {...EMPTY_STATES.expenses} /> : (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={expenseByCategory}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <RTooltip />
                      <Area type="monotone" dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Trends Tab */}
        <TabsContent value="trends" className="space-y-6 mt-4">
          {/* Monthly Composed Chart */}
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Monthly Activity Overview</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={monthlyTrend}>
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Attendance Rate LineChart */}
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Attendance Rate Trend</CardTitle></CardHeader>
              <CardContent>
                {attendanceRate.length > 0 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={attendanceRate}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                      <RTooltip />
                      <Line type="monotone" dataKey="rate" name="Attendance %" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: "#8b5cf6", r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <DataEmptyState compact title="No attendance data" description="Clock-in records will populate this chart." />}
              </CardContent>
            </Card>

            {/* Recruitment Funnel */}
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Recruitment Funnel</CardTitle></CardHeader>
              <CardContent>
                {recruitmentFunnel.every(r => r.count === 0) ? (
                  <DataEmptyState compact title="No recruitment data" description="Post jobs to see the funnel." />
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={recruitmentFunnel} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="stage" type="category" width={80} tick={{ fontSize: 10 }} />
                      <RTooltip />
                      <Bar dataKey="count" name="Candidates" radius={[0, 6, 6, 0]}>
                        {recruitmentFunnel.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Performance Radar */}
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Goal Progress by Category</CardTitle></CardHeader>
              <CardContent>
                {performanceRadar.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <RadarChart data={performanceRadar}>
                      <PolarGrid stroke="hsl(var(--border))" />
                      <PolarAngleAxis dataKey="category" tick={{ fontSize: 10 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                      <Radar name="Progress %" dataKey="progress" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.25} strokeWidth={2} />
                      <RTooltip />
                      <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : <DataEmptyState compact title="No goals data" description="Set performance goals to see the radar." />}
              </CardContent>
            </Card>

            {/* Goal Status Distribution */}
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Goal Status Distribution</CardTitle></CardHeader>
              <CardContent>
                {goalStore.items.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={(() => {
                          const m: Record<string, number> = {};
                          goalStore.items.forEach(g => { m[g.status || "unknown"] = (m[g.status || "unknown"] || 0) + 1; });
                          return Object.entries(m).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
                        })()} cx="50%" cy="50%" innerRadius={40} outerRadius={80} paddingAngle={3} dataKey="value" labelLine={false}>
                          {goalStore.items.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <RTooltip />
                        <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      {[
                        { label: "On Track", value: goalStore.items.filter(g => g.status === "on_track").length, color: "text-emerald-600" },
                        { label: "At Risk", value: goalStore.items.filter(g => g.status === "at_risk").length, color: "text-amber-600" },
                        { label: "Behind", value: goalStore.items.filter(g => g.status === "behind").length, color: "text-red-600" },
                      ].map(s => (
                        <div key={s.label} className="text-center rounded-lg bg-muted/30 p-2">
                          <p className={cn("text-lg font-bold", s.color)}>{s.value}</p>
                          <p className="text-[9px] text-muted-foreground">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : <DataEmptyState compact title="No goals data" description="Create goals to see status distribution." />}
              </CardContent>
            </Card>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Goals", value: goalStore.items.length, icon: Target, gradient: "from-violet-500 to-purple-600" },
              { label: "Avg Progress", value: `${goalStore.items.length > 0 ? Math.round(goalStore.items.reduce((s, g) => s + (g.progress || 0), 0) / goalStore.items.length) : 0}%`, icon: TrendingUp, gradient: "from-emerald-500 to-green-600" },
              { label: "Open Positions", value: jobStore.items.filter(j => j.status === "open").length, icon: Briefcase, gradient: "from-blue-500 to-cyan-500" },
              { label: "Total Applicants", value: jobStore.items.reduce((s, j) => s + (j.applicants || 0), 0), icon: Users, gradient: "from-amber-500 to-orange-500" },
            ].map(kpi => (
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
        </TabsContent>
      </Tabs>

      {/* Every row shown here is what /api/reports/run just returned for this
          exact request — nothing is cached or re-derived, so the CSV export
          below can't drift from what's on screen. */}
      <Dialog open={result !== null} onOpenChange={(open) => { if (!open) setResult(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{result?.name ?? "Report"}</DialogTitle>
            <DialogDescription>
              {result?.rowCount ?? 0} row{(result?.rowCount ?? 0) === 1 ? "" : "s"} returned
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {(result?.columns ?? []).map(c => <TableHead key={c}>{c}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(result?.rows ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={Math.max(result?.columns.length ?? 1, 1)} className="text-center text-muted-foreground">
                      No rows matched this report.
                    </TableCell>
                  </TableRow>
                ) : (result?.rows ?? []).map((row, i) => (
                  <TableRow key={i}>
                    {(result?.columns ?? []).map(c => <TableCell key={c}>{String(row[c] ?? "")}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" className="gap-2" disabled={!result || result.rows.length === 0} onClick={downloadCsv}>
              <Download className="h-3.5 w-3.5" /> Download CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
