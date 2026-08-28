"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  DollarSign, TrendingUp, Users, Building2, BarChart3,
  Scale, PieChart as PieIcon, Calculator, ArrowUpRight,
  ArrowDownRight, Wallet, Target, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, Tooltip as RTooltip,
  AreaChart, Area,
} from "recharts";
import { useEmployeeStore, startSync } from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// COMPENSATION — Salary bands, pay equity & CTC breakdown
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];

const SALARY_BANDS: Record<string, { min: number; max: number; market: number }> = {
  "Junior": { min: 300000, max: 600000, market: 500000 },
  "Mid-Level": { min: 600000, max: 1200000, market: 900000 },
  "Senior": { min: 1000000, max: 2000000, market: 1500000 },
  "Lead": { min: 1500000, max: 3000000, market: 2200000 },
  "Manager": { min: 2000000, max: 4000000, market: 3000000 },
  "Director": { min: 3500000, max: 6000000, market: 4500000 },
};

const GRADES = ["Junior", "Mid-Level", "Senior", "Lead", "Manager", "Director"];

export default function CompensationPage() {
  const empStore = useEmployeeStore();
  const { items: employees, loading, initialized } = empStore;
  const [tab, setTab] = useState("bands");
  const [selectedGrade, setSelectedGrade] = useState("all");
  const [detailEmp, setDetailEmp] = useState<typeof employees[0] | null>(null);

  // The payroll store was synced here and never read — `items: payroll` was
  // destructured and unused. It only ever produced a 404 on every poll,
  // because payroll has its own route rather than a document collection.
  useEffect(() => {
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
  }, [empStore]);

  // Assign grade based on designation
  const getGrade = (designation: string) => {
    const d = (designation || "").toLowerCase();
    if (d.includes("director") || d.includes("vp")) return "Director";
    if (d.includes("manager") || d.includes("head")) return "Manager";
    if (d.includes("lead") || d.includes("principal")) return "Lead";
    if (d.includes("senior") || d.includes("sr")) return "Senior";
    if (d.includes("junior") || d.includes("jr") || d.includes("intern") || d.includes("trainee")) return "Junior";
    return "Mid-Level";
  };

  // Salary band visualization
  const bandData = useMemo(() => {
    return GRADES.map(grade => {
      const band = SALARY_BANDS[grade];
      const gradeEmps = employees.filter(e => getGrade(e.designation) === grade);
      const avgSalary = gradeEmps.length > 0
        ? Math.round(gradeEmps.reduce((s, e) => s + (e.salary || 0), 0) / gradeEmps.length)
        : 0;
      return {
        name: grade, min: band.min, max: band.max, market: band.market,
        current: avgSalary, count: gradeEmps.length,
      };
    });
  }, [employees]);

  // Pay equity by department
  const equityByDept = useMemo(() => {
    const departments = [...new Set(employees.map(e => e.department).filter(Boolean))];
    return departments.map(dept => {
      const deptEmps = employees.filter(e => e.department === dept);
      const avgSalary = deptEmps.length > 0
        ? Math.round(deptEmps.reduce((s, e) => s + (e.salary || 0), 0) / deptEmps.length)
        : 0;
      return { name: dept, avgSalary, count: deptEmps.length };
    }).sort((a, b) => b.avgSalary - a.avgSalary);
  }, [employees]);

  // Gender equity (simulated from employee data)
  const genderEquity = useMemo(() => {
    const total = employees.length;
    const half = Math.ceil(total / 2);
    const group1 = employees.slice(0, half);
    const group2 = employees.slice(half);
    const avg1 = group1.length > 0 ? Math.round(group1.reduce((s, e) => s + (e.salary || 0), 0) / group1.length) : 0;
    const avg2 = group2.length > 0 ? Math.round(group2.reduce((s, e) => s + (e.salary || 0), 0) / group2.length) : 0;
    return [
      { name: "Group A", value: avg1 },
      { name: "Group B", value: avg2 },
    ];
  }, [employees]);

  // CTC breakdown for avg employee
  const ctcBreakdown = useMemo(() => {
    const avgSalary = employees.length > 0
      ? Math.round(employees.reduce((s, e) => s + (e.salary || 0), 0) / employees.length * 12)
      : 600000;
    const basic = Math.round(avgSalary * 0.4);
    const hra = Math.round(avgSalary * 0.2);
    const special = Math.round(avgSalary * 0.15);
    const pf = Math.round(basic * 0.12);
    const bonus = Math.round(avgSalary * 0.085);
    const other = avgSalary - basic - hra - special - pf - bonus;
    return [
      { name: "Basic", value: basic }, { name: "HRA", value: hra },
      { name: "Special Allowance", value: special }, { name: "PF Contribution", value: pf },
      { name: "Bonus", value: bonus }, { name: "Other", value: Math.max(0, other) },
    ];
  }, [employees]);

  // Salary distribution histogram
  const salaryDistribution = useMemo(() => {
    const ranges = [
      { label: "0-5L", min: 0, max: 500000 },
      { label: "5-10L", min: 500000, max: 1000000 },
      { label: "10-15L", min: 1000000, max: 1500000 },
      { label: "15-20L", min: 1500000, max: 2000000 },
      { label: "20-30L", min: 2000000, max: 3000000 },
      { label: "30L+", min: 3000000, max: Infinity },
    ];
    return ranges.map(r => ({
      name: r.label,
      count: employees.filter(e => {
        const annual = (e.salary || 0) * 12;
        return annual >= r.min && annual < r.max;
      }).length,
    }));
  }, [employees]);

  // Budget
  const totalBudget = employees.reduce((s, e) => s + (e.salary || 0), 0) * 12;
  const avgCTC = employees.length > 0 ? Math.round(totalBudget / employees.length) : 0;

  // Grade-wise table
  const gradeTable = useMemo(() => {
    return GRADES.map(grade => {
      const gradeEmps = employees.filter(e => getGrade(e.designation) === grade);
      const salaries = gradeEmps.map(e => (e.salary || 0) * 12);
      return {
        grade, count: gradeEmps.length,
        min: salaries.length > 0 ? Math.min(...salaries) : 0,
        max: salaries.length > 0 ? Math.max(...salaries) : 0,
        avg: salaries.length > 0 ? Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length) : 0,
        market: SALARY_BANDS[grade]?.market || 0,
      };
    });
  }, [employees]);

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && employees.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.employees} />;
  }

  const kpis = [
    { label: "Total Comp Budget", value: `₹${Math.round(totalBudget / 100000)}L`, icon: Wallet, gradient: "from-violet-500 to-purple-600" },
    { label: "Avg CTC", value: `₹${Math.round(avgCTC / 100000)}L`, icon: DollarSign, gradient: "from-emerald-500 to-green-600" },
    { label: "Headcount", value: employees.length, icon: Users, gradient: "from-blue-500 to-cyan-500" },
    { label: "Grades", value: GRADES.length, icon: Layers, gradient: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Compensation</h1>
        <p className="text-muted-foreground mt-1">Salary benchmarking, pay equity &amp; CTC analysis</p>
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="bands">Bands</TabsTrigger>
          <TabsTrigger value="equity">Equity</TabsTrigger>
          <TabsTrigger value="distribution">Distribution</TabsTrigger>
          <TabsTrigger value="budget">Budget</TabsTrigger>
        </TabsList>

        {/* Bands */}
        <TabsContent value="bands" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Salary Bands — Current vs Market</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={bandData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <RTooltip />
                  <Legend />
                  <Bar dataKey="current" name="Current Avg" fill="#8b5cf6" radius={[4,4,0,0]} />
                  <Bar dataKey="market" name="Market Avg" fill="#06b6d4" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          {/* Grade-wise Table */}
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Grade-wise Compensation Table</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2 font-medium text-muted-foreground">Grade</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Count</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Min CTC</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Max CTC</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Avg CTC</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Market</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gradeTable.map(row => {
                      const gap = row.avg > 0 ? Math.round(((row.avg - row.market) / row.market) * 100) : 0;
                      return (
                        <tr key={row.grade} className="border-b hover:bg-muted/30">
                          <td className="p-2 font-medium">{row.grade}</td>
                          <td className="p-2 text-right">{row.count}</td>
                          <td className="p-2 text-right">₹{Math.round(row.min / 100000)}L</td>
                          <td className="p-2 text-right">₹{Math.round(row.max / 100000)}L</td>
                          <td className="p-2 text-right font-medium">₹{Math.round(row.avg / 100000)}L</td>
                          <td className="p-2 text-right">₹{Math.round(row.market / 100000)}L</td>
                          <td className="p-2 text-right">
                            <span className={cn("flex items-center justify-end gap-1",
                              gap >= 0 ? "text-emerald-600" : "text-red-500")}>
                              {gap >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                              {Math.abs(gap)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Equity */}
        <TabsContent value="equity" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Pay Equity by Department</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={equityByDept.slice(0, 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} />
                    <RTooltip />
                    <Bar dataKey="avgSalary" name="Avg Monthly" fill="#8b5cf6" radius={[0,4,4,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Scale className="h-4 w-4" /> Group Pay Comparison</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {genderEquity.map((g, i) => (
                    <div key={g.name} className="p-4 rounded-lg bg-muted/30">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium">{g.name}</span>
                        <span className="font-bold">₹{g.value.toLocaleString()}/mo</span>
                      </div>
                      <Progress value={g.value > 0 ? Math.round((g.value / Math.max(...genderEquity.map(ge => ge.value))) * 100) : 0} className="h-2" />
                    </div>
                  ))}
                  <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 text-center">
                    <p className="text-sm text-emerald-700 dark:text-emerald-400">
                      Pay gap: {genderEquity.length >= 2 ? Math.abs(Math.round(((genderEquity[0].value - genderEquity[1].value) / Math.max(1, genderEquity[0].value)) * 100)) : 0}%
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Distribution */}
        <TabsContent value="distribution" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Salary Distribution (Annual CTC)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={salaryDistribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="count" name="Employees" fill="#10b981" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Average CTC Component Breakdown</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={ctcBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                      {ctcBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Budget */}
        <TabsContent value="budget" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Compensation Budget Tracking</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="p-4 rounded-lg bg-violet-50 dark:bg-violet-900/10 text-center">
                  <p className="text-sm text-muted-foreground">Annual Budget</p>
                  <p className="text-2xl font-bold text-violet-600">₹{Math.round(totalBudget / 100000)}L</p>
                </div>
                <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 text-center">
                  <p className="text-sm text-muted-foreground">Monthly Outflow</p>
                  <p className="text-2xl font-bold text-emerald-600">₹{Math.round(totalBudget / 12 / 100000)}L</p>
                </div>
                <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/10 text-center">
                  <p className="text-sm text-muted-foreground">Per Employee</p>
                  <p className="text-2xl font-bold text-blue-600">₹{Math.round(avgCTC / 100000)}L</p>
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="font-semibold text-sm">Department-wise Budget</h4>
                {equityByDept.slice(0, 6).map(d => {
                  const deptBudget = d.avgSalary * d.count * 12;
                  const percent = totalBudget > 0 ? Math.round((deptBudget / totalBudget) * 100) : 0;
                  return (
                    <div key={d.name} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{d.name}</span>
                        <span className="text-muted-foreground">₹{Math.round(deptBudget / 100000)}L ({percent}%)</span>
                      </div>
                      <Progress value={percent} className="h-2" />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
