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
import {
  Heart, Plus, Search, Brain, Dumbbell, DollarSign,
  Users, Smile, Scale, Activity, Target, Calendar,
  TrendingUp, BarChart3, Leaf, Coffee, BookOpen,
  ExternalLink, Sparkles,
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
// WELLNESS — Employee wellness programs, participation tracking,
// resources, and analytics
// ═══════════════════════════════════════════════════════════════

interface WellnessDoc extends BaseRecord {
  title: string; category: string; description: string;
  status: string; enrolled: number; capacity: number;
  startDate: string; endDate: string; instructor: string;
  frequency: string; location: string;
}

interface WellnessStore {
  items: WellnessDoc[];
  loading: boolean;
  initialized: boolean;
  error: string | null;
  setItems: (items: WellnessDoc[]) => void;
  addItem: (item: WellnessDoc) => void;
  updateItem: (id: string, updates: Partial<WellnessDoc>) => void;
  removeItem: (id: string) => void;
  setLoading: (v: boolean) => void;
  setInitialized: (v: boolean) => void;
  setError: (e: string | null) => void;
}

const useWellnessStore = create<WellnessStore>((set) => ({
  items: [], loading: false, initialized: false, error: null,
  setItems: (items) => set({ items, loading: false, initialized: true }),
  addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
  updateItem: (id, updates) => set((s) => ({ items: s.items.map(i => i.id === id ? { ...i, ...updates } : i) })),
  removeItem: (id) => set((s) => ({ items: s.items.filter(i => i.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setInitialized: (initialized) => set({ initialized }),
  setError: (error) => set({ error }),
}));

const PROGRAM_CATEGORIES = [
  { key: "Mental Health", icon: Brain, color: "from-violet-500 to-purple-600" },
  { key: "Physical Fitness", icon: Dumbbell, color: "from-emerald-500 to-green-600" },
  { key: "Financial Wellness", icon: DollarSign, color: "from-amber-500 to-orange-500" },
  { key: "Social Activities", icon: Users, color: "from-pink-500 to-rose-600" },
  { key: "Work-Life Balance", icon: Scale, color: "from-blue-500 to-cyan-500" },
];
const FREQUENCIES = ["Daily", "Weekly", "Bi-Weekly", "Monthly", "One-Time"];
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "status-active" },
  upcoming: { label: "Upcoming", className: "status-pending" },
  completed: { label: "Completed", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  paused: { label: "Paused", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
};
const RESOURCES = [
  { title: "Mental Health Helpline", desc: "24/7 counseling support", icon: Brain, category: "Mental Health" },
  { title: "Gym Membership Benefits", desc: "Discounted corporate memberships", icon: Dumbbell, category: "Physical Fitness" },
  { title: "Financial Planning Guide", desc: "Retirement and investment resources", icon: DollarSign, category: "Financial Wellness" },
  { title: "Team Building Activities", desc: "Monthly social events calendar", icon: Users, category: "Social Activities" },
  { title: "Flexible Work Policy", desc: "Guidelines for remote and hybrid work", icon: Coffee, category: "Work-Life Balance" },
  { title: "Meditation & Mindfulness", desc: "Guided sessions and app access", icon: Leaf, category: "Mental Health" },
  { title: "Nutrition Counseling", desc: "Dietitian consultations available", icon: Heart, category: "Physical Fitness" },
  { title: "Employee Assistance Program", desc: "Confidential counseling services", icon: Smile, category: "Mental Health" },
];
const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#6366f1","#14b8a6"];

export default function WellnessPage() {
  const store = useWellnessStore();
  const { items, loading, initialized } = store;

  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [tab, setTab] = useState("programs");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    title: "", category: "Mental Health", description: "", capacity: "",
    startDate: "", endDate: "", instructor: "", frequency: "Weekly",
    location: "",
  });

  useEffect(() => {
    if (!store.initialized) {
      store.setLoading(true);
      genericService(COLLECTIONS.wellness).getAll().then(data => {
        store.setItems(data as unknown as WellnessDoc[]);
      }).catch(() => { store.setItems([]); });
    }
  }, [store]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(w =>
        w.title?.toLowerCase().includes(q) || w.category?.toLowerCase().includes(q) ||
        w.instructor?.toLowerCase().includes(q)
      );
    }
    if (catFilter !== "all") result = result.filter(w => w.category === catFilter);
    return result;
  }, [items, search, catFilter]);

  const totalEnrolled = useMemo(() => items.reduce((s, w) => s + (w.enrolled || 0), 0), [items]);
  const activePrograms = items.filter(w => w.status === "active").length;
  const totalCapacity = useMemo(() => items.reduce((s, w) => s + (w.capacity || 0), 0), [items]);
  const utilizationRate = totalCapacity > 0 ? Math.round((totalEnrolled / totalCapacity) * 100) : 0;

  const wellnessScore = useMemo(() => {
    if (items.length === 0) return 0;
    return Math.min(100, Math.round((activePrograms / Math.max(PROGRAM_CATEGORIES.length, 1)) * 100));
  }, [items, activePrograms]);

  const categoryData = useMemo(() =>
    PROGRAM_CATEGORIES.map(cat => ({
      name: cat.key.substring(0, 12),
      count: items.filter(w => w.category === cat.key).length,
      enrolled: items.filter(w => w.category === cat.key).reduce((s, w) => s + (w.enrolled || 0), 0),
    })),
  [items]);

  const enrollmentData = useMemo(() =>
    items.map(w => ({ name: w.title?.substring(0, 15) || "N/A", enrolled: w.enrolled || 0, capacity: w.capacity || 0 }))
      .sort((a, b) => b.enrolled - a.enrolled).slice(0, 8),
  [items]);

  const resetForm = () => setForm({ title: "", category: "Mental Health", description: "", capacity: "", startDate: "", endDate: "", instructor: "", frequency: "Weekly", location: "" });

  const handleCreate = async () => {
    if (!form.title) { toast.error("Title is required"); return; }
    try {
      await genericService(COLLECTIONS.wellness).create({
        ...form, capacity: form.capacity ? parseInt(form.capacity) : 30,
        enrolled: 0, status: "active",
      });
      toast.success(`Program "${form.title}" created!`);
      setCreateOpen(false); resetForm();
    } catch { toast.error("Failed to create program"); }
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Wellness</h1>
          <p className="text-muted-foreground mt-1">Employee wellness programs and resources</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-lg gap-2" onClick={() => { resetForm(); setCreateOpen(true); }}>
          <Plus className="h-4 w-4" /> Add Program
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 stagger-children">
        {[
          { label: "Programs", value: items.length, icon: Heart, gradient: "from-violet-500 to-purple-600" },
          { label: "Active", value: activePrograms, icon: Activity, gradient: "from-emerald-500 to-green-600" },
          { label: "Enrolled", value: totalEnrolled, icon: Users, gradient: "from-blue-500 to-cyan-500" },
          { label: "Utilization", value: `${utilizationRate}%`, icon: Target, gradient: "from-amber-500 to-orange-500" },
          { label: "Wellness Score", value: `${wellnessScore}%`, icon: Sparkles, gradient: "from-pink-500 to-rose-600" },
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

      {/* Search + Filter */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search programs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {PROGRAM_CATEGORIES.map(c => <SelectItem key={c.key} value={c.key}>{c.key}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="programs" className="gap-2"><Heart className="h-4 w-4" /> Programs</TabsTrigger>
          <TabsTrigger value="resources" className="gap-2"><BookOpen className="h-4 w-4" /> Resources</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2"><BarChart3 className="h-4 w-4" /> Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="programs" className="mt-4">
          {/* Category overview cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
            {PROGRAM_CATEGORIES.map(cat => {
              const catPrograms = items.filter(w => w.category === cat.key);
              const catEnrolled = catPrograms.reduce((s, w) => s + (w.enrolled || 0), 0);
              return (
                <Card key={cat.key} className={cn("cursor-pointer hover:shadow-md transition-shadow", catFilter === cat.key && "ring-2 ring-violet-500")} onClick={() => setCatFilter(catFilter === cat.key ? "all" : cat.key)}>
                  <CardContent className="p-3 text-center">
                    <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center mx-auto mb-2", cat.color)}>
                      <cat.icon className="h-5 w-5 text-white" />
                    </div>
                    <p className="text-xs font-medium">{cat.key}</p>
                    <p className="text-lg font-bold">{catPrograms.length}</p>
                    <p className="text-[10px] text-muted-foreground">{catEnrolled} enrolled</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.wellness} onAction={() => setCreateOpen(true)} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
              {filtered.map(prog => {
                const catInfo = PROGRAM_CATEGORIES.find(c => c.key === prog.category);
                const CatIcon = catInfo?.icon || Heart;
                const fillRate = prog.capacity ? Math.round((prog.enrolled / prog.capacity) * 100) : 0;
                return (
                  <Card key={prog.id} className="animate-slide-up hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", catInfo?.color || "from-violet-500 to-purple-600")}>
                            <CatIcon className="h-5 w-5 text-white" />
                          </div>
                          <div>
                            <CardTitle className="text-base">{prog.title}</CardTitle>
                            <p className="text-xs text-muted-foreground">{prog.category}</p>
                          </div>
                        </div>
                        <Badge className={cn("text-xs", STATUS_CONF[prog.status]?.className || "status-active")}>
                          {STATUS_CONF[prog.status]?.label || prog.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {prog.description && <p className="text-sm text-muted-foreground line-clamp-2">{prog.description}</p>}
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div><p className="text-muted-foreground text-xs">Enrolled</p><p className="font-semibold">{prog.enrolled || 0} / {prog.capacity || "∞"}</p></div>
                        <div><p className="text-muted-foreground text-xs">Frequency</p><p className="font-semibold">{prog.frequency || "—"}</p></div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted-foreground">Occupancy</span>
                          <span className="font-medium">{fillRate}%</span>
                        </div>
                        <Progress value={fillRate} className="h-2" />
                      </div>
                      {prog.instructor && (
                        <p className="text-xs text-muted-foreground">Instructor: {prog.instructor}</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="resources" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
            {RESOURCES.map((res, i) => {
              const catInfo = PROGRAM_CATEGORIES.find(c => c.key === res.category);
              return (
                <Card key={i} className="animate-slide-up hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center mb-3", catInfo?.color || "from-violet-500 to-purple-600")}>
                      <res.icon className="h-5 w-5 text-white" />
                    </div>
                    <h3 className="font-semibold text-sm mb-1">{res.title}</h3>
                    <p className="text-xs text-muted-foreground mb-2">{res.desc}</p>
                    <Badge variant="outline" className="text-xs">{res.category}</Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-6">
          {/* Wellness Score Gauge */}
          <Card>
            <CardHeader><CardTitle className="text-base">Overall Wellness Score</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center justify-center gap-8">
                <div className="relative h-32 w-32">
                  <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="12" />
                    <circle cx="60" cy="60" r="50" fill="none" stroke="url(#wellnessGradient)" strokeWidth="12" strokeLinecap="round"
                      strokeDasharray={`${wellnessScore * 3.14} 314`} />
                    <defs>
                      <linearGradient id="wellnessGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#8b5cf6" />
                        <stop offset="100%" stopColor="#a855f7" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-3xl font-bold">{wellnessScore}%</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-sm"><span className="font-medium">{activePrograms}</span> active programs</p>
                  <p className="text-sm"><span className="font-medium">{totalEnrolled}</span> total enrolled</p>
                  <p className="text-sm"><span className="font-medium">{utilizationRate}%</span> utilization</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Programs by Category</CardTitle></CardHeader>
              <CardContent>
                {categoryData.every(c => c.count === 0) ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={categoryData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="name" fontSize={10} />
                      <YAxis fontSize={11} />
                      <RTooltip />
                      <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Programs" />
                      <Bar dataKey="enrolled" fill="#06b6d4" radius={[4, 4, 0, 0]} name="Enrolled" />
                      <Legend />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Enrollment by Program</CardTitle></CardHeader>
              <CardContent>
                {enrollmentData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={enrollmentData} cx="50%" cy="50%" outerRadius={100} dataKey="enrolled" label={({ name }) => name}>
                        {enrollmentData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Create Program Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Add Wellness Program</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Program Title *</Label>
              <Input placeholder="e.g. Yoga for Beginners" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PROGRAM_CATEGORIES.map(c => <SelectItem key={c.key} value={c.key}>{c.key}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FREQUENCIES.map(fr => <SelectItem key={fr} value={fr}>{fr}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea placeholder="Program details..." value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Capacity</Label>
                <Input type="number" placeholder="30" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Instructor</Label>
                <Input placeholder="Instructor name" value={form.instructor} onChange={e => setForm(f => ({ ...f, instructor: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Input placeholder="e.g. Gym, Room 201" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>Create Program</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
