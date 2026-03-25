"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users, Building2, MapPin, Briefcase, TrendingUp,
  Calendar, Clock, BarChart3, PieChart as PieChartIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from "recharts";
import { useEmployeeStore, useAttendanceStore, startSync } from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// WORKFORCE ANALYTICS — Headcount, distribution, trends
// ═══════════════════════════════════════════════════════════════

const BAR_COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#6366f1", "#14b8a6", "#f97316", "#84cc16"];
const PIE_COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#6366f1", "#14b8a6"];

export default function WorkforcePage() {
  const empStore = useEmployeeStore();
  const attStore = useAttendanceStore();
  const [tab, setTab] = useState("workforce");

  useEffect(() => {
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
    if (!attStore.initialized) startSync(COLLECTIONS.attendance, attStore);
  }, [empStore, attStore]);

  const loading = empStore.loading && !empStore.initialized;
  const employees = empStore.items;

  const totalHeadcount = employees.length;
  const activeCount = useMemo(() => employees.filter(e => e.status === "active").length, [employees]);
  const deptCount = useMemo(() => new Set(employees.map(e => e.department).filter(Boolean)).size, [employees]);
  const locationCount = useMemo(() => new Set(employees.map(e => e.location).filter(Boolean)).size, [employees]);

  const deptData = useMemo(() => {
    const map = new Map<string, number>();
    employees.forEach(e => {
      const dept = e.department || "Unassigned";
      map.set(dept, (map.get(dept) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [employees]);

  const typeData = useMemo(() => {
    const map = new Map<string, number>();
    employees.forEach(e => {
      const type = e.employmentType || "Unknown";
      map.set(type, (map.get(type) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [employees]);

  const locationData = useMemo(() => {
    const map = new Map<string, number>();
    employees.forEach(e => {
      const loc = e.location || "Unknown";
      map.set(loc, (map.get(loc) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [employees]);

  const tenureData = useMemo(() => {
    const buckets: Record<string, number> = { "< 1 yr": 0, "1-2 yrs": 0, "2-5 yrs": 0, "5-10 yrs": 0, "10+ yrs": 0 };
    const now = new Date();
    employees.forEach(e => {
      if (!e.joiningDate) return;
      const years = (now.getTime() - new Date(e.joiningDate).getTime()) / (365.25 * 86400000);
      if (years < 1) buckets["< 1 yr"]++;
      else if (years < 2) buckets["1-2 yrs"]++;
      else if (years < 5) buckets["2-5 yrs"]++;
      else if (years < 10) buckets["5-10 yrs"]++;
      else buckets["10+ yrs"]++;
    });
    return Object.entries(buckets).map(([name, value]) => ({ name, value }));
  }, [employees]);

  const statusData = useMemo(() => {
    const map = new Map<string, number>();
    employees.forEach(e => { const s = e.status || "unknown"; map.set(s, (map.get(s) || 0) + 1); });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [employees]);

  const monthlyJoinData = useMemo(() => {
    const months: { name: string; joined: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const m = d.getMonth();
      const y = d.getFullYear();
      const joined = employees.filter(e => {
        if (!e.joiningDate) return false;
        const jd = new Date(e.joiningDate);
        return jd.getMonth() === m && jd.getFullYear() === y;
      }).length;
      months.push({ name: d.toLocaleString("default", { month: "short" }), joined });
    }
    return months;
  }, [employees]);

  const avgTenure = useMemo(() => {
    const now = new Date();
    const withDates = employees.filter(e => e.joiningDate);
    if (withDates.length === 0) return "0";
    const total = withDates.reduce((s, e) => s + (now.getTime() - new Date(e.joiningDate).getTime()) / (365.25 * 86400000), 0);
    return (total / withDates.length).toFixed(1);
  }, [employees]);

  const todayAttendance = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return attStore.items.filter(a => a.date === today).length;
  }, [attStore.items]);

  if (loading) return <div className="p-6"><DataLoadingSkeleton /></div>;

  if (employees.length === 0) return (
    <div className="p-6"><DataEmptyState {...EMPTY_STATES.employees} /></div>
  );

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Workforce Analytics</h1>
        <p className="text-muted-foreground text-sm mt-0.5">{totalHeadcount} employees · {deptCount} departments · {locationCount} locations</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Total Headcount", value: totalHeadcount, icon: Users, color: "from-violet-500 to-purple-600" },
          { label: "Active", value: activeCount, icon: TrendingUp, color: "from-emerald-500 to-green-600" },
          { label: "Departments", value: deptCount, icon: Building2, color: "from-blue-500 to-cyan-500" },
          { label: "Avg Tenure", value: `${avgTenure} yrs`, icon: Calendar, color: "from-amber-500 to-orange-500" },
          { label: "Today Attendance", value: todayAttendance, icon: Clock, color: "from-pink-500 to-rose-600" },
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="workforce">Workforce</TabsTrigger>
          <TabsTrigger value="distribution">Distribution</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>

        <TabsContent value="workforce" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Headcount by Department</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={deptData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" className="text-xs" />
                  <YAxis type="category" dataKey="name" width={120} className="text-xs" />
                  <RTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="value" name="Employees" radius={[0, 4, 4, 0]}>
                    {deptData.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Employee Status Breakdown</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {statusData.map(s => (
                  <Badge key={s.name} variant="secondary" className="text-xs py-1 px-3">
                    {s.name}: {s.value}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="distribution" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm">Employment Type</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                      {typeData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <RTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Location Distribution</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={locationData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                      {locationData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <RTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-sm">Tenure Distribution</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={tenureData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis className="text-xs" />
                  <RTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Employees" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Monthly Joining Trend (Last 6 Months)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthlyJoinData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis className="text-xs" />
                  <RTooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="joined" fill="#10b981" radius={[4, 4, 0, 0]} name="New Joiners" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground">Attrition Rate</p>
                <p className="text-2xl font-bold text-violet-600">{employees.filter(e => e.status === "notice_period" || e.status === "terminated").length > 0 ? ((employees.filter(e => e.status === "notice_period" || e.status === "terminated").length / totalHeadcount) * 100).toFixed(1) : "0"}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground">Gender Ratio (M:F)</p>
                <p className="text-2xl font-bold text-blue-600">—</p>
                <p className="text-[10px] text-muted-foreground">Data not available</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground">New Hires (This Month)</p>
                <p className="text-2xl font-bold text-emerald-600">{monthlyJoinData[monthlyJoinData.length - 1]?.joined ?? 0}</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}