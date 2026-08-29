"use client";

import { useState, useEffect, useMemo } from "react";
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
import {
  Target, Plus, Search, TrendingUp, CheckCircle2, Clock,
  BarChart3, AlertTriangle, Sparkles, User, Send, DollarSign,
  Layers, Users, Shield, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useGoalStore, useEmployeeStore, startSync, type GoalDoc } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const STATUS_COLORS: Record<string, string> = {
  "on-track": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  "at-risk": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  completed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  "not-started": "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400",
};

const GOAL_CATEGORIES = [
  { id: "Revenue", label: "Revenue & Growth", icon: DollarSign, color: "text-emerald-500" },
  { id: "Product", label: "Product & Engineering", icon: Zap, color: "text-blue-500" },
  { id: "People", label: "People & Culture", icon: Users, color: "text-purple-500" },
  { id: "Operations", label: "Operations & Quality", icon: Layers, color: "text-amber-500" },
];

export default function GoalsPage() {
  const store = useGoalStore();
  const empStore = useEmployeeStore();
  const { items, loading, initialized } = store;
  const { items: employees, initialized: empInit } = empStore;

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form State
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(GOAL_CATEGORIES[0].id);
  const [employeeId, setEmployeeId] = useState("");
  const [weight, setWeight] = useState(3);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d.toISOString().slice(0, 10);
  });
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.goals, store);
    if (!empInit) startSync(COLLECTIONS.employees, empStore);
  }, [initialized, store, empInit, empStore]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (g) =>
        (g.title || "").toLowerCase().includes(q) ||
        (g.category || "").toLowerCase().includes(q) ||
        (g.description || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const totalGoals = items.length;
  const completed = items.filter((g) => g.status === "completed").length;
  const atRisk = items.filter((g) => g.status === "at-risk").length;
  const onTrack = items.filter((g) => g.status === "on-track").length;
  const weightedProgress = useMemo(() => {
    const totalWeight = items.reduce((s, g) => s + (g.weight || 1), 0);
    if (totalWeight === 0) return 0;
    return Math.round(
      items.reduce((s, g) => s + (g.progress || 0) * (g.weight || 1), 0) /
        totalWeight
    );
  }, [items]);

  const categoryBreakdown = useMemo(() => {
    const map: Record<string, { count: number; avgProg: number; totalProg: number }> = {};
    items.forEach((g) => {
      const cat = g.category || "Other";
      if (!map[cat]) map[cat] = { count: 0, avgProg: 0, totalProg: 0 };
      map[cat].count++;
      map[cat].totalProg += g.progress || 0;
    });
    return Object.entries(map).map(([name, v]) => ({
      name,
      count: v.count,
      avgProg: v.count > 0 ? Math.round(v.totalProg / v.count) : 0,
    }));
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!title.trim() || !dueDate) {
      toast.error("Please provide a title and target due date.");
      return;
    }

    setSubmitting(true);
    const data: Omit<GoalDoc, "id"> = {
      title: title.trim(),
      description: description.trim(),
      category,
      weight: Number(weight) || 1,
      progress: 0,
      status: "not-started",
      dueDate,
      employeeId: employeeId || undefined,
    };

    try {
      const id = await genericService(COLLECTIONS.goals).create(data as unknown as Record<string, unknown>);
      store.addItem({ ...data, id } as GoalDoc);
      toast.success("Strategic OKR / Goal created!");
      setDialogOpen(false);
      setTitle("");
      setDescription("");
    } catch {
      toast.error("Failed to create goal");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !initialized)
    return (
      <div className="p-6">
        <DataLoadingSkeleton rows={6} />
      </div>
    );

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Goals &amp; Strategic OKRs</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {totalGoals} organizational key results &middot; {weightedProgress}% weighted progress
          </p>
        </div>
        <Button
          onClick={() => {
            if (employees.length > 0 && !employeeId) {
              setEmployeeId(employees[0].id);
            }
            setDialogOpen(true);
          }}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2 rounded-full h-9 px-4 hover:opacity-95"
        >
          <Plus className="h-4 w-4" />
          Create Goal
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Objectives", value: totalGoals, icon: Target, color: "from-violet-500 to-purple-600", sub: "Active Key Results" },
          { label: "Weighted Progress", value: `${weightedProgress}%`, icon: TrendingUp, color: "from-blue-500 to-cyan-500", sub: "Overall completion" },
          { label: "On Track", value: onTrack, icon: CheckCircle2, color: "from-emerald-500 to-green-600", sub: "Meeting pacing" },
          { label: "At Risk / Needs Attention", value: atRisk, icon: AlertTriangle, color: "from-amber-500 to-orange-500", sub: "Behind schedule" },
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

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search goals by title, category, or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 text-xs h-9"
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">All Goals &amp; OKRs</TabsTrigger>
          <TabsTrigger value="analytics">Progress Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.goals} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-xs">No matching goals found.</p>
          ) : (
            filtered.map((goal) => {
              const assignedEmp = employees.find(e => e.id === goal.employeeId);
              const empName = assignedEmp ? `${assignedEmp.firstName} ${assignedEmp.lastName}` : null;
              return (
                <Card key={goal.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="font-semibold text-sm text-foreground">{goal.title}</p>
                        <Badge variant="outline" className="text-[11px]">{goal.category}</Badge>
                        <Badge className={cn("text-[10px] uppercase font-bold", STATUS_COLORS[goal.status || "not-started"])}>
                          {goal.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">{goal.description}</p>
                      <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                        {empName && <span>Owner: <strong className="text-foreground">{empName}</strong></span>}
                        <span>Due: {goal.dueDate || "End of Quarter"}</span>
                        <span>Weight: {goal.weight || 1}x</span>
                      </div>
                    </div>

                    <div className="w-36 shrink-0 space-y-1 text-right">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-muted-foreground">Progress</span>
                        <span>{goal.progress || 0}%</span>
                      </div>
                      <Progress value={goal.progress || 0} className="h-2" />
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {items.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Progress by Category</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {categoryBreakdown.map((cat) => (
                    <div key={cat.name} className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/20">
                      <span className="text-xs font-semibold text-foreground">{cat.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{cat.count} goals</span>
                        <Progress value={cat.avgProg} className="w-24 h-2" />
                        <span className="text-xs font-bold w-8 text-right">{cat.avgProg}%</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Status Distribution</CardTitle></CardHeader>
                <CardContent className="space-y-2.5">
                  {[
                    { label: "Completed", count: completed, color: "bg-blue-500" },
                    { label: "On Track", count: onTrack, color: "bg-emerald-500" },
                    { label: "At Risk", count: atRisk, color: "bg-amber-500" },
                    { label: "Not Started", count: items.filter((g) => g.status === "not-started").length, color: "bg-gray-400" },
                  ].map((s) => (
                    <div key={s.label} className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/20">
                      <div className="flex items-center gap-2">
                        <div className={cn("h-2.5 w-2.5 rounded-full", s.color)} />
                        <span className="text-xs font-semibold text-foreground">{s.label}</span>
                      </div>
                      <span className="text-xs font-bold">{s.count}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          ) : (
            <DataEmptyState {...EMPTY_STATES.goals} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      {/* ENHANCED CREATE GOAL DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <Target className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Set Strategic OKR / Goal</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Define quarterly milestones, success criteria, and assign ownership.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Objective Title <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. Expand European Enterprise Sales Pipeline by 30%"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="h-9 text-xs"
                required
              />
            </div>

            {/* Category Selector Cards */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Strategic Pillar</Label>
              <div className="grid grid-cols-2 gap-2">
                {GOAL_CATEGORIES.map(cat => {
                  const Icon = cat.icon;
                  const active = category === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategory(cat.id)}
                      className={cn(
                        "p-2.5 rounded-lg border text-left transition-all cursor-pointer",
                        active
                          ? "bg-violet-50 dark:bg-violet-950/40 border-violet-500 text-violet-700 dark:text-violet-300 shadow-xs"
                          : "bg-background hover:bg-muted/50 text-muted-foreground border-border"
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <Icon className={cn("h-3.5 w-3.5", active ? "text-violet-600" : cat.color)} />
                        <span className="font-bold text-xs">{cat.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-violet-500" />
                  Assign Goal Owner
                </Label>
                {employees && employees.length > 0 ? (
                  <Select value={employeeId} onValueChange={setEmployeeId}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select team member..." />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map(emp => {
                        const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ") || String(emp.id);
                        const sub = [emp.designation, emp.department].filter(Boolean).join(" · ");
                        return (
                          <SelectItem key={emp.id} value={emp.id} className="text-xs">
                            <span className="font-medium">{name}</span>
                            {sub ? <span className="text-muted-foreground ml-2 text-[11px]">({sub})</span> : null}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="Owner name or ID"
                    value={employeeId}
                    onChange={e => setEmployeeId(e.target.value)}
                    className="h-9 text-xs"
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Target Due Date <span className="text-destructive">*</span></Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Strategic Weight / Priority</Label>
                <Select value={String(weight)} onValueChange={v => setWeight(Number(v))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1" className="text-xs">1x (Standard)</SelectItem>
                    <SelectItem value="2" className="text-xs">2x (High)</SelectItem>
                    <SelectItem value="3" className="text-xs">3x (Core Strategic OKR)</SelectItem>
                    <SelectItem value="5" className="text-xs">5x (Company-wide Priority)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Key Result Description</Label>
                <Textarea
                  placeholder="Key metrics, deliverables, and quantifiable targets..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={2}
                  className="text-xs resize-none"
                />
              </div>
            </div>

            <DialogFooter className="pt-2 gap-2">
              <Button type="button" variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setDialogOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all gap-1.5">
                <Send className="h-4 w-4" /> {submitting ? "Creating…" : "Establish Goal"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
