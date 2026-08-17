"use client";

import { useState, useEffect, useMemo } from "react";
import { create } from "zustand";
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
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ShieldAlert, Plus, Search, AlertTriangle, Clock,
  Eye, FileText, Users, Calendar, MapPin, Target,
  CheckCircle2, AlertCircle, TrendingUp, BarChart3,
  Flame, HardHat, Activity,
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
// INCIDENT REPORTING — Workplace safety, incident tracking,
// investigations, and corrective actions
// ═══════════════════════════════════════════════════════════════

interface IncidentDoc extends BaseRecord {
  title: string; description: string; type: string;
  severity: string; location: string; reportedBy: string;
  date: string; time: string; status: string;
  witnesses: string; investigator: string;
  correctiveActions: string; rootCause: string;
  resolvedDate: string;
}

interface IncidentStore {
  items: IncidentDoc[];
  loading: boolean;
  initialized: boolean;
  error: string | null;
  setItems: (items: IncidentDoc[]) => void;
  addItem: (item: IncidentDoc) => void;
  updateItem: (id: string, updates: Partial<IncidentDoc>) => void;
  removeItem: (id: string) => void;
  setLoading: (v: boolean) => void;
  setInitialized: (v: boolean) => void;
  setError: (e: string | null) => void;
}

const useIncidentStore = create<IncidentStore>((set) => ({
  items: [], loading: false, initialized: false, error: null,
  setItems: (items) => set({ items, loading: false, initialized: true }),
  addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
  updateItem: (id, updates) => set((s) => ({ items: s.items.map(i => i.id === id ? { ...i, ...updates } : i) })),
  removeItem: (id) => set((s) => ({ items: s.items.filter(i => i.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setInitialized: (initialized) => set({ initialized }),
  setError: (error) => set({ error }),
}));

const TYPES = ["Slip/Fall", "Equipment Failure", "Chemical Exposure", "Ergonomic", "Fire", "Electrical", "Vehicle", "Other"];
const SEVERITY_LEVELS = ["Minor", "Moderate", "Severe", "Critical"];
const STATUSES = ["Reported", "Under Investigation", "Action Required", "Resolved", "Closed"];
const LOCATIONS = ["Office Floor 1", "Office Floor 2", "Warehouse", "Parking Lot", "Factory", "Cafeteria", "Lab", "Outdoor Area"];
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  Reported: { label: "Reported", className: "status-pending" },
  "Under Investigation": { label: "Investigating", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  "Action Required": { label: "Action Required", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  Resolved: { label: "Resolved", className: "status-active" },
  Closed: { label: "Closed", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
};
const SEVERITY_COLORS: Record<string, string> = {
  Minor: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  Moderate: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Severe: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  Critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};
const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#6366f1","#14b8a6"];

export default function IncidentsPage() {
  const store = useIncidentStore();
  const { items, loading, initialized } = store;

  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [tab, setTab] = useState("reports");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewIncident, setViewIncident] = useState<IncidentDoc | null>(null);
  const [form, setForm] = useState({
    title: "", description: "", type: "Slip/Fall", severity: "Minor",
    location: "Office Floor 1", reportedBy: "", date: "", time: "",
    witnesses: "",
  });

  useEffect(() => {
    if (!store.initialized) {
      store.setLoading(true);
      genericService(COLLECTIONS.incidents).getAll().then(data => {
        store.setItems(data as unknown as IncidentDoc[]);
      }).catch(() => { store.setItems([]); });
    }
  }, [store]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(i =>
        i.title?.toLowerCase().includes(q) || i.reportedBy?.toLowerCase().includes(q) ||
        i.location?.toLowerCase().includes(q) || i.type?.toLowerCase().includes(q)
      );
    }
    if (severityFilter !== "all") result = result.filter(i => i.severity === severityFilter);
    return result;
  }, [items, search, severityFilter]);

  const openCount = items.filter(i => i.status !== "Resolved" && i.status !== "Closed").length;
  const criticalCount = items.filter(i => i.severity === "Critical" && i.status !== "Closed").length;
  const resolvedCount = items.filter(i => i.status === "Resolved" || i.status === "Closed").length;

  const severityPieData = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach(i => { const s = i.severity || "Minor"; map[s] = (map[s] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [items]);

  const typeBarData = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach(i => { const t = i.type || "Other"; map[t] = (map[t] || 0) + 1; });
    return Object.entries(map).map(([name, count]) => ({ name: name.substring(0, 12), count })).sort((a, b) => b.count - a.count);
  }, [items]);

  const monthlyData = useMemo(() => {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months.map((name, i) => ({
      name,
      count: items.filter(inc => {
        const d = inc.date ? new Date(inc.date) : null;
        return d && d.getMonth() === i;
      }).length,
    }));
  }, [items]);

  const correctiveActions = useMemo(() => [
    "Safety training refresher required",
    "Install additional safety signage",
    "Replace worn-out equipment",
    "Update safety protocols",
    "Conduct area safety audit",
  ], []);

  const resetForm = () => setForm({ title: "", description: "", type: "Slip/Fall", severity: "Minor", location: "Office Floor 1", reportedBy: "", date: "", time: "", witnesses: "" });

  const handleCreate = async () => {
    if (!form.title || !form.reportedBy || !form.date) { toast.error("Title, reporter, and date required"); return; }
    try {
      await genericService(COLLECTIONS.incidents).create({
        ...form, status: "Reported", investigator: "", correctiveActions: "",
        rootCause: "", resolvedDate: "",
      });
      toast.success("Incident reported!");
      setCreateOpen(false); resetForm();
    } catch { toast.error("Failed to report incident"); }
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Incidents</h1>
          <p className="text-muted-foreground mt-1">Workplace safety and incident management</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-lg gap-2" onClick={() => { resetForm(); setCreateOpen(true); }}>
          <Plus className="h-4 w-4" /> Report Incident
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        {[
          { label: "Total Incidents", value: items.length, icon: ShieldAlert, gradient: "from-violet-500 to-purple-600" },
          { label: "Open", value: openCount, icon: AlertTriangle, gradient: "from-amber-500 to-orange-500" },
          { label: "Critical", value: criticalCount, icon: Flame, gradient: "from-red-500 to-orange-500" },
          { label: "Resolved", value: resolvedCount, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
        ].map(kpi => (
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

      {/* Search + Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search incidents..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            {SEVERITY_LEVELS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="reports" className="gap-2"><FileText className="h-4 w-4" /> Reports</TabsTrigger>
          <TabsTrigger value="investigations" className="gap-2"><Eye className="h-4 w-4" /> Investigations</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2"><BarChart3 className="h-4 w-4" /> Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.incidents} onAction={() => setCreateOpen(true)} />
          ) : (
            <div className="space-y-3 stagger-children">
              {filtered.map(inc => (
                <Card key={inc.id} className="animate-slide-up hover:shadow-md transition-shadow cursor-pointer" onClick={() => setViewIncident(inc)}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-1",
                        inc.severity === "Critical" ? "bg-gradient-to-br from-red-500 to-orange-500" :
                        inc.severity === "Severe" ? "bg-gradient-to-br from-orange-500 to-amber-500" :
                        "bg-gradient-to-br from-violet-500 to-purple-600"
                      )}>
                        <ShieldAlert className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold mb-1">{inc.title}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-1 mb-2">{inc.description}</p>
                        <div className="flex items-center gap-3 flex-wrap">
                          <Badge className={cn("text-xs", STATUS_CONF[inc.status]?.className || "status-pending")}>
                            {STATUS_CONF[inc.status]?.label || inc.status}
                          </Badge>
                          <Badge className={cn("text-xs", SEVERITY_COLORS[inc.severity] || SEVERITY_COLORS.Minor)}>
                            {inc.severity}
                          </Badge>
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> {inc.location}</span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> {inc.date || "—"}</span>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground flex-shrink-0">{inc.reportedBy}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="investigations" className="mt-4">
          {filtered.filter(i => i.status === "Under Investigation" || i.status === "Action Required").length === 0 ? (
            <DataEmptyState icon={Eye} title="No active investigations" description="Incidents under investigation will appear here." />
          ) : (
            <div className="space-y-4 stagger-children">
              {filtered.filter(i => i.status === "Under Investigation" || i.status === "Action Required").map(inc => (
                <Card key={inc.id} className="animate-slide-up">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">{inc.title}</h3>
                      <Badge className={cn("text-xs", STATUS_CONF[inc.status]?.className)}>{inc.status}</Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div><p className="text-muted-foreground">Investigator</p><p className="font-medium">{inc.investigator || "Unassigned"}</p></div>
                      <div><p className="text-muted-foreground">Root Cause</p><p className="font-medium">{inc.rootCause || "Pending"}</p></div>
                      <div><p className="text-muted-foreground">Location</p><p className="font-medium">{inc.location}</p></div>
                    </div>
                    <Separator />
                    <div>
                      <p className="text-sm font-medium mb-2">Corrective Actions Checklist</p>
                      <div className="space-y-1">
                        {correctiveActions.map(action => (
                          <div key={action} className="flex items-center gap-2 py-1">
                            <Checkbox />
                            <span className="text-sm">{action}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">By Severity</CardTitle></CardHeader>
              <CardContent>
                {severityPieData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={severityPieData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name }) => name}>
                        {severityPieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">By Type</CardTitle></CardHeader>
              <CardContent>
                {typeBarData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={typeBarData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="name" fontSize={10} />
                      <YAxis fontSize={11} />
                      <RTooltip />
                      <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Monthly Trend</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis fontSize={11} />
                  <RTooltip />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Report Incident Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Report Incident</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input placeholder="Incident summary" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea placeholder="Detailed account of the incident..." value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
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
                <Label>Location</Label>
                <Select value={form.location} onValueChange={v => setForm(f => ({ ...f, location: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reported By *</Label>
                <Input placeholder="Your name" value={form.reportedBy} onChange={e => setForm(f => ({ ...f, reportedBy: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date *</Label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Time</Label>
                <Input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Witnesses</Label>
              <Input placeholder="Names of witnesses (comma separated)" value={form.witnesses} onChange={e => setForm(f => ({ ...f, witnesses: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>Report Incident</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Incident Detail Dialog */}
      <Dialog open={!!viewIncident} onOpenChange={() => setViewIncident(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{viewIncident?.title}</DialogTitle></DialogHeader>
          {viewIncident && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-sm text-muted-foreground">Type</p><p className="font-medium">{viewIncident.type}</p></div>
                <div><p className="text-sm text-muted-foreground">Severity</p><Badge className={cn("text-xs", SEVERITY_COLORS[viewIncident.severity])}>{viewIncident.severity}</Badge></div>
                <div><p className="text-sm text-muted-foreground">Status</p><Badge className={cn("text-xs", STATUS_CONF[viewIncident.status]?.className)}>{viewIncident.status}</Badge></div>
                <div><p className="text-sm text-muted-foreground">Location</p><p className="font-medium">{viewIncident.location}</p></div>
                <div><p className="text-sm text-muted-foreground">Reported By</p><p className="font-medium">{viewIncident.reportedBy}</p></div>
                <div><p className="text-sm text-muted-foreground">Date</p><p className="font-medium">{viewIncident.date} {viewIncident.time}</p></div>
              </div>
              <Separator />
              <div><p className="text-sm text-muted-foreground mb-1">Description</p><p className="text-sm">{viewIncident.description}</p></div>
              {viewIncident.witnesses && <div><p className="text-sm text-muted-foreground mb-1">Witnesses</p><p className="text-sm">{viewIncident.witnesses}</p></div>}
              {viewIncident.rootCause && <div><p className="text-sm text-muted-foreground mb-1">Root Cause</p><p className="text-sm">{viewIncident.rootCause}</p></div>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
