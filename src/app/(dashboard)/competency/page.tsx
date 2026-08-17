"use client";

import { useState, useMemo, useCallback } from "react";
import { create } from "zustand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Target, Plus, Search, Star, Award, Users,
  BarChart3, Layers, GraduationCap, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip,
} from "recharts";
import { COLLECTIONS, genericService } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

const LEVELS = ["Beginner", "Intermediate", "Advanced", "Expert"];
const LEVEL_COLORS: Record<string, string> = {
  Beginner: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  Intermediate: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Advanced: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Expert: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
};
const CATEGORIES = ["Technical", "Leadership", "Communication", "Domain", "Tools"];

interface Competency {
  id: string;
  name: string;
  category: string;
  level: string;
  description: string;
  employeeCount: number;
}

interface CompetencyStore {
  items: Competency[];
  loading: boolean;
  add: (c: Competency) => void;
  remove: (id: string) => void;
  update: (id: string, data: Partial<Competency>) => void;
  setItems: (items: Competency[]) => void;
}

const useCompetencyStore = create<CompetencyStore>((set) => ({
  items: [],
  loading: false,
  add: (c) => set((s) => ({ items: [c, ...s.items] })),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  update: (id, data) => set((s) => ({ items: s.items.map((i) => i.id === id ? { ...i, ...data } : i) })),
  setItems: (items) => set({ items }),
}));

export default function CompetencyPage() {
  const store = useCompetencyStore();
  const { items, loading } = store;
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", level: "Beginner", description: "" });

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
    }
    if (categoryFilter !== "all") result = result.filter(c => c.category === categoryFilter);
    return result;
  }, [items, search, categoryFilter]);

  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(c => { counts[c.category] = (counts[c.category] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  const levelMatrix = useMemo(() =>
    LEVELS.map(level => ({
      level,
      count: items.filter(c => c.level === level).length,
    })),
  [items]);

  const resetForm = () => setForm({ name: "", category: "", level: "Beginner", description: "" });

  const handleCreate = useCallback(async () => {
    if (!form.name || !form.category) {
      toast.error("Name and category are required"); return;
    }
    try {
      const id = await genericService(COLLECTIONS.training).create({ ...form, type: "competency", employeeCount: 0 });
      store.add({ id, ...form, employeeCount: 0 });
      toast.success("Competency created!");
      setCreateOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to create competency");
    }
  }, [form, store]);

  if (items.length === 0 && !loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Competency Matrix</h1>
            <p className="text-muted-foreground mt-1">Define and manage organizational skill frameworks</p>
          </div>
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Add Competency
          </Button>
        </div>
        <DataEmptyState icon={Target} title="No competencies defined" description="Create your first competency to build the skill matrix." actionLabel="Add Competency" onAction={() => setCreateOpen(true)} />
        <CreateDialog open={createOpen} onOpenChange={setCreateOpen} form={form} setForm={setForm} onSubmit={handleCreate} />
      </div>
    );
  }

  const kpis = [
    { label: "Total Competencies", value: items.length, icon: Layers, gradient: "from-violet-500 to-purple-600" },
    { label: "Categories", value: new Set(items.map(c => c.category)).size, icon: BarChart3, gradient: "from-blue-500 to-cyan-500" },
    { label: "Expert Level", value: items.filter(c => c.level === "Expert").length, icon: Star, gradient: "from-amber-500 to-orange-500" },
    { label: "Avg per Category", value: items.length > 0 ? Math.round(items.length / (new Set(items.map(c => c.category)).size || 1)) : 0, icon: TrendingUp, gradient: "from-emerald-500 to-green-600" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Competency Matrix</h1>
          <p className="text-muted-foreground mt-1">Define and manage organizational skill frameworks</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Add Competency
        </Button>
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">Level Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={levelMatrix}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="level" />
                <YAxis />
                <RTooltip />
                <Bar dataKey="count" fill="#8b5cf6" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">Skills by Level</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {LEVELS.map(level => {
              const count = items.filter(c => c.level === level).length;
              const pct = items.length > 0 ? Math.round((count / items.length) * 100) : 0;
              return (
                <div key={level} className="flex items-center gap-3">
                  <Badge className={cn("text-xs w-24 justify-center", LEVEL_COLORS[level])}>{level}</Badge>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm font-medium w-10 text-right">{count}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search competencies…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(comp => (
          <Card key={comp.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{comp.name}</p>
                <Badge className={cn("text-xs", LEVEL_COLORS[comp.level])}>{comp.level}</Badge>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{comp.description || "No description"}</p>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <Badge variant="secondary">{comp.category}</Badge>
                <span>{comp.employeeCount} employees</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} form={form} setForm={setForm} onSubmit={handleCreate} />
    </div>
  );
}

function CreateDialog({ open, onOpenChange, form, setForm, onSubmit }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  form: { name: string; category: string; level: string; description: string };
  setForm: (f: typeof form) => void; onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Competency</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Category</Label>
            <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Level</Label>
            <Select value={form.level} onValueChange={v => setForm({ ...form, level: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={onSubmit}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
