"use client";

import { useState, useEffect, useMemo } from "react";
import { dateKeyInZone } from "@/lib/date-keys";
import { create } from "zustand";
import { type BaseRecord, useEmployeeStore, startSync } from "@/stores/unified-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Award, Plus, Search, Star, Users, Lightbulb, Heart, Crown,
  Trophy, TrendingUp, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRBAC } from "@/hooks/use-rbac";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Cell } from "recharts";

// ─── Awards Store ────────────────────────────────────────────

interface AwardDoc extends BaseRecord {
  recipientId: string;
  recipientName: string;
  category: string;
  description: string;
  givenBy: string;
  date: string;
  points: number;
}

const COLLECTION_NAME = "awards";

const useAwardStore = create<{
  items: AwardDoc[]; loading: boolean; initialized: boolean; error: string | null;
  setItems: (items: AwardDoc[]) => void; addItem: (item: AwardDoc) => void;
  updateItem: (id: string, u: Partial<AwardDoc>) => void; removeItem: (id: string) => void;
  setLoading: (v: boolean) => void; setInitialized: (v: boolean) => void; setError: (e: string | null) => void;
}>((set) => ({
  items: [], loading: false, initialized: false, error: null,
  setItems: (items) => set({ items, loading: false, initialized: true }),
  addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
  updateItem: (id, u) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...u } : i)) })),
  removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setInitialized: (initialized) => set({ initialized }),
  setError: (error) => set({ error }),
}));

// ─── Config Constants ────────────────────────────────────────

const AWARD_CATEGORIES = [
  { value: "star-performer", label: "Star Performer", icon: Star, color: "from-yellow-500 to-amber-500", points: 100 },
  { value: "team-player", label: "Team Player", icon: Users, color: "from-blue-500 to-cyan-500", points: 75 },
  { value: "innovation", label: "Innovation", icon: Lightbulb, color: "from-purple-500 to-violet-500", points: 100 },
  { value: "customer-hero", label: "Customer Hero", icon: Heart, color: "from-pink-500 to-rose-500", points: 80 },
  { value: "leadership", label: "Leadership", icon: Crown, color: "from-indigo-500 to-blue-500", points: 90 },
] as const;

const CHART_COLORS = ["#eab308", "#3b82f6", "#a855f7", "#ec4899", "#6366f1"];

export default function AwardsPage() {
  const { user } = useAuth();
  const { isAdmin, isHR } = useRBAC();
  const store = useAwardStore();
  const empStore = useEmployeeStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tab, setTab] = useState("awards");

  useEffect(() => {
    if (!initialized) {
      store.setLoading(true);
      genericService(COLLECTION_NAME).getAll().then((data) => {
        store.setItems(data as unknown as AwardDoc[]);
      }).catch(() => store.setItems([]));
    }
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
    // Neither store belongs in the deps: they are whole zustand state objects,
    // and setLoading() above replaces `store`, so listing it re-triggers this
    // effect forever. `initialized` is the real guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (a) =>
        a.recipientName?.toLowerCase().includes(q) ||
        a.category?.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q)
    );
  }, [items, search]);

  // KPIs from store
  const totalAwards = items.length;
  const totalPoints = items.reduce((s, a) => s + (a.points || 0), 0);
  const uniqueRecipients = new Set(items.map((a) => a.recipientId)).size;
  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((a) => { map[a.category] = (map[a.category] || 0) + 1; });
    return map;
  }, [items]);
  const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

  // Category chart data
  const categoryChartData = useMemo(() => {
    return AWARD_CATEGORIES.map((cat) => ({
      name: cat.label,
      count: categoryCounts[cat.value] || 0,
    }));
  }, [categoryCounts]);

  // Points leaderboard — computed from store
  const leaderboard = useMemo(() => {
    const map: Record<string, { name: string; points: number; count: number }> = {};
    items.forEach((a) => {
      const key = a.recipientId || a.recipientName;
      if (!map[key]) map[key] = { name: a.recipientName, points: 0, count: 0 };
      map[key].points += a.points || 0;
      map[key].count++;
    });
    return Object.values(map).sort((a, b) => b.points - a.points).slice(0, 10);
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const recipientId = fd.get("recipientId") as string;
    const emp = empStore.items.find((e) => e.id === recipientId);
    const category = fd.get("category") as string;
    const catConfig = AWARD_CATEGORIES.find((c) => c.value === category);
    const data = {
      recipientId,
      recipientName: emp ? `${emp.firstName} ${emp.lastName}` : "",
      category,
      description: fd.get("description") as string,
      givenBy: user?.displayName || user?.email || "",
      date: dateKeyInZone(new Date()),
      points: catConfig?.points || 50,
    };
    try {
      const id = await genericService(COLLECTION_NAME).create(data);
      store.addItem({ ...data, id });
      toast.success("Award created!");
      setDialogOpen(false);
    } catch {
      toast.error("Failed to create award");
    }
  };

  if (loading && !initialized) return <DataLoadingSkeleton rows={6} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Awards & Recognition</h1>
          <p className="text-muted-foreground">Celebrate employee achievements and milestones</p>
        </div>
        <Button className="gap-2 bg-gradient-to-r from-yellow-500 to-amber-500 text-white border-0" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" /> Give Award
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Awards", value: totalAwards, icon: Award, color: "text-yellow-600", sub: `${uniqueRecipients} unique recipients` },
          { label: "Total Points", value: totalPoints.toLocaleString(), icon: Trophy, color: "text-purple-600", sub: "Points distributed" },
          { label: "Top Category", value: AWARD_CATEGORIES.find((c) => c.value === topCategory)?.label || topCategory, icon: TrendingUp, color: "text-blue-600", sub: `${categoryCounts[topCategory] || 0} awards` },
          { label: "Recipients", value: uniqueRecipients, icon: Users, color: "text-green-600", sub: "Employees recognized" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
                  <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{kpi.sub}</p>
                </div>
                <div className={cn("h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center", kpi.color)}>
                  <kpi.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="awards">Awards</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="chart">Analytics</TabsTrigger>
        </TabsList>

        {/* Awards List */}
        <TabsContent value="awards">
          <Card>
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <CardTitle className="text-base flex-1">All Awards</CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search awards..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
              </div>
            </CardHeader>
            <CardContent>
              {filtered.length === 0 ? (
                <DataEmptyState {...EMPTY_STATES.awards} onAction={() => setDialogOpen(true)} compact />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((a) => {
                    const catConfig = AWARD_CATEGORIES.find((c) => c.value === a.category);
                    const CatIcon = catConfig?.icon || Award;
                    return (
                      <Card key={a.id} className="overflow-hidden">
                        <div className={cn("h-1.5 bg-gradient-to-r", catConfig?.color || "from-gray-400 to-gray-500")} />
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shrink-0", catConfig?.color || "from-gray-400 to-gray-500")}>
                              <CatIcon className="h-5 w-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{a.recipientName}</p>
                              <p className="text-xs text-muted-foreground">{catConfig?.label || a.category}</p>
                              {a.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.description}</p>}
                              <div className="flex items-center justify-between mt-2">
                                <span className="text-xs text-muted-foreground">{a.date} · by {a.givenBy}</span>
                                <Badge variant="outline" className="text-xs gap-1"><Sparkles className="h-3 w-3" />{a.points} pts</Badge>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Leaderboard */}
        <TabsContent value="leaderboard">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Trophy className="h-4 w-4 text-yellow-500" /> Points Leaderboard</CardTitle></CardHeader>
            <CardContent>
              {leaderboard.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No awards to rank yet</p>
              ) : (
                <div className="space-y-2">
                  {leaderboard.map((entry, i) => (
                    <div key={entry.name + i} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                      <div className={cn("h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold", i === 0 ? "bg-yellow-100 text-yellow-700" : i === 1 ? "bg-gray-100 text-gray-700" : i === 2 ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground")}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{entry.name}</p>
                        <p className="text-xs text-muted-foreground">{entry.count} award{entry.count !== 1 ? "s" : ""}</p>
                      </div>
                      <Badge variant="outline" className="gap-1"><Sparkles className="h-3 w-3" />{entry.points} pts</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Chart */}
        <TabsContent value="chart">
          <Card>
            <CardHeader><CardTitle className="text-base">Awards by Category</CardTitle></CardHeader>
            <CardContent>
              {categoryChartData.every((c) => c.count === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-12">No data to display</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={categoryChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <RTooltip />
                    <Bar dataKey="count" name="Awards" radius={[4, 4, 0, 0]}>
                      {categoryChartData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Award Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Give an Award</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Recipient</Label>
              <Select name="recipientId" required>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {empStore.items.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} — {emp.department}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select name="category" required>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {AWARD_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label} ({c.points} pts)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" rows={3} placeholder="Why is this person being recognized?" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-gradient-to-r from-yellow-500 to-amber-500 text-white border-0">Give Award</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
