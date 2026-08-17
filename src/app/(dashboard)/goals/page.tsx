"use client";

import { useState, useEffect, useMemo } from "react";
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
import { Target, Plus, Search, TrendingUp, CheckCircle2, Clock, BarChart3, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useGoalStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const STATUS_COLORS: Record<string, string> = {
  "on-track": "status-active",
  "at-risk": "status-pending",
  completed: "status-active",
  "not-started": "status-inactive",
};

export default function GoalsPage() {
  const store = useGoalStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.goals, store);
  }, [initialized, store]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (g) =>
        (g.title || "").toLowerCase().includes(q) ||
        (g.category || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const totalGoals = items.length;
  const completed = items.filter((g) => g.status === "completed").length;
  const atRisk = items.filter((g) => g.status === "at-risk").length;
  const avgProgress =
    totalGoals > 0
      ? Math.round(
          items.reduce((s, g) => s + (g.progress || 0), 0) / totalGoals
        )
      : 0;
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
    const fd = new FormData(e.currentTarget);
    const data = {
      title: fd.get("title") as string,
      description: fd.get("description") as string,
      category: fd.get("category") as string,
      weight: Number(fd.get("weight")) || 1,
      progress: 0,
      status: "not-started",
      dueDate: fd.get("dueDate") as string,
      employeeId: "",
    };
    try {
      await genericService(COLLECTIONS.goals).create(data);
      toast.success("Goal created!");
      setDialogOpen(false);
    } catch {
      toast.error("Failed to create goal");
    }
  };

  if (loading && !initialized)
    return (
      <div className="p-6">
        <DataLoadingSkeleton />
      </div>
    );

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Goals & OKRs</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {totalGoals} goals &middot; {weightedProgress}% weighted progress
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"
        >
          <Plus className="h-4 w-4" />
          Create Goal
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Goals", value: totalGoals, icon: Target, color: "from-violet-500 to-purple-600" },
          { label: "Completed", value: completed, icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "At Risk", value: atRisk, icon: AlertTriangle, color: "from-red-500 to-rose-500" },
          { label: "Weighted Progress", value: `${weightedProgress}%`, icon: TrendingUp, color: "from-blue-500 to-cyan-500" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={cn("p-3 rounded-xl bg-gradient-to-r text-white", kpi.color)}>
                <kpi.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-2xl font-bold">{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search goals..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">Goals</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.goals} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching goals found.</p>
          ) : (
            filtered.map((goal) => (
              <Card key={goal.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{goal.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {goal.category} &middot; Weight: {goal.weight} &middot; Due: {goal.dueDate}
                      </p>
                    </div>
                    <Badge className={cn("text-xs ml-2", STATUS_COLORS[goal.status])}>
                      {goal.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <Progress value={goal.progress} className="flex-1 h-2" />
                    <span className="text-xs font-medium w-10 text-right">{goal.progress}%</span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4 mt-4">
          {items.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Category Breakdown</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {categoryBreakdown.map((cat) => (
                    <div key={cat.name} className="flex items-center gap-3">
                      <span className="text-sm flex-1">{cat.name}</span>
                      <span className="text-xs text-muted-foreground">{cat.count} goals</span>
                      <Progress value={cat.avgProg} className="w-24 h-2" />
                      <span className="text-xs font-medium w-8 text-right">{cat.avgProg}%</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Status Summary</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Completed", count: completed, color: "bg-emerald-500" },
                    { label: "On Track", count: items.filter((g) => g.status === "on-track").length, color: "bg-blue-500" },
                    { label: "At Risk", count: atRisk, color: "bg-red-500" },
                    { label: "Not Started", count: items.filter((g) => g.status === "not-started").length, color: "bg-gray-400" },
                  ].map((s) => (
                    <div key={s.label} className="flex items-center gap-3">
                      <div className={cn("h-3 w-3 rounded-full", s.color)} />
                      <span className="text-sm flex-1">{s.label}</span>
                      <span className="font-semibold">{s.count}</span>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Goal</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label>Title</Label><Input name="title" required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select name="category">
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Revenue">Revenue</SelectItem>
                    <SelectItem value="Product">Product</SelectItem>
                    <SelectItem value="People">People</SelectItem>
                    <SelectItem value="Operations">Operations</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Weight</Label><Input name="weight" type="number" defaultValue={1} min={1} max={10} /></div>
            </div>
            <div><Label>Due Date</Label><Input name="dueDate" type="date" required /></div>
            <div><Label>Description</Label><Textarea name="description" rows={2} /></div>
            <DialogFooter>
              <Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
