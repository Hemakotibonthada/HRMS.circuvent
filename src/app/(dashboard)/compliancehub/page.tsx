"use client";

import { useState, useEffect, useMemo } from "react";
import { create } from "zustand";
import { type BaseRecord } from "@/stores/unified-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Shield, Plus, Search, CheckCircle2, AlertTriangle, Clock, XCircle,
  FileText, Scale, HardHat, Lock, GraduationCap, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRBAC } from "@/hooks/use-rbac";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton } from "@/components/data-empty-state";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Cell } from "recharts";

// ─── Compliance Store ────────────────────────────────────────

interface ComplianceDoc extends BaseRecord {
  title: string;
  category: string;
  status: string;
  dueDate: string;
  description: string;
  assignee: string;
  priority: string;
  lastAuditDate: string;
}

const COLLECTION_NAME = "compliance";

const useComplianceStore = create<{
  items: ComplianceDoc[]; loading: boolean; initialized: boolean; error: string | null;
  setItems: (items: ComplianceDoc[]) => void; addItem: (item: ComplianceDoc) => void;
  updateItem: (id: string, u: Partial<ComplianceDoc>) => void; removeItem: (id: string) => void;
  setLoading: (v: boolean) => void; setInitialized: (v: boolean) => void; setError: (e: string | null) => void;
}>((set) => ({
  items: [], loading: false, initialized: false, error: null,
  setItems: (items) => set({ items, loading: false, initialized: true }),
  addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
  updateItem: (id, u) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...u } : i)) })),
  removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setInitialized: (initialized) => set({ initialized }),
  setError: (error) => set({ error }),
}));

// ─── Config Constants ────────────────────────────────────────

const COMPLIANCE_CATEGORIES = [
  { value: "statutory", label: "Statutory", icon: Scale, color: "text-blue-600" },
  { value: "tax", label: "Tax", icon: FileText, color: "text-green-600" },
  { value: "labor", label: "Labor", icon: Shield, color: "text-purple-600" },
  { value: "safety", label: "Safety", icon: HardHat, color: "text-orange-600" },
  { value: "data-privacy", label: "Data Privacy", icon: Lock, color: "text-red-600" },
  { value: "training", label: "Training", icon: GraduationCap, color: "text-teal-600" },
] as const;

const STATUS_COLORS: Record<string, string> = {
  compliant: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  overdue: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  "due-soon": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  "in-progress": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  "not-started": "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
};

const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const CHART_COLORS = ["#3b82f6", "#22c55e", "#a855f7", "#f97316", "#ef4444", "#14b8a6"];

export default function ComplianceHubPage() {
  const { user } = useAuth();
  const { isAdmin, isHR } = useRBAC();
  const store = useComplianceStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    if (!initialized) {
      store.setLoading(true);
      genericService(COLLECTION_NAME).getAll().then((data) => {
        store.setItems(data as unknown as ComplianceDoc[]);
      }).catch(() => store.setItems([]));
    }
    // `store` is deliberately not a dependency — it is the whole zustand state
    // object, so setLoading() above replaces it and listing it here re-triggers
    // this effect forever. `initialized` is the real guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (c) =>
        c.title?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q) ||
        c.assignee?.toLowerCase().includes(q)
    );
  }, [items, search]);

  // KPIs computed from store
  const totalItems = items.length;
  const compliant = items.filter((c) => c.status === "compliant").length;
  const overdue = items.filter((c) => c.status === "overdue").length;
  const dueSoon = items.filter((c) => c.status === "due-soon").length;
  const complianceRate = totalItems > 0 ? Math.round((compliant / totalItems) * 100) : 0;

  // Category breakdown for chart
  const categoryData = useMemo(() => {
    const map: Record<string, { total: number; compliant: number }> = {};
    items.forEach((c) => {
      const cat = c.category || "Other";
      if (!map[cat]) map[cat] = { total: 0, compliant: 0 };
      map[cat].total++;
      if (c.status === "compliant") map[cat].compliant++;
    });
    return Object.entries(map).map(([name, v]) => ({
      name,
      total: v.total,
      compliant: v.compliant,
      rate: v.total > 0 ? Math.round((v.compliant / v.total) * 100) : 0,
    }));
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      title: fd.get("title") as string,
      category: fd.get("category") as string,
      status: "not-started",
      dueDate: fd.get("dueDate") as string,
      description: fd.get("description") as string,
      assignee: user?.displayName || user?.email || "",
      priority: fd.get("priority") as string,
      lastAuditDate: "",
    };
    try {
      const id = await genericService(COLLECTION_NAME).create(data);
      store.addItem({ ...data, id });
      toast.success("Compliance item created!");
      setDialogOpen(false);
    } catch {
      toast.error("Failed to create compliance item");
    }
  };

  if (loading && !initialized) return <DataLoadingSkeleton rows={6} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Compliance Hub</h1>
          <p className="text-muted-foreground">Track regulatory and policy compliance across the organization</p>
        </div>
        {(isAdmin || isHR) && (
          <Button className="gap-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> Add Compliance Item
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Items", value: totalItems, icon: Shield, color: "text-blue-600", sub: `${complianceRate}% compliance rate` },
          { label: "Compliant", value: compliant, icon: CheckCircle2, color: "text-green-600", sub: "Items in compliance" },
          { label: "Overdue", value: overdue, icon: XCircle, color: "text-red-600", sub: "Requires immediate attention" },
          { label: "Due Soon", value: dueSoon, icon: Clock, color: "text-yellow-600", sub: "Upcoming deadlines" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
                  <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{kpi.sub}</p>
                </div>
                <div className={cn("h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center", kpi.color)}>
                  <kpi.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="items">All Items</TabsTrigger>
          <TabsTrigger value="chart">Category Breakdown</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Compliance by Category */}
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4" /> By Category</CardTitle></CardHeader>
              <CardContent>
                {categoryData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No compliance data yet</p>
                ) : (
                  <div className="space-y-3">
                    {COMPLIANCE_CATEGORIES.map((cat) => {
                      const data = categoryData.find((c) => c.name === cat.value);
                      return (
                        <div key={cat.value} className="flex items-center gap-3">
                          <cat.icon className={cn("h-4 w-4 shrink-0", cat.color)} />
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between text-sm">
                              <span>{cat.label}</span>
                              <span className="text-muted-foreground">{data?.compliant ?? 0}/{data?.total ?? 0}</span>
                            </div>
                            <Progress value={data?.rate ?? 0} className="h-1.5 mt-1" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Overall Compliance */}
            <Card>
              <CardHeader><CardTitle className="text-base">Overall Compliance</CardTitle></CardHeader>
              <CardContent className="flex flex-col items-center justify-center py-6">
                <div className="relative h-32 w-32">
                  <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/20" />
                    <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8"
                      strokeDasharray={`${complianceRate * 2.51} 251`}
                      className={complianceRate >= 80 ? "text-green-500" : complianceRate >= 50 ? "text-yellow-500" : "text-red-500"}
                      strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-bold">{complianceRate}%</span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-3">{compliant} of {totalItems} items compliant</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* All Items List */}
        <TabsContent value="items">
          <Card>
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <CardTitle className="text-base flex-1">Compliance Items</CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search items..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
              </div>
            </CardHeader>
            <CardContent>
              {filtered.length === 0 ? (
                <DataEmptyState icon={Shield} title="No compliance items" description="Add compliance tracking items to monitor regulatory requirements." actionLabel={isAdmin || isHR ? "Add Item" : undefined} onAction={isAdmin || isHR ? () => setDialogOpen(true) : undefined} compact />
              ) : (
                <div className="space-y-2">
                  {filtered.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                      <Shield className="h-5 w-5 text-blue-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {COMPLIANCE_CATEGORIES.find((cat) => cat.value === c.category)?.label || c.category} · Due {c.dueDate || "—"}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs capitalize">{c.priority}</Badge>
                      <Badge className={cn("text-xs", STATUS_COLORS[c.status] || STATUS_COLORS["not-started"])}>
                        {c.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Chart */}
        <TabsContent value="chart">
          <Card>
            <CardHeader><CardTitle className="text-base">Category Breakdown</CardTitle></CardHeader>
            <CardContent>
              {categoryData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">No data to display</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={categoryData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <RTooltip />
                    <Bar dataKey="total" name="Total" radius={[4, 4, 0, 0]}>
                      {categoryData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                    <Bar dataKey="compliant" name="Compliant" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Compliance Item</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" required placeholder="e.g. Annual safety audit" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select name="category" required>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {COMPLIANCE_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select name="priority" required>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dueDate">Due Date</Label>
              <Input id="dueDate" name="dueDate" type="date" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" rows={3} placeholder="Describe the compliance requirement..." />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
