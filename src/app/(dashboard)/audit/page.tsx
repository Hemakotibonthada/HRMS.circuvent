"use client";

import { useState, useEffect, useMemo } from "react";
import { dateKeyInZone } from "@/lib/date-keys";
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
  Shield, Search, FileText, AlertTriangle, Eye,
  Clock, Calendar, Filter, Download, Activity,
  Lock, AlertCircle, CheckCircle2, Info, User,
  Database, TrendingUp, Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuditStore, startSync, type AuditDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, AreaChart, Area,
  PieChart, Pie, Cell, Legend, LineChart, Line,
  ComposedChart,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// AUDIT LOG — Activity tracking, security events, module/action
// breakdowns; all derived from real audit-log events
// ═══════════════════════════════════════════════════════════════

const SEVERITY_CONF: Record<string, { label: string; className: string; icon: typeof Info }> = {
  info: {
    label: "Info",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    icon: Info,
  },
  warning: { label: "Warning", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: AlertTriangle },
  critical: { label: "Critical", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: AlertCircle },
  success: { label: "Success", className: "status-active", icon: CheckCircle2 },
};
const MODULES = ["Employees", "Payroll", "Leave", "Attendance", "Recruitment", "Assets", "Settings", "Auth", "Documents"];
const ACTIONS = ["create", "update", "delete", "login", "logout", "export", "import", "approve", "reject"];
const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#6366f1","#14b8a6"];

export default function AuditPage() {
  const store = useAuditStore();
  const { items, loading, initialized } = store;

  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [tab, setTab] = useState("activity");
  const [viewEvent, setViewEvent] = useState<AuditDoc | null>(null);

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.auditLog, store); }, [initialized, store]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.userName?.toLowerCase().includes(q) || a.action?.toLowerCase().includes(q) ||
        a.module?.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q)
      );
    }
    if (moduleFilter !== "all") result = result.filter(a => a.module === moduleFilter);
    if (severityFilter !== "all") result = result.filter(a => a.severity === severityFilter);
    return result;
  }, [items, search, moduleFilter, severityFilter]);

  const securityEvents = useMemo(() =>
    items.filter(a => a.severity === "critical" || a.severity === "warning" || a.module === "Auth"),
  [items]);

  const todayCount = useMemo(() => {
    const today = new Date().toDateString();
    return items.filter(a => {
      const d = a.timestamp ? new Date(a.timestamp) : null;
      return d && d.toDateString() === today;
    }).length;
  }, [items]);

  const criticalCount = items.filter(a => a.severity === "critical").length;

  const timelineData = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach(a => {
      if (!a.timestamp) return;
      const d = new Date(a.timestamp);
      const key = dateKeyInZone(d);
      map[key] = (map[key] || 0) + 1;
    });
    return Object.entries(map).sort().slice(-14).map(([date, count]) => ({
      date: date.substring(5),
      count,
    }));
  }, [items]);

  const moduleDistribution = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach(a => { const m = a.module || "Other"; map[m] = (map[m] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [items]);

  // Severity over time — stacked area
  const severityTimeline = useMemo(() => {
    const byDate: Record<string, { info: number; warning: number; critical: number }> = {};
    items.forEach(a => {
      if (!a.timestamp) return;
      const d = dateKeyInZone(new Date(a.timestamp)).substring(5);
      if (!byDate[d]) byDate[d] = { info: 0, warning: 0, critical: 0 };
      const sev = (a.severity || "info") as "info" | "warning" | "critical";
      if (sev in byDate[d]) byDate[d][sev]++;
    });
    return Object.entries(byDate).sort().slice(-14).map(([date, v]) => ({ date, ...v }));
  }, [items]);

  // Action type breakdown — for composed chart
  const actionBreakdown = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    items.forEach(a => {
      const mod = a.module || "Other";
      const act = a.action || "other";
      if (!map[mod]) map[mod] = {};
      map[mod][act] = (map[mod][act] || 0) + 1;
    });
    return Object.entries(map).slice(0, 8).map(([name, acts]) => ({
      name,
      create: acts.create || 0,
      update: acts.update || 0,
      delete: acts.delete || 0,
      total: Object.values(acts).reduce((s, v) => s + v, 0),
    }));
  }, [items]);

  const severityDistribution = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach(a => { const s = a.severity || "info"; map[s] = (map[s] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({
      name: SEVERITY_CONF[name]?.label || name, value,
    }));
  }, [items]);

  const handleExport = () => {
    const csv = ["Timestamp,User,Action,Module,Description,Severity"]
      .concat(filtered.map(a => `"${a.timestamp}","${a.userName}","${a.action}","${a.module}","${a.description}","${a.severity}"`))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-log-${dateKeyInZone(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Audit log exported!");
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-muted-foreground mt-1">System activity tracking and compliance monitoring</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-lg gap-2" onClick={handleExport}>
          <Download className="h-4 w-4" /> Export Log
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        {[
          { label: "Total Events", value: items.length, icon: Activity, gradient: "from-violet-500 to-purple-600" },
          { label: "Critical", value: criticalCount, icon: AlertCircle, gradient: "from-red-500 to-orange-500" },
          { label: "Today", value: todayCount, icon: Clock, gradient: "from-blue-500 to-cyan-500" },
          { label: "Security Events", value: securityEvents.length, icon: Shield, gradient: "from-amber-500 to-orange-500" },
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
          <Input placeholder="Search audit log..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={moduleFilter} onValueChange={setModuleFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Module" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Modules</SelectItem>
            {MODULES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            {Object.entries(SEVERITY_CONF).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="activity" className="gap-2"><Activity className="h-4 w-4" /> Activity Log</TabsTrigger>
          <TabsTrigger value="security" className="gap-2"><Lock className="h-4 w-4" /> Security</TabsTrigger>
          <TabsTrigger value="compliance" className="gap-2"><Shield className="h-4 w-4" /> Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.audit} />
          ) : (
            <div className="space-y-2 stagger-children">
              {filtered.slice(0, 50).map(event => {
                const sev = SEVERITY_CONF[event.severity] || SEVERITY_CONF.info;
                return (
                  <Card key={event.id} className="animate-slide-up hover:shadow-md transition-shadow cursor-pointer" onClick={() => setViewEvent(event)}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0", sev.className)}>
                        <sev.icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{event.action}</span>
                          <Badge variant="outline" className="text-xs">{event.module}</Badge>
                          <Badge className={cn("text-xs", sev.className)}>{sev.label}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{event.description}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="h-3 w-3" /> {event.userName}
                        </div>
                        <p className="text-xs text-muted-foreground">{event.timestamp ? new Date(event.timestamp).toLocaleString() : "—"}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {filtered.length > 50 && <p className="text-sm text-muted-foreground text-center py-2">Showing 50 of {filtered.length} events</p>}
            </div>
          )}
        </TabsContent>

        <TabsContent value="security" className="mt-4 space-y-6">
          {securityEvents.length === 0 ? (
            <DataEmptyState icon={Lock} title="No security events" description="Security-related activities will be tracked here." />
          ) : (
            <div className="space-y-2 stagger-children">
              {securityEvents.slice(0, 30).map(event => {
                const sev = SEVERITY_CONF[event.severity] || SEVERITY_CONF.warning;
                return (
                  <Card key={event.id} className="animate-slide-up border-l-4" style={{ borderLeftColor: event.severity === "critical" ? "#ef4444" : "#f59e0b" }}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <sev.icon className={cn("h-5 w-5 flex-shrink-0", event.severity === "critical" ? "text-red-500" : "text-amber-500")} />
                      <div className="flex-1">
                        <p className="font-medium text-sm">{event.description}</p>
                        <p className="text-xs text-muted-foreground">{event.userName} &middot; {event.module} &middot; {event.timestamp ? new Date(event.timestamp).toLocaleString() : "—"}</p>
                      </div>
                      <Badge className={cn("text-xs", sev.className)}>{sev.label}</Badge>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Activity Timeline</CardTitle></CardHeader>
              <CardContent>
                {timelineData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={timelineData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="date" fontSize={11} />
                      <YAxis fontSize={11} />
                      <RTooltip />
                      <Area type="monotone" dataKey="count" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Events by Severity</CardTitle></CardHeader>
              <CardContent>
                {severityDistribution.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={severityDistribution} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name }) => name}>
                        {severityDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Severity Stacked Area */}
          <Card>
            <CardHeader><CardTitle className="text-base">Severity Trend Over Time</CardTitle></CardHeader>
            <CardContent>
              {severityTimeline.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={severityTimeline}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="date" fontSize={11} />
                    <YAxis fontSize={11} />
                    <RTooltip />
                    <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                    <Area type="monotone" dataKey="info" name="Info" stackId="1" fill="#06b6d4" stroke="#06b6d4" fillOpacity={0.3} />
                    <Area type="monotone" dataKey="warning" name="Warning" stackId="1" fill="#f59e0b" stroke="#f59e0b" fillOpacity={0.3} />
                    <Area type="monotone" dataKey="critical" name="Critical" stackId="1" fill="#ef4444" stroke="#ef4444" fillOpacity={0.3} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-muted-foreground text-center py-8">No timeline data</p>}
            </CardContent>
          </Card>

          {/* Module Action Composed Chart */}
          <Card>
            <CardHeader><CardTitle className="text-base">Module Activity by Action Type</CardTitle></CardHeader>
            <CardContent>
              {actionBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={actionBreakdown}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="name" fontSize={10} />
                    <YAxis fontSize={11} />
                    <RTooltip />
                    <Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="create" name="Create" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="update" name="Update" stackId="a" fill="#8b5cf6" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="delete" name="Delete" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="total" name="Total" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-muted-foreground text-center py-8">No module data</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compliance" className="mt-4 space-y-6">
          {/*
            This tab used to show a "Compliance Scores" panel (Data Privacy
            92%, Password Policy 78%, Encryption 90%, etc.), a matching
            radar chart, and a "Compliance Checklist" that asserted things
            like "Two-factor authentication enabled for all admin accounts"
            and "Employee data encrypted at rest and in transit" as passed.
            Every number and every checkmark was a literal constant — none
            of it was ever measured against this org's actual settings. That
            is worse than showing nothing: a customer relying on a passed
            compliance check that no one verified is a real risk. There is
            no compliance-scanning backend to source this from, so the
            module-level chart below is real (derived from audit-log
            events); the score/checklist panels are gone until a real check
            exists to back them.
          */}
          <Card>
            <CardHeader><CardTitle className="text-base">Compliance Scoring</CardTitle></CardHeader>
            <CardContent>
              <DataEmptyState
                icon={Shield}
                title="Not available yet"
                description="Automated compliance scoring and checklist verification are not implemented. What follows is real activity from the audit log, not a compliance assessment."
                compact
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Events by Module</CardTitle></CardHeader>
            <CardContent>
              {moduleDistribution.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={moduleDistribution}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="name" fontSize={11} />
                    <YAxis fontSize={11} />
                    <RTooltip />
                    <Bar dataKey="value" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Recent Actions Summary */}
          <Card>
            <CardHeader><CardTitle className="text-base">Action Distribution</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                {ACTIONS.map(action => {
                  const count = items.filter(a => a.action === action).length;
                  const pct = items.length > 0 ? Math.round((count / items.length) * 100) : 0;
                  return (
                    <div key={action} className="p-3 rounded-lg border text-center hover:bg-muted/50 transition-colors">
                      <p className="text-lg font-bold">{count}</p>
                      <p className="text-xs text-muted-foreground capitalize">{action}</p>
                      <p className="text-[10px] text-muted-foreground">{pct}%</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Event Detail Dialog */}
      <Dialog open={!!viewEvent} onOpenChange={() => setViewEvent(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-violet-500" />
              Event Details
            </DialogTitle>
          </DialogHeader>
          {viewEvent && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-sm text-muted-foreground">User</p><p className="font-medium">{viewEvent.userName}</p></div>
                <div><p className="text-sm text-muted-foreground">Action</p><p className="font-medium">{viewEvent.action}</p></div>
                <div><p className="text-sm text-muted-foreground">Module</p><Badge variant="outline">{viewEvent.module}</Badge></div>
                <div><p className="text-sm text-muted-foreground">Severity</p><Badge className={cn("text-xs", SEVERITY_CONF[viewEvent.severity]?.className)}>{SEVERITY_CONF[viewEvent.severity]?.label || viewEvent.severity}</Badge></div>
                <div><p className="text-sm text-muted-foreground">User ID</p><p className="font-mono text-sm">{viewEvent.userId}</p></div>
                <div><p className="text-sm text-muted-foreground">Timestamp</p><p className="text-sm">{viewEvent.timestamp ? new Date(viewEvent.timestamp).toLocaleString() : "—"}</p></div>
              </div>
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground mb-1">Description</p>
                <p className="text-sm">{viewEvent.description}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
