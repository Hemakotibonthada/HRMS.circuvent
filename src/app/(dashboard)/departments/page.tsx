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
import { Separator } from "@/components/ui/separator";
import {
  Building2, Plus, Search, Users, DollarSign, MapPin,
  TrendingUp, Eye, Edit, Trash2, BarChart3, Grid3X3,
  ChevronRight, Mail, Phone, Briefcase, Target, Shield,
  PieChart as PieChartIcon, ArrowUpRight, UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRBAC } from "@/hooks/use-rbac";
import {
  useEmployeeStore, useDepartmentStore, startSync,
  type DepartmentDoc, type EmployeeDoc,
} from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, PieChart, Pie, Cell, Legend,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// DEPARTMENT MANAGEMENT — Department cards, headcount analytics,
// budget tracking, and team member drill-down
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#6366f1","#14b8a6"];
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "status-active" },
  inactive: { label: "Inactive", className: "status-rejected" },
  restructuring: { label: "Restructuring", className: "status-pending" },
};
const LOCATIONS = ["New York", "San Francisco", "London", "Bangalore", "Singapore", "Remote"];

export default function DepartmentsPage() {
  const rbac = useRBAC();
  const deptStore = useDepartmentStore();
  const empStore = useEmployeeStore();
  const { items: departments, loading, initialized } = deptStore;
  const { items: employees, initialized: empInit } = empStore;

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("grid");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailDept, setDetailDept] = useState<DepartmentDoc | null>(null);
  const [form, setForm] = useState({
    name: "", code: "", head: "", headEmail: "", description: "",
    budget: "", location: "", status: "active",
  });

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.departments, deptStore); }, [initialized, deptStore]);
  useEffect(() => { if (!empInit) startSync(COLLECTIONS.employees, empStore); }, [empInit, empStore]);

  const deptHeadcounts = useMemo(() => {
    const map: Record<string, number> = {};
    employees.forEach(e => { const d = e.department || "Unassigned"; map[d] = (map[d] || 0) + 1; });
    return map;
  }, [employees]);

  const filtered = useMemo(() => {
    if (!search) return departments;
    const q = search.toLowerCase();
    return departments.filter(d =>
      d.name?.toLowerCase().includes(q) || d.code?.toLowerCase().includes(q) ||
      d.head?.toLowerCase().includes(q) || d.location?.toLowerCase().includes(q)
    );
  }, [departments, search]);

  const totalBudget = useMemo(() => departments.reduce((s, d) => s + (d.budget || 0), 0), [departments]);
  const totalEmployees = employees.length;
  const avgSize = departments.length ? Math.round(totalEmployees / departments.length) : 0;
  const activeCount = departments.filter(d => d.status === "active").length;

  const headcountChartData = useMemo(() =>
    departments.map(d => ({
      name: d.name?.substring(0, 12) || "N/A",
      headcount: deptHeadcounts[d.name] || d.employees || 0,
      budget: (d.budget || 0) / 1000,
    })).sort((a, b) => b.headcount - a.headcount).slice(0, 10),
  [departments, deptHeadcounts]);

  const budgetPieData = useMemo(() =>
    departments.filter(d => d.budget > 0).map(d => ({
      name: d.name, value: d.budget,
    })).slice(0, 8),
  [departments]);

  const deptMembers = useMemo(() => {
    if (!detailDept) return [];
    return employees.filter(e => e.department === detailDept.name);
  }, [detailDept, employees]);

  const resetForm = () => setForm({ name: "", code: "", head: "", headEmail: "", description: "", budget: "", location: "", status: "active" });

  const handleCreate = async () => {
    if (!form.name || !form.code) { toast.error("Name and code are required"); return; }
    try {
      await genericService(COLLECTIONS.departments).create({
        ...form, budget: form.budget ? parseFloat(form.budget) : 0, employees: 0,
      });
      toast.success(`Department "${form.name}" created!`);
      setCreateOpen(false); resetForm();
    } catch { toast.error("Failed to create department"); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete department "${name}"?`)) return;
    try {
      await genericService(COLLECTIONS.departments).remove(id);
      deptStore.removeItem(id);
      toast.success(`"${name}" deleted`);
    } catch { toast.error("Delete failed"); }
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Departments</h1>
          <p className="text-muted-foreground mt-1">Organizational structure and team composition</p>
        </div>
        {rbac.can("departments.manage") && (
          <Button
            className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-lg gap-2"
            onClick={() => { resetForm(); setCreateOpen(true); }}
          >
            <Plus className="h-4 w-4" /> Add Department
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        {[
          { label: "Total Departments", value: departments.length, icon: Building2, gradient: "from-violet-500 to-purple-600" },
          { label: "Active", value: activeCount, icon: Shield, gradient: "from-emerald-500 to-green-600" },
          { label: "Total Headcount", value: totalEmployees, icon: Users, gradient: "from-blue-500 to-cyan-500" },
          { label: "Total Budget", value: `$${(totalBudget / 1000).toFixed(0)}K`, icon: DollarSign, gradient: "from-amber-500 to-orange-500" },
        ].map((kpi) => (
          <Card key={kpi.label} className="animate-slide-up">
            <CardContent className="p-4 flex items-center gap-4">
              <div className={cn("h-12 w-12 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md", kpi.gradient)}>
                <kpi.icon className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{kpi.label}</p>
                <p className="text-2xl font-bold">{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search + Tabs */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search departments..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="grid" className="gap-2"><Grid3X3 className="h-4 w-4" /> Grid View</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2"><BarChart3 className="h-4 w-4" /> Analytics</TabsTrigger>
        </TabsList>

        {/* Grid View */}
        <TabsContent value="grid" className="mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.departments} onAction={() => setCreateOpen(true)} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
              {filtered.map((dept, idx) => {
                const headcount = deptHeadcounts[dept.name] || dept.employees || 0;
                return (
                  <Card key={dept.id} className="hover:shadow-lg transition-shadow animate-slide-up cursor-pointer group" onClick={() => setDetailDept(dept)}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center shadow", COLORS[idx % COLORS.length] === "#8b5cf6" ? "from-violet-500 to-purple-600" : "from-blue-500 to-cyan-500")}>
                            <Building2 className="h-5 w-5 text-white" />
                          </div>
                          <div>
                            <CardTitle className="text-base">{dept.name}</CardTitle>
                            <p className="text-xs text-muted-foreground">{dept.code}</p>
                          </div>
                        </div>
                        <Badge className={cn(STATUS_CONF[dept.status]?.className || "status-active")}>
                          {STATUS_CONF[dept.status]?.label || dept.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <UserCheck className="h-4 w-4" />
                        <span>Head: {dept.head || "Unassigned"}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        <span>{dept.location || "Not Set"}</span>
                      </div>
                      <Separator />
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-muted-foreground">Employees</p>
                          <p className="font-semibold text-lg">{headcount}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Budget</p>
                          <p className="font-semibold text-lg">${((dept.budget || 0) / 1000).toFixed(0)}K</p>
                        </div>
                      </div>
                      {/* A "Budget Used" bar used to sit here claiming a
                          fixed 65% of every department's budget was spent —
                          the dept.budget term cancelled out of its own
                          formula, so it was mathematically the same number
                          for any non-zero budget. Expense claims (Travel,
                          Meals, Software, ...) are tracked per employee, not
                          rolled up against a department's total budget, so
                          there is no real spend figure to show here instead. */}
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity pt-1">
                        <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={e => { e.stopPropagation(); setDetailDept(dept); }}>
                          <Eye className="h-3 w-3" /> View
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1 text-destructive" onClick={e => { e.stopPropagation(); handleDelete(dept.id, dept.name); }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Analytics View */}
        <TabsContent value="analytics" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Headcount by Department</CardTitle></CardHeader>
              <CardContent>
                {headcountChartData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No data</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={headcountChartData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="name" fontSize={11} />
                      <YAxis fontSize={11} />
                      <RTooltip />
                      <Bar dataKey="headcount" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Budget Distribution</CardTitle></CardHeader>
              <CardContent>
                {budgetPieData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No budget data</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={budgetPieData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name }) => name}>
                        {budgetPieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Department Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {departments.map(d => {
                  const hc = deptHeadcounts[d.name] || d.employees || 0;
                  return (
                    <div key={d.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <Building2 className="h-5 w-5 text-violet-500" />
                        <div>
                          <p className="font-medium">{d.name}</p>
                          <p className="text-xs text-muted-foreground">Head: {d.head || "—"} | {d.location || "—"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-semibold">{hc}</p>
                          <p className="text-xs text-muted-foreground">Employees</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">${((d.budget || 0) / 1000).toFixed(0)}K</p>
                          <p className="text-xs text-muted-foreground">Budget</p>
                        </div>
                        <Badge className={cn(STATUS_CONF[d.status]?.className || "status-active")}>{STATUS_CONF[d.status]?.label || d.status}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Department Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Department</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Department Name *</Label>
                <Input placeholder="e.g. Engineering" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Code *</Label>
                <Input placeholder="e.g. ENG" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Department Head</Label>
                <Input placeholder="Head name" value={form.head} onChange={e => setForm(f => ({ ...f, head: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Head Email</Label>
                <Input type="email" placeholder="head@company.com" value={form.headEmail} onChange={e => setForm(f => ({ ...f, headEmail: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea placeholder="Department description..." value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Budget ($)</Label>
                <Input type="number" placeholder="e.g. 500000" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={form.location} onValueChange={v => setForm(f => ({ ...f, location: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                  <SelectContent>
                    {LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>Create Department</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Department Detail Dialog */}
      <Dialog open={!!detailDept} onOpenChange={() => setDetailDept(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-white" />
              </div>
              {detailDept?.name}
            </DialogTitle>
          </DialogHeader>
          {detailDept && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-sm text-muted-foreground">Code</p><p className="font-medium">{detailDept.code}</p></div>
                <div><p className="text-sm text-muted-foreground">Status</p><Badge className={cn(STATUS_CONF[detailDept.status]?.className || "status-active")}>{STATUS_CONF[detailDept.status]?.label || detailDept.status}</Badge></div>
                <div><p className="text-sm text-muted-foreground">Head</p><p className="font-medium">{detailDept.head || "—"}</p></div>
                <div><p className="text-sm text-muted-foreground">Location</p><p className="font-medium">{detailDept.location || "—"}</p></div>
                <div><p className="text-sm text-muted-foreground">Budget</p><p className="font-medium">${(detailDept.budget || 0).toLocaleString()}</p></div>
                <div><p className="text-sm text-muted-foreground">Headcount</p><p className="font-medium">{deptHeadcounts[detailDept.name] || 0}</p></div>
              </div>
              {detailDept.description && (
                <div><p className="text-sm text-muted-foreground mb-1">Description</p><p className="text-sm">{detailDept.description}</p></div>
              )}
              <Separator />
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2"><Users className="h-4 w-4" /> Team Members ({deptMembers.length})</h4>
                {deptMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No employees assigned to this department.</p>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {deptMembers.map(emp => (
                      <div key={emp.id} className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/50">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                            {emp.firstName?.[0]}{emp.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{emp.firstName} {emp.lastName}</p>
                          <p className="text-xs text-muted-foreground">{emp.designation || "—"}</p>
                        </div>
                        <Badge variant="outline" className="text-xs">{emp.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
