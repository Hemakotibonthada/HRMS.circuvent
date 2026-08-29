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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ShieldAlert, Plus, Search, AlertTriangle, Clock,
  Eye, FileText, Users, Calendar, MapPin, Target,
  CheckCircle2, AlertCircle, TrendingUp, BarChart3,
  Flame, HardHat, Activity, User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { type BaseRecord, useEmployeeStore, startSync } from "@/stores/unified-store";
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
  const { items } = store;
  const empStore = useEmployeeStore();
  const employees = empStore.items;

  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [tab, setTab] = useState("incidents");
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
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.initialized]);

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
    return Object.entries(map).map(([name, count]) => ({ name, count }));
  }, [items]);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.reportedBy.trim() || !form.date) {
      toast.error("Please fill in title, reporter name, and date");
      return;
    }
    const newDoc: Omit<IncidentDoc, "id"> = {
      ...form,
      status: "Reported",
      investigator: "",
      correctiveActions: "",
      rootCause: "",
      resolvedDate: "",
    };
    try {
      const id = await genericService(COLLECTIONS.incidents).create(newDoc as unknown as Record<string, unknown>);
      store.addItem({ ...newDoc, id } as IncidentDoc);
      toast.success("Incident ticket logged successfully");
      setCreateOpen(false);
      setForm({
        title: "", description: "", type: "Slip/Fall", severity: "Minor",
        location: "Office Floor 1", reportedBy: "", date: new Date().toISOString().slice(0, 10), time: "10:00",
        witnesses: "",
      });
    } catch {
      toast.error("Failed to report incident");
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      await genericService(COLLECTIONS.incidents).update(id, { status: newStatus });
      store.updateItem(id, { status: newStatus });
      if (viewIncident && viewIncident.id === id) {
        setViewIncident({ ...viewIncident, status: newStatus });
      }
      toast.success(`Status updated to ${newStatus}`);
    } catch {
      toast.error("Failed to update status");
    }
  };

  if (store.loading && !store.initialized) return <div className="p-6"><DataLoadingSkeleton rows={6} /></div>;

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Incident &amp; Grievance Center</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Workplace safety, risk mitigation, and compliance grievance management</p>
        </div>
        <Button
          onClick={() => {
            setForm(f => ({ ...f, date: f.date || new Date().toISOString().slice(0, 10), time: f.time || "10:00" }));
            setCreateOpen(true);
          }}
          className="bg-gradient-to-r from-red-500 to-rose-600 text-white border-0 shadow-md gap-2 rounded-full h-9 px-4 hover:opacity-95"
        >
          <ShieldAlert className="h-4 w-4" /> Report Incident
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Reported", value: items.length, icon: FileText, color: "from-blue-500 to-cyan-500", sub: "All time records" },
          { label: "Open Investigations", value: openCount, icon: AlertTriangle, color: "from-amber-500 to-orange-500", sub: "Requires attention" },
          { label: "Critical Priority", value: criticalCount, icon: AlertCircle, color: "from-red-500 to-rose-600", sub: "Urgent response" },
          { label: "Resolved & Closed", value: resolvedCount, icon: CheckCircle2, color: "from-emerald-500 to-green-600", sub: "Actioned cases" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={cn("p-3 rounded-xl bg-gradient-to-r text-white", kpi.color)}>
                <kpi.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-2xl font-bold">{kpi.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{kpi.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="incidents">Incident Log</TabsTrigger>
          <TabsTrigger value="analytics">Severity &amp; Analytics</TabsTrigger>
        </TabsList>

        {/* Incidents List */}
        <TabsContent value="incidents" className="space-y-4 mt-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search incidents by summary, location, reporter, or category..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 text-xs h-9"
              />
            </div>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-36 h-9 text-xs"><SelectValue placeholder="All Severity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Severities</SelectItem>
                {SEVERITY_LEVELS.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {items.length === 0 && store.initialized ? (
            <DataEmptyState {...EMPTY_STATES.incidents} onAction={() => setCreateOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching incident logs found.</p>
          ) : (
            <div className="space-y-2.5">
              {filtered.map(inc => (
                <Card key={inc.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className={cn("p-2.5 rounded-xl bg-red-100 dark:bg-red-950/30 text-red-600 shrink-0")}>
                        <ShieldAlert className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{inc.title}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                          <span>{inc.type}</span>
                          <span>&middot;</span>
                          <span>{inc.location}</span>
                          <span>&middot;</span>
                          <span>{inc.date}</span>
                          <span>&middot;</span>
                          <span>By {inc.reportedBy}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className={cn("text-xs font-medium", SEVERITY_COLORS[inc.severity] || "bg-muted text-muted-foreground")}>{inc.severity}</Badge>
                      <Badge className={cn("text-xs", STATUS_CONF[inc.status]?.className || "bg-muted")}>{inc.status}</Badge>
                      <Button variant="outline" size="sm" className="rounded-full text-xs h-8 px-3" onClick={() => setViewIncident(inc)}>
                        <Eye className="h-3.5 w-3.5 mr-1" /> View
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm font-semibold">Incidents by Severity</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={severityPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                      {severityPieData.map((_, i) => <Cell key={i} fill={["#22c55e", "#eab308", "#f97316", "#ef4444"][i % 4]} />)}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm font-semibold">Incidents by Category</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={typeBarData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <RTooltip />
                    <Bar dataKey="count" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ENHANCED REPORT INCIDENT DIALOG */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-md">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Report Workplace Incident</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  File an official safety, security, or grievance report for investigation.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Incident Title &amp; Summary <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. Server room coolant leak, Slip near cafeteria"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="h-9 text-xs"
                required
              />
            </div>

            {/* Severity Pill Selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Severity &amp; Impact Level</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {SEVERITY_LEVELS.map(sev => {
                  const active = form.severity === sev;
                  return (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, severity: sev }))}
                      className={cn(
                        "p-2 rounded-lg border text-center transition-all",
                        active
                          ? "bg-red-50 dark:bg-red-950/40 border-red-500 text-red-700 dark:text-red-300 shadow-xs font-bold"
                          : "bg-background hover:bg-muted/50 text-muted-foreground border-border"
                      )}
                    >
                      <span className="text-xs">{sev}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Type & Location */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Incident Type</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Incident Location</Label>
                <Select value={form.location} onValueChange={v => setForm(f => ({ ...f, location: v }))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LOCATIONS.map(l => <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Reported By & Witnesses */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-red-500" />
                  Reported By <span className="text-destructive">*</span>
                </Label>
                {employees && employees.length > 0 ? (
                  <Select value={form.reportedBy} onValueChange={v => setForm(f => ({ ...f, reportedBy: v }))}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select reporter..." />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map(emp => {
                        const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ") || String(emp.id);
                        const sub = [emp.designation, emp.department].filter(Boolean).join(" · ");
                        return (
                          <SelectItem key={emp.id} value={name} className="text-xs">
                            <span className="font-medium">{name}</span>
                            {sub ? <span className="text-muted-foreground ml-2 text-[11px]">({sub})</span> : null}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="Reporter name"
                    value={form.reportedBy}
                    onChange={e => setForm(f => ({ ...f, reportedBy: e.target.value }))}
                    className="h-9 text-xs"
                    required
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Witnesses (if any)</Label>
                <Input
                  placeholder="e.g. Ramesh K., Ananya P."
                  value={form.witnesses}
                  onChange={e => setForm(f => ({ ...f, witnesses: e.target.value }))}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Date & Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  Date of Occurrence <span className="text-destructive">*</span>
                </Label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="h-9 text-xs" required />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  Approximate Time
                </Label>
                <Input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} className="h-9 text-xs" />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Detailed Description &amp; Events</Label>
              <Textarea
                placeholder="Describe what occurred, any hazards identified, immediate containment actions taken..."
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                className="text-xs resize-none"
              />
            </div>
          </div>

          <DialogFooter className="pt-2 gap-2">
            <Button variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all" onClick={handleCreate}>
              <ShieldAlert className="h-4 w-4 mr-1.5" /> Submit Incident Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ENHANCED INCIDENT DETAIL DIALOG */}
      <Dialog open={!!viewIncident} onOpenChange={() => setViewIncident(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-md">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Incident #{viewIncident?.id?.slice(0, 8)}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {viewIncident?.title}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {viewIncident && (
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="p-2.5 rounded-lg border bg-background">
                  <p className="text-muted-foreground">Severity</p>
                  <Badge className={cn("mt-1 text-[11px]", SEVERITY_COLORS[viewIncident.severity])}>{viewIncident.severity}</Badge>
                </div>
                <div className="p-2.5 rounded-lg border bg-background">
                  <p className="text-muted-foreground">Status</p>
                  <Badge className={cn("mt-1 text-[11px]", STATUS_CONF[viewIncident.status]?.className)}>{viewIncident.status}</Badge>
                </div>
                <div className="p-2.5 rounded-lg border bg-background">
                  <p className="text-muted-foreground">Category</p>
                  <p className="font-semibold text-foreground mt-1">{viewIncident.type}</p>
                </div>
                <div className="p-2.5 rounded-lg border bg-background">
                  <p className="text-muted-foreground">Location</p>
                  <p className="font-semibold text-foreground mt-1">{viewIncident.location}</p>
                </div>
                <div className="p-2.5 rounded-lg border bg-background">
                  <p className="text-muted-foreground">Reported By</p>
                  <p className="font-semibold text-foreground mt-1">{viewIncident.reportedBy}</p>
                </div>
                <div className="p-2.5 rounded-lg border bg-background">
                  <p className="text-muted-foreground">Date / Time</p>
                  <p className="font-semibold text-foreground mt-1">{viewIncident.date} {viewIncident.time}</p>
                </div>
              </div>

              {viewIncident.description && (
                <div className="p-3 rounded-lg border bg-muted/20">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Description &amp; Incident Notes</p>
                  <p className="text-xs text-foreground leading-relaxed">{viewIncident.description}</p>
                </div>
              )}

              {viewIncident.witnesses && (
                <div className="p-3 rounded-lg border bg-muted/20">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Witnesses</p>
                  <p className="text-xs text-foreground">{viewIncident.witnesses}</p>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs font-semibold text-muted-foreground">Update Case Status:</span>
                <div className="flex gap-1.5">
                  {["Investigating", "Action Required", "Resolved", "Closed"].map(st => (
                    <Button
                      key={st}
                      variant="outline"
                      size="sm"
                      onClick={() => handleStatusChange(viewIncident.id, st)}
                      className={cn("rounded-full text-[11px] h-7 px-3", viewIncident.status === st ? "bg-red-600 text-white border-red-600" : "")}
                    >
                      {st}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setViewIncident(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
