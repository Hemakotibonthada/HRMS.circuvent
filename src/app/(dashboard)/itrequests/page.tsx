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
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Monitor, Plus, Search, CheckCircle2, Clock, AlertTriangle,
  Wifi, Mail, HardDrive, Key, Shield, Laptop, Server,
  ThumbsUp, ThumbsDown, Eye, Headphones, Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, Tooltip as RTooltip,
} from "recharts";
import { useTicketStore, startSync, type TicketDoc } from "@/stores/unified-store";
import { COLLECTIONS, genericService } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// IT REQUESTS — IT service request portal with approval workflow
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const IT_CATEGORIES = ["Hardware", "Software", "Access", "Network", "Email"];
const PRIORITIES = ["Low", "Medium", "High", "Critical"];
const CAT_ICONS: Record<string, typeof Monitor> = {
  Hardware: Laptop, Software: HardDrive, Access: Key, Network: Wifi, Email: Mail,
};
const PRIORITY_COLORS: Record<string, string> = {
  Low: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400",
  Medium: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  High: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};
const STATUS_MAP: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "status-pending" },
  "in-progress": { label: "In Progress", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  resolved: { label: "Resolved", className: "status-active" },
  closed: { label: "Closed", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
  rejected: { label: "Rejected", className: "status-rejected" },
};

export default function ITRequestsPage() {
  const store = useTicketStore();
  const { items: allTickets, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("requests");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<TicketDoc | null>(null);
  const [form, setForm] = useState({
    title: "", description: "", category: "", priority: "Medium", reporterName: "",
  });

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.helpdesk, store); }, [initialized, store]);

  // Filter to IT category tickets only
  const tickets = useMemo(() =>
    allTickets.filter(t => IT_CATEGORIES.includes(t.category)),
  [allTickets]);

  // KPIs
  const openCount = tickets.filter(t => t.status === "open").length;
  const inProgressCount = tickets.filter(t => t.status === "in-progress").length;
  const resolvedCount = tickets.filter(t => t.status === "resolved" || t.status === "closed").length;
  const slaCompliance = tickets.length > 0
    ? Math.round((resolvedCount / tickets.length) * 100) : 100;

  const filtered = useMemo(() => {
    let result = tickets;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(t =>
        t.title?.toLowerCase().includes(q) ||
        t.reporterName?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q)
      );
    }
    if (catFilter !== "all") result = result.filter(t => t.category === catFilter);
    if (statusFilter !== "all") result = result.filter(t => t.status === statusFilter);
    return result;
  }, [tickets, search, catFilter, statusFilter]);

  // Category breakdown
  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    tickets.forEach(t => { counts[t.category || "Other"] = (counts[t.category || "Other"] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [tickets]);

  // Priority breakdown
  const priorityData = useMemo(() => {
    const counts: Record<string, number> = {};
    tickets.forEach(t => { counts[t.priority || "Medium"] = (counts[t.priority || "Medium"] || 0) + 1; });
    return PRIORITIES.map(p => ({ name: p, value: counts[p] || 0 }));
  }, [tickets]);

  const handleCreate = async () => {
    if (!form.title || !form.category || !form.reporterName) {
      toast.error("Please fill required fields"); return;
    }
    try {
      await genericService(COLLECTIONS.helpdesk).create({
        ...form,
        status: "open",
        assigneeName: "",
        createdAt: new Date().toISOString(),
      });
      toast.success("IT request submitted!");
      setCreateOpen(false);
      setForm({ title: "", description: "", category: "", priority: "Medium", reporterName: "" });
    } catch { toast.error("Failed to submit request"); }
  };

  const handleAction = async (id: string, action: string) => {
    try {
      await genericService(COLLECTIONS.helpdesk).update(id, { status: action });
      toast.success(`Request ${action === "in-progress" ? "picked up" : action}`);
      if (detailItem?.id === id) setDetailItem(null);
    } catch { toast.error("Failed to update request"); }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && tickets.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.helpdesk} onAction={() => setCreateOpen(true)} />;
  }

  const kpis = [
    { label: "Open", value: openCount, icon: AlertTriangle, gradient: "from-amber-500 to-orange-500" },
    { label: "In Progress", value: inProgressCount, icon: Clock, gradient: "from-blue-500 to-cyan-500" },
    { label: "Resolved", value: resolvedCount, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "SLA Compliance", value: `${slaCompliance}%`, icon: Shield, gradient: "from-violet-500 to-purple-600" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">IT Requests</h1>
          <p className="text-muted-foreground mt-1">Submit and track IT service requests</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New Request
        </Button>
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

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search requests..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {IT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in-progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requests">My Requests</TabsTrigger>
          <TabsTrigger value="fulfillment">Fulfillment</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="space-y-3 mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.helpdesk} compact onAction={() => setCreateOpen(true)} />
          ) : filtered.map(ticket => {
            const st = STATUS_MAP[ticket.status] || STATUS_MAP.open;
            const CatIcon = CAT_ICONS[ticket.category] || Monitor;
            return (
              <Card key={ticket.id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setDetailItem(ticket)}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                        <CatIcon className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{ticket.title}</h3>
                          <Badge className={PRIORITY_COLORS[ticket.priority] || PRIORITY_COLORS.Medium}>{ticket.priority}</Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>{ticket.reporterName}</span>
                          <span>{ticket.category}</span>
                          <span>{ticket.createdAt?.split("T")[0]}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className={st.className}>{st.label}</Badge>
                      {ticket.status === "open" && (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="text-xs text-blue-600" onClick={e => { e.stopPropagation(); handleAction(ticket.id, "in-progress"); }}>Pick Up</Button>
                          <Button variant="ghost" size="sm" className="text-xs text-red-600" onClick={e => { e.stopPropagation(); handleAction(ticket.id, "rejected"); }}>Reject</Button>
                        </div>
                      )}
                      {ticket.status === "in-progress" && (
                        <Button variant="ghost" size="sm" className="text-xs text-emerald-600" onClick={e => { e.stopPropagation(); handleAction(ticket.id, "resolved"); }}>Resolve</Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="fulfillment" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Fulfillment Tracking</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {IT_CATEGORIES.map(cat => {
                  const catTickets = tickets.filter(t => t.category === cat);
                  const resolved = catTickets.filter(t => t.status === "resolved" || t.status === "closed").length;
                  const percent = catTickets.length > 0 ? Math.round((resolved / catTickets.length) * 100) : 0;
                  const CatIcon = CAT_ICONS[cat] || Monitor;
                  return (
                    <div key={cat} className="flex items-center gap-4">
                      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                        <CatIcon className="h-4 w-4 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium">{cat}</span>
                          <span className="text-muted-foreground">{resolved}/{catTickets.length} resolved</span>
                        </div>
                        <Progress value={percent} className="h-2" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Requests by Category</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                      {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Priority Distribution</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={priorityData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="value" name="Tickets" fill="#8b5cf6" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={!!detailItem} onOpenChange={v => { if (!v) setDetailItem(null); }}>
        <DialogContent>
          {detailItem && (
            <>
              <DialogHeader><DialogTitle>{detailItem.title}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge className={(STATUS_MAP[detailItem.status] || STATUS_MAP.open).className}>{(STATUS_MAP[detailItem.status] || STATUS_MAP.open).label}</Badge>
                  <Badge className={PRIORITY_COLORS[detailItem.priority] || PRIORITY_COLORS.Medium}>{detailItem.priority}</Badge>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Reported By</p><p className="font-medium">{detailItem.reporterName}</p></div>
                  <div><p className="text-muted-foreground">Category</p><p className="font-medium">{detailItem.category}</p></div>
                  <div><p className="text-muted-foreground">Assigned To</p><p className="font-medium">{detailItem.assigneeName || "Unassigned"}</p></div>
                  <div><p className="text-muted-foreground">Created</p><p className="font-medium">{detailItem.createdAt?.split("T")[0]}</p></div>
                </div>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Description</p>
                  <p className="text-sm">{detailItem.description || "No description"}</p>
                </div>
              </div>
              <DialogFooter className="gap-2">
                {detailItem.status === "open" && (
                  <>
                    <Button variant="outline" className="text-red-600" onClick={() => handleAction(detailItem.id, "rejected")}>Reject</Button>
                    <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-0" onClick={() => handleAction(detailItem.id, "in-progress")}>Pick Up</Button>
                  </>
                )}
                {detailItem.status === "in-progress" && (
                  <Button className="bg-gradient-to-r from-emerald-500 to-green-600 text-white border-0" onClick={() => handleAction(detailItem.id, "resolved")}>Resolve</Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Request Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New IT Request</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Brief description of the issue" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category *</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {IT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Your Name *</Label>
              <Input value={form.reporterName} onChange={e => setForm(f => ({ ...f, reporterName: e.target.value }))} placeholder="Your name" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the issue in detail..." rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" /> Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
