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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Target, Plus, Search, CheckCircle2, Clock, AlertTriangle,
  TrendingUp, Users, Calendar, ClipboardList, ArrowUpRight,
  Flag, Eye, BarChart3, XCircle, Timer, Milestone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, Tooltip as RTooltip,
} from "recharts";
import { useGoalStore, useEmployeeStore, startSync, type GoalDoc } from "@/stores/unified-store";
import { COLLECTIONS, genericService } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// PIP — Performance Improvement Plan Management
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const PIP_STATUSES = ["Active", "Completed", "Extended", "Terminated"];
const STATUS_MAP: Record<string, { label: string; className: string }> = {
  Active: { label: "Active", className: "status-pending" },
  Completed: { label: "Completed", className: "status-active" },
  Extended: { label: "Extended", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  Terminated: { label: "Terminated", className: "status-rejected" },
};

export default function PipPage() {
  const goalStore = useGoalStore();
  const empStore = useEmployeeStore();
  const { items: goals, loading, initialized } = goalStore;
  const { items: employees } = empStore;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<GoalDoc | null>(null);
  const [form, setForm] = useState({
    title: "", employeeId: "", description: "",
    category: "PIP", dueDate: "", weight: "100",
  });

  useEffect(() => {
    if (!goalStore.initialized) startSync(COLLECTIONS.goals, goalStore);
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
  }, [goalStore, empStore]);

  // Filter to PIP goals
  const pipGoals = useMemo(() => goals.filter(g => g.category === "PIP"), [goals]);

  // KPIs
  const activePips = pipGoals.filter(g => g.status === "Active").length;
  const onTrack = pipGoals.filter(g => g.progress >= 50 && g.status === "Active").length;
  const avgImprovement = pipGoals.length > 0
    ? Math.round(pipGoals.reduce((s, g) => s + (g.progress || 0), 0) / pipGoals.length)
    : 0;
  const completedPips = pipGoals.filter(g => g.status === "Completed").length;

  // Status distribution
  const statusDist = useMemo(() => {
    const counts: Record<string, number> = {};
    pipGoals.forEach(g => { counts[g.status || "Active"] = (counts[g.status || "Active"] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [pipGoals]);

  // Completion chart
  const completionData = useMemo(() => {
    return pipGoals.slice(0, 10).map(g => ({
      name: g.title?.slice(0, 15) || "Untitled",
      progress: g.progress || 0,
    }));
  }, [pipGoals]);

  // Milestones (simulated from goal progress)
  const milestones = useMemo(() => [
    { label: "Initial Assessment", threshold: 0 },
    { label: "30-Day Review", threshold: 25 },
    { label: "60-Day Review", threshold: 50 },
    { label: "90-Day Review", threshold: 75 },
    { label: "Final Evaluation", threshold: 100 },
  ], []);

  const filtered = useMemo(() => {
    let result = pipGoals;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(g =>
        g.title?.toLowerCase().includes(q) ||
        g.description?.toLowerCase().includes(q) ||
        g.employeeId?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") result = result.filter(g => g.status === statusFilter);
    return result;
  }, [pipGoals, search, statusFilter]);

  const handleCreate = async () => {
    if (!form.title || !form.employeeId || !form.dueDate) {
      toast.error("Please fill required fields"); return;
    }
    try {
      await genericService(COLLECTIONS.goals).create({
        title: form.title, employeeId: form.employeeId,
        description: form.description, category: "PIP",
        dueDate: form.dueDate, weight: Number(form.weight),
        progress: 0, status: "Active",
      });
      toast.success("PIP created successfully!");
      setCreateOpen(false);
      setForm({ title: "", employeeId: "", description: "", category: "PIP", dueDate: "", weight: "100" });
    } catch { toast.error("Failed to create PIP"); }
  };

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await genericService(COLLECTIONS.goals).update(id, { status });
      toast.success(`PIP marked as ${status}`);
    } catch { toast.error("Failed to update PIP"); }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && pipGoals.length === 0) {
    return <DataEmptyState icon={Target} title="No PIPs created" description="Performance improvement plans will appear here." actionLabel="Create PIP" onAction={() => setCreateOpen(true)} />;
  }

  const kpis = [
    { label: "Active PIPs", value: activePips, icon: AlertTriangle, gradient: "from-amber-500 to-orange-500" },
    { label: "On Track", value: onTrack, icon: TrendingUp, gradient: "from-emerald-500 to-green-600" },
    { label: "Avg Improvement", value: `${avgImprovement}%`, icon: BarChart3, gradient: "from-violet-500 to-purple-600" },
    { label: "Completed", value: completedPips, icon: CheckCircle2, gradient: "from-blue-500 to-cyan-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">PIP Management</h1>
          <p className="text-muted-foreground mt-1">Track performance improvement plans &amp; progress</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Create PIP
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
          <Input placeholder="Search PIPs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {PIP_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">PIP List</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* PIP List */}
        <TabsContent value="list" className="space-y-3 mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState icon={Target} title="No PIPs found" description="Adjust your search or create a new PIP." compact />
          ) : filtered.map(pip => {
            const st = STATUS_MAP[pip.status] || STATUS_MAP.Active;
            const emp = employees.find(e => e.id === pip.employeeId);
            const empName = emp ? `${emp.firstName} ${emp.lastName}` : pip.employeeId;
            const currentMilestone = milestones.filter(m => (pip.progress || 0) >= m.threshold).pop();
            return (
              <Card key={pip.id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setDetailItem(pip)}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-gradient-to-br from-amber-500 to-orange-500 text-white text-xs">
                          {empName.split(" ").map(n => n[0]).join("").slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{pip.title}</h3>
                          <Badge className={st.className}>{st.label}</Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>{empName}</span>
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Due: {pip.dueDate}</span>
                          {currentMilestone && <span className="flex items-center gap-1"><Milestone className="h-3 w-3" />{currentMilestone.label}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-lg font-bold">{pip.progress || 0}%</p>
                        <Progress value={pip.progress || 0} className="h-1.5 w-24" />
                      </div>
                      {pip.status === "Active" && (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="text-xs text-emerald-600" onClick={e => { e.stopPropagation(); handleStatusChange(pip.id, "Completed"); }}>Complete</Button>
                          <Button variant="ghost" size="sm" className="text-xs text-amber-600" onClick={e => { e.stopPropagation(); handleStatusChange(pip.id, "Extended"); }}>Extend</Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">PIP Status Distribution</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={statusDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                      {statusDist.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Goal Completion Progress</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={completionData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 100]} />
                    <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} />
                    <RTooltip />
                    <Bar dataKey="progress" name="Progress %" fill="#10b981" radius={[0,4,4,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          {/* Milestone Tracker */}
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">PIP Milestone Framework</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                {milestones.map((m, i) => (
                  <div key={m.label} className="flex flex-col items-center gap-2 flex-1">
                    <div className={cn("h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold",
                      "bg-gradient-to-br from-violet-500 to-purple-600 text-white")}>
                      {i + 1}
                    </div>
                    <p className="text-xs text-center font-medium">{m.label}</p>
                    <p className="text-xs text-muted-foreground">{m.threshold}%</p>
                    {i < milestones.length - 1 && <Separator className="w-full mt-1" />}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={!!detailItem} onOpenChange={v => { if (!v) setDetailItem(null); }}>
        <DialogContent>
          {detailItem && (
            <>
              <DialogHeader><DialogTitle>PIP Details</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-lg">{detailItem.title}</h3>
                  <Badge className={(STATUS_MAP[detailItem.status] || STATUS_MAP.Active).className}>
                    {detailItem.status}
                  </Badge>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Employee</p><p className="font-medium">{detailItem.employeeId}</p></div>
                  <div><p className="text-muted-foreground">Due Date</p><p className="font-medium">{detailItem.dueDate}</p></div>
                  <div><p className="text-muted-foreground">Weight</p><p className="font-medium">{detailItem.weight}%</p></div>
                  <div><p className="text-muted-foreground">Progress</p><p className="font-bold text-lg">{detailItem.progress}%</p></div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Description</p>
                  <p className="text-sm">{detailItem.description || "No description provided"}</p>
                </div>
                <Separator />
                <div>
                  <p className="text-sm font-medium mb-2">Milestone Progress</p>
                  <div className="space-y-2">
                    {milestones.map(m => (
                      <div key={m.label} className="flex items-center gap-2">
                        <div className={cn("h-5 w-5 rounded-full flex items-center justify-center text-[10px]",
                          (detailItem.progress || 0) >= m.threshold
                            ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground")}>
                          {(detailItem.progress || 0) >= m.threshold ? <CheckCircle2 className="h-3 w-3" /> : null}
                        </div>
                        <span className="text-sm">{m.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDetailItem(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create PIP Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Create Performance Improvement Plan</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>PIP Title *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Q1 Performance Recovery" />
            </div>
            <div className="space-y-2">
              <Label>Employee *</Label>
              <Select value={form.employeeId} onValueChange={v => setForm(f => ({ ...f, employeeId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Due Date *</Label>
                <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Weight (%)</Label>
                <Input type="number" value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Improvement Goals &amp; Expectations</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the improvement goals, expected outcomes, and milestones..." rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" /> Create PIP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
