"use client";

import { useState, useEffect, useMemo } from "react";
import { addDaysToKey, dateKeyInZone } from "@/lib/date-keys";
import { create } from "zustand";
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
import { Switch } from "@/components/ui/switch";
import {
  Scale, Plus, Search, AlertTriangle, Clock, Shield,
  Eye, FileText, Users, Calendar, MessageSquare, Target,
  ChevronRight, CheckCircle2, XCircle, AlertCircle,
  TrendingUp, BarChart3, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { type BaseRecord } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, PieChart, Pie, Cell, Legend,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// GRIEVANCES — Employee grievance filing, investigation,
// resolution tracking, and SLA monitoring
// ═══════════════════════════════════════════════════════════════

interface GrievanceDoc extends BaseRecord {
  title: string; description: string; category: string;
  filedBy: string; filedByDept: string; severity: string;
  status: string; assignedTo: string; filedDate: string;
  resolvedDate: string; resolution: string; confidential: boolean;
  slaDeadline: string;
}

interface GrievanceStore {
  items: GrievanceDoc[];
  loading: boolean;
  initialized: boolean;
  error: string | null;
  setItems: (items: GrievanceDoc[]) => void;
  addItem: (item: GrievanceDoc) => void;
  updateItem: (id: string, updates: Partial<GrievanceDoc>) => void;
  removeItem: (id: string) => void;
  setLoading: (v: boolean) => void;
  setInitialized: (v: boolean) => void;
  setError: (e: string | null) => void;
}

const useGrievanceStore = create<GrievanceStore>((set) => ({
  items: [], loading: false, initialized: false, error: null,
  setItems: (items) => set({ items, loading: false, initialized: true }),
  addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
  updateItem: (id, updates) => set((s) => ({ items: s.items.map(i => i.id === id ? { ...i, ...updates } : i) })),
  removeItem: (id) => set((s) => ({ items: s.items.filter(i => i.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setInitialized: (initialized) => set({ initialized }),
  setError: (error) => set({ error }),
}));

const CATEGORIES = ["Harassment", "Discrimination", "Work Conditions", "Pay Dispute", "Manager Conflict", "Safety Concern", "Policy Violation"];
const SEVERITY_LEVELS = ["Low", "Medium", "High", "Critical"];
const STATUS_FLOW = ["Filed", "Investigation", "Hearing", "Resolution", "Closed"];
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  Filed: { label: "Filed", className: "status-pending" },
  Investigation: { label: "Investigation", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  Hearing: { label: "Hearing", className: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" },
  Resolution: { label: "Resolution", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  Closed: { label: "Closed", className: "status-active" },
};
const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#6366f1"];

export default function GrievancesPage() {
  const store = useGrievanceStore();
  const { items, loading, initialized } = store;

  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewGrievance, setViewGrievance] = useState<GrievanceDoc | null>(null);
  const [form, setForm] = useState({
    title: "", description: "", category: "Work Conditions", filedBy: "",
    filedByDept: "", severity: "Medium", confidential: false,
  });

  useEffect(() => {
    if (!store.initialized) {
      store.setLoading(true);
      genericService(COLLECTIONS.grievances).getAll().then(data => {
        store.setItems(data as unknown as GrievanceDoc[]);
      }).catch(() => { store.setItems([]); });
    }
  }, [store]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(g =>
        g.title?.toLowerCase().includes(q) || g.filedBy?.toLowerCase().includes(q) ||
        g.description?.toLowerCase().includes(q) || g.category?.toLowerCase().includes(q)
      );
    }
    if (catFilter !== "all") result = result.filter(g => g.category === catFilter);
    if (statusFilter !== "all") result = result.filter(g => g.status === statusFilter);
    return result;
  }, [items, search, catFilter, statusFilter]);

  const activeCount = items.filter(g => g.status !== "Closed").length;
  const resolvedCount = items.filter(g => g.status === "Closed").length;
  const avgResolution = useMemo(() => {
    const resolved = items.filter(g => g.filedDate && g.resolvedDate);
    if (resolved.length === 0) return 0;
    const total = resolved.reduce((s, g) => {
      return s + Math.ceil((new Date(g.resolvedDate).getTime() - new Date(g.filedDate).getTime()) / (1000 * 60 * 60 * 24));
    }, 0);
    return Math.round(total / resolved.length);
  }, [items]);
  const criticalCount = items.filter(g => g.severity === "Critical" && g.status !== "Closed").length;

  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach(g => { const c = g.category || "Other"; map[c] = (map[c] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [items]);

  const statusData = useMemo(() =>
    STATUS_FLOW.map(s => ({ name: s, count: items.filter(g => g.status === s).length })),
  [items]);

  const getSlaStatus = (g: GrievanceDoc) => {
    if (g.status === "Closed") return "met";
    if (!g.slaDeadline) return "unknown";
    return new Date(g.slaDeadline) < new Date() ? "breached" : "on-track";
  };

  const resetForm = () => setForm({ title: "", description: "", category: "Work Conditions", filedBy: "", filedByDept: "", severity: "Medium", confidential: false });

  const handleCreate = async () => {
    if (!form.title || !form.filedBy) { toast.error("Title and filed by are required"); return; }
    try {
      const now = new Date();
      // 14 days from today's *calendar* date in the org's zone. Adding to the
      // key rather than to a Date keeps the deadline on the day a person
      // would count to, and cannot be shifted by a UTC render.
      const filedDate = dateKeyInZone(now);
      await genericService(COLLECTIONS.grievances).create({
        ...form,
        status: "Filed",
        assignedTo: "",
        filedDate,
        resolvedDate: "",
        resolution: "",
        slaDeadline: addDaysToKey(filedDate, 14),
      });
      toast.success("Grievance filed successfully");
      setCreateOpen(false); resetForm();
    } catch { toast.error("Failed to file grievance"); }
  };

  const handleStatusUpdate = async (g: GrievanceDoc, newStatus: string) => {
    try {
      const updates: Partial<GrievanceDoc> = { status: newStatus };
      if (newStatus === "Closed") updates.resolvedDate = dateKeyInZone(new Date());
      await genericService(COLLECTIONS.grievances).update(g.id, updates as Record<string, unknown>);
      store.updateItem(g.id, updates);
      toast.success(`Status updated to ${newStatus}`);
    } catch { toast.error("Failed to update status"); }
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Grievances</h1>
          <p className="text-muted-foreground mt-1">Employee grievance management and resolution tracking</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-lg gap-2" onClick={() => { resetForm(); setCreateOpen(true); }}>
          <Plus className="h-4 w-4" /> File Grievance
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 stagger-children">
        {[
          { label: "Total", value: items.length, icon: Scale, gradient: "from-violet-500 to-purple-600" },
          { label: "Active", value: activeCount, icon: AlertTriangle, gradient: "from-amber-500 to-orange-500" },
          { label: "Resolved", value: resolvedCount, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
          { label: "Critical", value: criticalCount, icon: AlertCircle, gradient: "from-red-500 to-orange-500" },
          { label: "Avg Days", value: avgResolution, icon: Clock, gradient: "from-blue-500 to-cyan-500" },
        ].map(kpi => (
          <Card key={kpi.label} className="animate-slide-up">
            <CardContent className="p-4 flex items-center gap-4">
              <div className={cn("h-11 w-11 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-md", kpi.gradient)}>
                <kpi.icon className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-xl font-bold">{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search grievances..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {STATUS_FLOW.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all" className="gap-2"><FileText className="h-4 w-4" /> All Cases</TabsTrigger>
          <TabsTrigger value="timeline" className="gap-2"><Clock className="h-4 w-4" /> Timeline</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2"><BarChart3 className="h-4 w-4" /> Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.grievances} onAction={() => setCreateOpen(true)} />
          ) : (
            <div className="space-y-3 stagger-children">
              {filtered.map(g => {
                const sla = getSlaStatus(g);
                return (
                  <Card key={g.id} className="animate-slide-up hover:shadow-md transition-shadow cursor-pointer" onClick={() => setViewGrievance(g)}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0 mt-1">
                          <Scale className="h-5 w-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {g.confidential && <Lock className="h-4 w-4 text-amber-500" />}
                            <h3 className="font-semibold">{g.title}</h3>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-1 mb-2">{g.description}</p>
                          <div className="flex items-center gap-3 flex-wrap">
                            <Badge className={cn("text-xs", STATUS_CONF[g.status]?.className || "status-pending")}>
                              {STATUS_CONF[g.status]?.label || g.status}
                            </Badge>
                            <Badge variant="outline" className="text-xs">{g.category}</Badge>
                            <Badge variant="outline" className={cn("text-xs", g.severity === "Critical" ? "border-red-500 text-red-600" : g.severity === "High" ? "border-amber-500 text-amber-600" : "")}>
                              {g.severity}
                            </Badge>
                            <Badge className={cn("text-xs", sla === "breached" ? "status-rejected" : sla === "on-track" ? "status-active" : "status-pending")}>
                              SLA: {sla === "breached" ? "Breached" : sla === "on-track" ? "On Track" : sla === "met" ? "Met" : "—"}
                            </Badge>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-medium">{g.filedBy}</p>
                          <p className="text-xs text-muted-foreground">{g.filedDate ? new Date(g.filedDate).toLocaleDateString() : "—"}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.grievances} onAction={() => setCreateOpen(true)} />
          ) : (
            <div className="space-y-4 stagger-children">
              {filtered.map(g => {
                const currentIdx = STATUS_FLOW.indexOf(g.status);
                return (
                  <Card key={g.id} className="animate-slide-up">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3 mb-4">
                        <Scale className="h-5 w-5 text-violet-500" />
                        <h3 className="font-semibold flex-1">{g.title}</h3>
                        <p className="text-sm text-muted-foreground">{g.filedBy}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        {STATUS_FLOW.map((step, i) => (
                          <div key={step} className="flex items-center flex-1">
                            <div className={cn(
                              "h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium border-2 flex-shrink-0",
                              i <= currentIdx ? "bg-gradient-to-br from-violet-500 to-purple-600 text-white border-violet-500" : "border-muted-foreground/30 text-muted-foreground"
                            )}>
                              {i < currentIdx ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                            </div>
                            {i < STATUS_FLOW.length - 1 && (
                              <div className={cn("h-0.5 flex-1 mx-1", i < currentIdx ? "bg-violet-500" : "bg-muted-foreground/20")} />
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between mt-2">
                        {STATUS_FLOW.map(step => (
                          <p key={step} className="text-[10px] text-muted-foreground text-center flex-1">{step}</p>
                        ))}
                      </div>
                      {g.status !== "Closed" && (
                        <div className="flex gap-2 mt-3 justify-end">
                          {currentIdx < STATUS_FLOW.length - 1 && (
                            <Button size="sm" variant="outline" className="gap-1" onClick={() => handleStatusUpdate(g, STATUS_FLOW[currentIdx + 1])}>
                              <ChevronRight className="h-3 w-3" /> Move to {STATUS_FLOW[currentIdx + 1]}
                            </Button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">By Category</CardTitle></CardHeader>
              <CardContent>
                {categoryData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={categoryData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name }) => name}>
                        {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Resolution Pipeline</CardTitle></CardHeader>
              <CardContent>
                {statusData.every(s => s.count === 0) ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={statusData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="name" fontSize={11} />
                      <YAxis fontSize={11} />
                      <RTooltip />
                      <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* File Grievance Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>File Grievance</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input placeholder="Brief summary" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea placeholder="Detailed description of the grievance..." value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={4} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SEVERITY_LEVELS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Filed By *</Label>
                <Input placeholder="Employee name" value={form.filedBy} onChange={e => setForm(f => ({ ...f, filedBy: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Input placeholder="Department" value={form.filedByDept} onChange={e => setForm(f => ({ ...f, filedByDept: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.confidential} onCheckedChange={v => setForm(f => ({ ...f, confidential: v }))} />
              <Label>Mark as Confidential</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>Submit Grievance</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Grievance Detail Dialog */}
      <Dialog open={!!viewGrievance} onOpenChange={() => setViewGrievance(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {viewGrievance?.confidential && <Lock className="h-4 w-4 text-amber-500" />}
              {viewGrievance?.title}
            </DialogTitle>
          </DialogHeader>
          {viewGrievance && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-sm text-muted-foreground">Status</p><Badge className={cn(STATUS_CONF[viewGrievance.status]?.className)}>{viewGrievance.status}</Badge></div>
                <div><p className="text-sm text-muted-foreground">Category</p><p className="font-medium">{viewGrievance.category}</p></div>
                <div><p className="text-sm text-muted-foreground">Severity</p><Badge variant="outline" className={cn(viewGrievance.severity === "Critical" ? "border-red-500 text-red-600" : "")}>{viewGrievance.severity}</Badge></div>
                <div><p className="text-sm text-muted-foreground">Filed By</p><p className="font-medium">{viewGrievance.filedBy}</p></div>
                <div><p className="text-sm text-muted-foreground">Filed Date</p><p className="font-medium">{viewGrievance.filedDate || "—"}</p></div>
                <div><p className="text-sm text-muted-foreground">SLA Deadline</p><p className="font-medium">{viewGrievance.slaDeadline || "—"}</p></div>
              </div>
              <Separator />
              <div><p className="text-sm text-muted-foreground mb-1">Description</p><p className="text-sm">{viewGrievance.description}</p></div>
              {viewGrievance.resolution && <div><p className="text-sm text-muted-foreground mb-1">Resolution</p><p className="text-sm">{viewGrievance.resolution}</p></div>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
