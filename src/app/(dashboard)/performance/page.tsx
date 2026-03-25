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
  Target, Plus, Search, CheckCircle2, Clock, TrendingUp, Eye,
  Star, Award, BarChart3, ArrowUpRight, AlertTriangle,
  FileText, Calendar, Users, Lightbulb, Activity, Flag,
  ChevronRight, MessageSquare, Zap, CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
  Tooltip as RTooltip,
} from "recharts";
import { useGoalStore, startSync, type GoalDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// PERFORMANCE — Goal tracking, reviews, 360° feedback,
// rating distribution, and performance analytics
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const CATEGORIES = ["Business", "Technical", "Leadership", "Learning", "Innovation", "Customer"];
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  on_track: { label: "On Track", className: "status-active" },
  at_risk: { label: "At Risk", className: "status-pending" },
  behind: { label: "Behind", className: "status-rejected" },
  completed: { label: "Completed", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  not_started: { label: "Not Started", className: "status-inactive" },
};
const RATING_LABELS = ["Needs Improvement", "Below Expectations", "Meets Expectations", "Exceeds Expectations", "Outstanding"];

export default function PerformancePage() {
  const store = useGoalStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("goals");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<GoalDoc | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", category: "", weight: "",
    dueDate: "", employeeId: "", status: "not_started",
  });
  const [reviewForm, setReviewForm] = useState({
    selfRating: "", selfComments: "", managerRating: "", managerComments: "",
  });

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.goals, store); }, [initialized, store]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(g =>
        g.title?.toLowerCase().includes(q) ||
        g.description?.toLowerCase().includes(q) ||
        g.category?.toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== "all") result = result.filter(g => g.category === categoryFilter);
    if (statusFilter !== "all") result = result.filter(g => g.status === statusFilter);
    return result;
  }, [items, search, categoryFilter, statusFilter]);

  // KPIs
  const activeGoals = items.filter(g => g.status !== "completed").length;
  const onTrackPct = items.length > 0 ? Math.round((items.filter(g => g.status === "on_track").length / items.length) * 100) : 0;
  const avgProgress = items.length > 0 ? Math.round(items.reduce((s, g) => s + (g.progress || 0), 0) / items.length) : 0;
  const completedCount = items.filter(g => g.status === "completed").length;

  // Rating distribution
  const ratingDist = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    items.forEach(g => {
      const rating = Math.min(4, Math.max(0, Math.floor((g.progress || 0) / 20)));
      counts[rating]++;
    });
    return RATING_LABELS.map((name, i) => ({ name, value: counts[i] }));
  }, [items]);

  // Category progress
  const categoryProgress = useMemo(() => {
    const data: Record<string, { total: number; progress: number; count: number }> = {};
    items.forEach(g => {
      const cat = g.category || "Other";
      if (!data[cat]) data[cat] = { total: 0, progress: 0, count: 0 };
      data[cat].total += g.weight || 1;
      data[cat].progress += (g.progress || 0) * (g.weight || 1) / 100;
      data[cat].count++;
    });
    return Object.entries(data).map(([name, v]) => ({
      name,
      progress: v.total > 0 ? Math.round((v.progress / v.total) * 100) : 0,
      count: v.count,
    }));
  }, [items]);

  // Weighted score
  const weightedScore = useMemo(() => {
    const totalWeight = items.reduce((s, g) => s + (g.weight || 1), 0);
    if (totalWeight === 0) return 0;
    return Math.round(items.reduce((s, g) => s + (g.progress || 0) * (g.weight || 1), 0) / totalWeight);
  }, [items]);

  const resetForm = () => setForm({ title: "", description: "", category: "", weight: "", dueDate: "", employeeId: "", status: "not_started" });

  const handleCreate = async () => {
    if (!form.title || !form.category) {
      toast.error("Please fill required fields"); return;
    }
    try {
      await genericService(COLLECTIONS.goals).create({
        ...form,
        weight: Number(form.weight) || 10,
        progress: 0,
        status: "not_started",
      });
      toast.success("Goal created successfully!");
      setCreateOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to create goal");
    }
  };

  const handleProgressUpdate = async (id: string, progress: number) => {
    try {
      const status = progress >= 100 ? "completed" : progress >= 70 ? "on_track" : progress >= 40 ? "at_risk" : "behind";
      await genericService(COLLECTIONS.goals).update(id, { progress, status });
      toast.success("Progress updated!");
    } catch {
      toast.error("Failed to update progress");
    }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && items.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.goals} onAction={() => setCreateOpen(true)} />;
  }

  const kpis = [
    { label: "Active Goals", value: activeGoals, icon: Target, gradient: "from-violet-500 to-purple-600" },
    { label: "On Track", value: `${onTrackPct}%`, icon: TrendingUp, gradient: "from-emerald-500 to-green-600" },
    { label: "Avg Progress", value: `${avgProgress}%`, icon: Activity, gradient: "from-blue-500 to-cyan-500" },
    { label: "Completed", value: completedCount, icon: CheckCircle2, gradient: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Performance</h1>
          <p className="text-muted-foreground mt-1">Track goals, reviews, and team performance</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Create Goal
        </Button>
      </div>

      {/* Weighted Score Banner */}
      <Card className="border-0 shadow-sm bg-gradient-to-r from-violet-500/10 to-purple-500/10">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Overall Weighted Score</p>
              <p className="text-3xl font-bold mt-1">{weightedScore}%</p>
            </div>
            <div className="flex-1 max-w-md mx-8">
              <Progress value={weightedScore} className="h-3" />
            </div>
            <Badge className={weightedScore >= 80 ? "status-active" : weightedScore >= 60 ? "status-pending" : "status-rejected"}>
              {weightedScore >= 80 ? "Excellent" : weightedScore >= 60 ? "Good" : "Needs Work"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
          <Input placeholder="Search goals..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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
          <TabsTrigger value="goals">Goals</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="360">360° Feedback</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Goals Tab */}
        <TabsContent value="goals" className="space-y-3 mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.goals} compact onAction={() => setCreateOpen(true)} />
          ) : (
            filtered.map((goal) => {
              const st = STATUS_CONF[goal.status] || STATUS_CONF.not_started;
              return (
                <Card key={goal.id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedGoal(goal)}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold">{goal.title}</h3>
                          <Badge variant="outline" className="text-xs">{goal.category}</Badge>
                          <Badge className={st.className}>{st.label}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">{goal.description || "No description"}</p>
                        <div className="flex items-center gap-4">
                          <div className="flex-1 max-w-xs">
                            <div className="flex justify-between text-xs mb-1">
                              <span>Progress</span>
                              <span className="font-medium">{goal.progress || 0}%</span>
                            </div>
                            <Progress value={goal.progress || 0} className="h-2" />
                          </div>
                          <div className="flex items-center gap-3 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1"><Flag className="h-3 w-3" />Weight: {goal.weight || 10}%</span>
                            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{goal.dueDate || "No deadline"}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1 ml-4">
                        {[25, 50, 75, 100].map((p) => (
                          <Button
                            key={p}
                            variant="ghost"
                            size="sm"
                            className={cn("h-7 w-7 p-0 text-xs", (goal.progress || 0) >= p && "bg-violet-100 text-violet-700 dark:bg-violet-900/30")}
                            onClick={(e) => { e.stopPropagation(); handleProgressUpdate(goal.id, p); }}
                          >
                            {p}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* Reviews Tab */}
        <TabsContent value="reviews" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Review Cycles</CardTitle>
                <Button variant="outline" size="sm" onClick={() => setReviewOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Start Review
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {["Q1 2026 Review", "Annual Review 2025", "Mid-Year 2025"].map((cycle, i) => (
                  <div key={cycle} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", i === 0 ? "from-violet-500 to-purple-600" : "from-gray-400 to-gray-500")}>
                        <FileText className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="font-medium">{cycle}</p>
                        <p className="text-xs text-muted-foreground">{i === 0 ? "In Progress" : "Completed"} · {items.length} goals evaluated</p>
                      </div>
                    </div>
                    <Badge className={i === 0 ? "status-pending" : "status-active"}>
                      {i === 0 ? "Active" : "Closed"}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Self Assessment Form */}
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Self Assessment</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Self Rating (1-5)</Label>
                  <Select value={reviewForm.selfRating} onValueChange={(v) => setReviewForm(f => ({ ...f, selfRating: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select rating" /></SelectTrigger>
                    <SelectContent>
                      {RATING_LABELS.map((label, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>{i + 1} - {label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Comments</Label>
                  <Textarea value={reviewForm.selfComments} onChange={(e) => setReviewForm(f => ({ ...f, selfComments: e.target.value }))} placeholder="Describe your achievements, challenges, and learnings..." rows={4} />
                </div>
                <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0">Submit Assessment</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 360° Tab */}
        <TabsContent value="360" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">360° Feedback</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {["Peer Review", "Manager Review", "Subordinate Review", "Self Review"].map((type, i) => (
                  <div key={type} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center">
                        {i === 0 ? <Users className="h-4 w-4 text-violet-600" /> :
                         i === 1 ? <Star className="h-4 w-4 text-amber-600" /> :
                         i === 2 ? <MessageSquare className="h-4 w-4 text-blue-600" /> :
                         <CircleDot className="h-4 w-4 text-emerald-600" />}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{type}</p>
                        <p className="text-xs text-muted-foreground">{i === 3 ? "Completed" : `${3 - i} responses pending`}</p>
                      </div>
                    </div>
                    <Progress value={i === 3 ? 100 : (3 - i) * 25} className="w-24 h-2" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Rating Distribution</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={ratingDist}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-20} textAnchor="end" height={60} />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="value" name="Employees" fill="#8b5cf6" radius={[4, 4, 0, 0]}>
                      {ratingDist.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Progress by Category</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {categoryProgress.map((c) => (
                    <div key={c.name} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-muted-foreground">{c.progress}% · {c.count} goals</span>
                      </div>
                      <Progress value={c.progress} className="h-2" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Goal Detail Dialog */}
      <Dialog open={!!selectedGoal} onOpenChange={(v) => { if (!v) setSelectedGoal(null); }}>
        <DialogContent>
          {selectedGoal && (
            <>
              <DialogHeader><DialogTitle>{selectedGoal.title}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge className={(STATUS_CONF[selectedGoal.status] || STATUS_CONF.not_started).className}>
                    {(STATUS_CONF[selectedGoal.status] || STATUS_CONF.not_started).label}
                  </Badge>
                  <Badge variant="outline">{selectedGoal.category}</Badge>
                  <Badge variant="outline">Weight: {selectedGoal.weight}%</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{selectedGoal.description || "No description"}</p>
                <Separator />
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Progress</span>
                    <span className="font-bold">{selectedGoal.progress || 0}%</span>
                  </div>
                  <Progress value={selectedGoal.progress || 0} className="h-3" />
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Due Date</p><p className="font-medium">{selectedGoal.dueDate || "Not set"}</p></div>
                  <div><p className="text-muted-foreground">Category</p><p className="font-medium">{selectedGoal.category}</p></div>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <div className="flex gap-1">
                  {[25, 50, 75, 100].map(p => (
                    <Button key={p} variant="outline" size="sm" onClick={() => { handleProgressUpdate(selectedGoal.id, p); setSelectedGoal(null); }}>
                      {p}%
                    </Button>
                  ))}
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Goal Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Create Goal</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Goal title" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the goal and key results..." rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category *</Label>
                <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Weight (%)</Label>
                <Input type="number" value={form.weight} onChange={(e) => setForm(f => ({ ...f, weight: e.target.value }))} placeholder="10" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Due Date</Label>
              <Input type="date" value={form.dueDate} onChange={(e) => setForm(f => ({ ...f, dueDate: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" /> Create Goal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Start Review Dialog */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Start Review Cycle</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Starting a new review cycle will allow employees to submit self-assessments
              and managers to provide ratings for all {items.length} active goals.
            </p>
            <div className="p-3 rounded-lg bg-muted/30 text-sm">
              <p className="font-medium">Goals to evaluate: {items.length}</p>
              <p className="text-muted-foreground">Average progress: {avgProgress}%</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={() => { toast.success("Review cycle started!"); setReviewOpen(false); }}>
              Start Cycle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
