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
  Headphones, Plus, Search, CheckCircle2, Clock, AlertTriangle,
  MessageSquare, ArrowUpRight, Filter, Users, Eye,
  Shield, Zap, Calendar, Tag, ChevronRight, XCircle,
  UserPlus, CornerDownRight, AlertOctagon, Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRBAC } from "@/hooks/use-rbac";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
  Tooltip as RTooltip,
} from "recharts";
import { useTicketStore, startSync, type TicketDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// HELPDESK — Ticket management, SLA tracking, conversations,
// assignment, escalation, and support analytics
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const TICKET_CATEGORIES = ["IT Support", "HR Query", "Payroll", "Access Request", "Hardware", "Software", "General", "Network"];
const PRIORITIES = ["low", "medium", "high", "critical"];
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "status-pending" },
  in_progress: { label: "In Progress", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  resolved: { label: "Resolved", className: "status-active" },
  closed: { label: "Closed", className: "status-inactive" },
  escalated: { label: "Escalated", className: "status-rejected" },
};
const PRIORITY_CONF: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  low: { label: "Low", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400", icon: ChevronRight },
  medium: { label: "Medium", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: AlertTriangle },
  high: { label: "High", className: "status-pending", icon: AlertTriangle },
  critical: { label: "Critical", className: "status-rejected", icon: AlertOctagon },
};
const SLA_CONF: Record<string, { label: string; className: string }> = {
  within: { label: "Within SLA", className: "status-active" },
  at_risk: { label: "At Risk", className: "status-pending" },
  breached: { label: "SLA Breached", className: "status-rejected" },
};

export default function HelpdeskPage() {
  const rbac = useRBAC();
  const store = useTicketStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<TicketDoc | null>(null);
  const [form, setForm] = useState({
    title: "", category: "", priority: "medium",
    description: "", reporterName: "",
  });

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.helpdesk, store); }, [initialized, store]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(t =>
        t.title?.toLowerCase().includes(q) ||
        t.reporterName?.toLowerCase().includes(q) ||
        t.category?.toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== "all") result = result.filter(t => t.category === categoryFilter);
    if (priorityFilter !== "all") result = result.filter(t => t.priority === priorityFilter);
    if (statusFilter !== "all") result = result.filter(t => t.status === statusFilter);
    // Tab-level filtering
    if (tab === "open") result = result.filter(t => t.status === "open" || t.status === "in_progress");
    if (tab === "my") result = result.filter(t => t.reporterName === "Current User");
    if (tab === "resolved") result = result.filter(t => t.status === "resolved" || t.status === "closed");
    return result;
  }, [items, search, categoryFilter, priorityFilter, statusFilter, tab]);

  const getSlaStatus = (ticket: TicketDoc): string => {
    if (ticket.status === "resolved" || ticket.status === "closed") return "within";
    if (ticket.priority === "critical") return "breached";
    if (ticket.priority === "high") return "at_risk";
    return "within";
  };

  // KPIs
  const totalTickets = items.length;
  const openCount = items.filter(t => t.status === "open").length;
  const inProgressCount = items.filter(t => t.status === "in_progress").length;
  /**
   * Reuses the same per-ticket SLA check as the badge shown on each row, so
   * the aggregate can never disagree with what clicking into a ticket shows.
   * This used to be `Math.floor(openCount * 0.15)` — a flat guess with no
   * relationship to any ticket's actual priority, age, or SLA deadline.
   */
  const breachedCount = items.filter(t => getSlaStatus(t) === "breached").length;
  /**
   * Only tickets carrying both ends of a real timestamp contribute. This
   * used to be the literal string "4.2h" whenever at least one ticket was
   * resolved — the same figure regardless of how long anything actually
   * took, which measures nothing. Nothing on this page currently stamps
   * `resolvedAt`, so this reads "N/A" until something does; that is the
   * honest state, not a bug to paper over with a plausible-looking number.
   */
  const resolvedDurationsMs = items
    .filter((t) => t.status === "resolved" && !!t.createdAt && !!t.resolvedAt)
    .map((t) => new Date(t.resolvedAt as string).getTime() - new Date(t.createdAt).getTime());
  const avgResolution = resolvedDurationsMs.length > 0
    ? `${(resolvedDurationsMs.reduce((a, b) => a + b, 0) / resolvedDurationsMs.length / 3_600_000).toFixed(1)}h`
    : "N/A";

  // Category distribution
  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(t => {
      counts[t.category || "Other"] = (counts[t.category || "Other"] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  // Priority distribution
  const priorityData = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(t => {
      const p = PRIORITY_CONF[t.priority]?.label || "Medium";
      counts[p] = (counts[p] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  // Tickets over time
  const ticketTrend = useMemo(() => {
    const byDate: Record<string, number> = {};
    items.forEach(t => {
      if (!t.createdAt) return;
      const d = new Date(t.createdAt);
      const key = d.toLocaleString("default", { month: "short", day: "numeric" });
      byDate[key] = (byDate[key] || 0) + 1;
    });
    return Object.entries(byDate).slice(-10).map(([name, value]) => ({ name, value }));
  }, [items]);

  const resetForm = () => setForm({ title: "", category: "", priority: "medium", description: "", reporterName: "" });

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
      toast.success("Ticket created successfully!");
      setCreateOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to create ticket");
    }
  };

  const handleStatusUpdate = async (id: string, status: string) => {
    try {
      await genericService(COLLECTIONS.helpdesk).update(id, { status });
      toast.success(`Ticket ${status.replace("_", " ")}`);
    } catch {
      toast.error("Failed to update ticket");
    }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && items.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.helpdesk} onAction={() => setCreateOpen(true)} />;
  }

  const kpis = [
    { label: "Total Tickets", value: totalTickets, icon: Headphones, gradient: "from-violet-500 to-purple-600" },
    { label: "Open", value: openCount, icon: AlertTriangle, gradient: "from-amber-500 to-orange-500" },
    { label: "In Progress", value: inProgressCount, icon: Clock, gradient: "from-blue-500 to-cyan-500" },
    { label: "SLA Breached", value: breachedCount, icon: AlertOctagon, gradient: "from-red-500 to-rose-600" },
    { label: "Avg Resolution", value: avgResolution, icon: Timer, gradient: "from-emerald-500 to-green-600" },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Helpdesk</h1>
          <p className="text-muted-foreground mt-1">Manage support tickets, SLAs, and resolutions</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Create Ticket
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {kpis.map((kpi) => (
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
          <Input placeholder="Search tickets..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {TICKET_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            {PRIORITIES.map(p => <SelectItem key={p} value={p}>{PRIORITY_CONF[p]?.label || p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {Object.entries(STATUS_CONF).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="my">My Tickets</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="space-y-3 mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.helpdesk} compact onAction={() => setCreateOpen(true)} />
          ) : (
            filtered.map((ticket) => {
              const st = STATUS_CONF[ticket.status] || STATUS_CONF.open;
              const pr = PRIORITY_CONF[ticket.priority] || PRIORITY_CONF.medium;
              const sla = SLA_CONF[getSlaStatus(ticket)] || SLA_CONF.within;
              return (
                <Card key={ticket.id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedTicket(ticket)}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center", ticket.priority === "critical" ? "bg-red-100 dark:bg-red-900/30" : "bg-violet-100 dark:bg-violet-900/30")}>
                          <pr.icon className={cn("h-5 w-5", ticket.priority === "critical" ? "text-red-600" : "text-violet-600")} />
                        </div>
                        <div>
                          <h3 className="font-semibold">{ticket.title}</h3>
                          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                            <span>{ticket.reporterName}</span>
                            <span className="flex items-center gap-1"><Tag className="h-3 w-3" />{ticket.category}</span>
                            {ticket.assigneeName && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{ticket.assigneeName}</span>}
                            {ticket.createdAt && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(ticket.createdAt).toLocaleDateString()}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={sla.className}>{sla.label}</Badge>
                        <Badge className={pr.className}>{pr.label}</Badge>
                        <Badge className={st.className}>{st.label}</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}

          {/* Charts at bottom of All tab */}
          {tab === "all" && items.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <Card className="border-0 shadow-sm">
                <CardHeader><CardTitle className="text-base">Tickets by Category</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label>
                        {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card className="border-0 shadow-sm">
                <CardHeader><CardTitle className="text-base">Ticket Trend</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={ticketTrend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <RTooltip />
                      <Area type="monotone" dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Ticket Detail Dialog */}
      <Dialog open={!!selectedTicket} onOpenChange={(v) => { if (!v) setSelectedTicket(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedTicket && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Headphones className="h-5 w-5" />
                  {selectedTicket.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge className={(STATUS_CONF[selectedTicket.status] || STATUS_CONF.open).className}>
                    {(STATUS_CONF[selectedTicket.status] || STATUS_CONF.open).label}
                  </Badge>
                  <Badge className={(PRIORITY_CONF[selectedTicket.priority] || PRIORITY_CONF.medium).className}>
                    {(PRIORITY_CONF[selectedTicket.priority] || PRIORITY_CONF.medium).label}
                  </Badge>
                  <Badge className={(SLA_CONF[getSlaStatus(selectedTicket)] || SLA_CONF.within).className}>
                    {(SLA_CONF[getSlaStatus(selectedTicket)] || SLA_CONF.within).label}
                  </Badge>
                  <Badge variant="outline">{selectedTicket.category}</Badge>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Reporter</p><p className="font-medium">{selectedTicket.reporterName}</p></div>
                  <div><p className="text-muted-foreground">Assignee</p><p className="font-medium">{selectedTicket.assigneeName || "Unassigned"}</p></div>
                  <div><p className="text-muted-foreground">Created</p><p className="font-medium">{selectedTicket.createdAt ? new Date(selectedTicket.createdAt).toLocaleString() : "N/A"}</p></div>
                  <div><p className="text-muted-foreground">Category</p><p className="font-medium">{selectedTicket.category}</p></div>
                </div>
                <Separator />
                <div>
                  <h4 className="font-semibold text-sm mb-2">Description</h4>
                  <p className="text-sm text-muted-foreground">{selectedTicket.description || "No description provided."}</p>
                </div>
                <Separator />
                <div>
                  <h4 className="font-semibold text-sm mb-2">Conversation</h4>
                  <div className="space-y-3 mb-3">
                    <div className="flex gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-[10px] bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                          {selectedTicket.reporterName?.split(" ").map(n => n[0]).join("").slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 p-2 rounded-lg bg-muted/30">
                        <p className="text-xs font-medium">{selectedTicket.reporterName}</p>
                        <p className="text-sm mt-1">{selectedTicket.description || "Issue reported."}</p>
                      </div>
                    </div>
                  </div>
                  {/*
                    A reply box used to sit here: typing a message and
                    pressing send just toasted "Reply sent!" and cleared the
                    field. Nothing was appended to the thread above, not even
                    in memory — the ticket schema has no field for a growing
                    conversation (only a single closing `resolution` note),
                    so there was nowhere for a reply to actually go. Left out
                    rather than faked until replies have somewhere to live.
                  */}
                </div>
              </div>
              <DialogFooter className="gap-2">
                {rbac.can("helpdesk.manage") && selectedTicket.status === "open" && (
                  <>
                    <Button variant="outline" onClick={() => handleStatusUpdate(selectedTicket.id, "in_progress")}>
                      <ArrowUpRight className="h-4 w-4 mr-1" /> Assign
                    </Button>
                    <Button variant="outline" className="text-red-600" onClick={() => handleStatusUpdate(selectedTicket.id, "escalated")}>
                      <Zap className="h-4 w-4 mr-1" /> Escalate
                    </Button>
                  </>
                )}
                {rbac.can("helpdesk.manage") && (selectedTicket.status === "open" || selectedTicket.status === "in_progress") && (
                  <Button className="bg-gradient-to-r from-emerald-500 to-green-600 text-white border-0" onClick={() => { handleStatusUpdate(selectedTicket.id, "resolved"); setSelectedTicket(null); }}>
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Resolve
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Ticket Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Create Ticket</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Brief description of the issue" />
            </div>
            <div className="space-y-2">
              <Label>Your Name *</Label>
              <Input value={form.reporterName} onChange={(e) => setForm(f => ({ ...f, reporterName: e.target.value }))} placeholder="Your name" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category *</Label>
                <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {TICKET_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => <SelectItem key={p} value={p}>{PRIORITY_CONF[p]?.label || p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe your issue in detail..." rows={4} />
            </div>
            {/*
              This dialog used to promise "Attach files after creating the
              ticket via the ticket detail view" — the detail view has no
              upload control and never has, so the note pointed people at a
              feature that does not exist. Dropped rather than left for
              someone to discover by looking for a button that isn't there.
            */}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" /> Create Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
