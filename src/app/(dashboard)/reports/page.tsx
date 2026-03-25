"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText, Download, Search, BarChart3, Users,
  CalendarDays, DollarSign, Headphones, Clock, FileBarChart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
  Tooltip as RTooltip,
} from "recharts";
import {
  useEmployeeStore, useLeaveStore, useExpenseStore, useTicketStore,
  startSync,
} from "@/stores/unified-store";
import { COLLECTIONS, genericService } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];

const REPORT_TEMPLATES = [
  { id: "headcount", name: "Headcount Summary", icon: Users, category: "HR" },
  { id: "attrition", name: "Attrition Report", icon: BarChart3, category: "HR" },
  { id: "leave-summary", name: "Leave Summary", icon: CalendarDays, category: "Leave" },
  { id: "expense-report", name: "Expense Analysis", icon: DollarSign, category: "Finance" },
  { id: "ticket-summary", name: "Helpdesk Summary", icon: Headphones, category: "IT" },
  { id: "dept-distribution", name: "Department Distribution", icon: BarChart3, category: "HR" },
  { id: "salary-report", name: "Compensation Report", icon: DollarSign, category: "Finance" },
  { id: "monthly-attendance", name: "Monthly Attendance", icon: Clock, category: "Attendance" },
];

export default function ReportsPage() {
  const empStore = useEmployeeStore();
  const leaveStore = useLeaveStore();
  const expenseStore = useExpenseStore();
  const ticketStore = useTicketStore();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("library");

  useEffect(() => {
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
    if (!leaveStore.initialized) startSync(COLLECTIONS.leaves, leaveStore);
    if (!expenseStore.initialized) startSync(COLLECTIONS.expenses, expenseStore);
    if (!ticketStore.initialized) startSync(COLLECTIONS.helpdesk, ticketStore);
  }, [empStore, leaveStore, expenseStore, ticketStore]);

  const filteredTemplates = useMemo(() => {
    if (!search) return REPORT_TEMPLATES;
    const q = search.toLowerCase();
    return REPORT_TEMPLATES.filter(t =>
      t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
    );
  }, [search]);

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

  const handleGenerate = useCallback((name: string) => {
    toast.success(`Generating "${name}" report…`);
  }, []);

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
        </TabsList>

        <TabsContent value="library" className="space-y-4 mt-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search reports…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          {filteredTemplates.length === 0 ? (
            <DataEmptyState icon={FileBarChart} title="No matching reports" description="Try a different search term." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {filteredTemplates.map(t => (
                <Card key={t.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                        <t.icon className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{t.name}</p>
                        <Badge variant="secondary" className="text-xs">{t.category}</Badge>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="gap-2" onClick={() => handleGenerate(t.name)}>
                      <Download className="h-3.5 w-3.5" /> Generate
                    </Button>
                  </CardContent>
                </Card>
              ))}
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
      </Tabs>
    </div>
  );
}
