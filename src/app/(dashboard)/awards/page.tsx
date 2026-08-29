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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
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

  // Category chart data
  const categoryChartData = useMemo(() => {
    return AWARD_CATEGORIES.map((cat) => ({
      name: cat.label,
      count: categoryCounts[cat.value] || 0,
    }));
  }, [categoryCounts]);
  const topCategoryItem = useMemo(() => [...categoryChartData].sort((a, b) => b.count - a.count)[0], [categoryChartData]);
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

  // Form state
  const [selectedRecipientId, setSelectedRecipientId] = useState("");
  const [customRecipientName, setCustomRecipientName] = useState("");
  const [category, setCategory] = useState<string>(AWARD_CATEGORIES[0].value);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedRecipientObj = useMemo(() => {
    return empStore.items.find((e) => e.id === selectedRecipientId);
  }, [empStore.items, selectedRecipientId]);

  const activeCatConfig = useMemo(() => {
    return AWARD_CATEGORIES.find((c) => c.value === category) || AWARD_CATEGORIES[0];
  }, [category]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const finalName = selectedRecipientObj
      ? [selectedRecipientObj.firstName, selectedRecipientObj.lastName].filter(Boolean).join(" ")
      : customRecipientName.trim();

    if (!selectedRecipientId && !customRecipientName.trim()) {
      toast.error("Please select a recipient employee.");
      return;
    }
    if (!description.trim()) {
      toast.error("Please provide recognition details or why this award is given.");
      return;
    }

    setSubmitting(true);
    const data = {
      recipientId: selectedRecipientId || "manual",
      recipientName: finalName,
      category,
      description: description.trim(),
      givenBy: user?.displayName || user?.email || "HR / Leadership",
      date: dateKeyInZone(new Date()),
      points: activeCatConfig.points || 50,
    };
    try {
      const id = await genericService(COLLECTION_NAME).create(data);
      store.addItem({ ...data, id });
      toast.success(`Award bestowed to ${finalName}!`);
      setDialogOpen(false);
      setSelectedRecipientId("");
      setCustomRecipientName("");
      setDescription("");
    } catch {
      toast.error("Failed to create award");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !initialized) return <DataLoadingSkeleton rows={6} />;

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Awards &amp; Recognition</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Celebrate employee achievements, milestones, and peer recognition</p>
        </div>
        <Button
          className="gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 rounded-full h-9 px-4 shadow-md hover:opacity-95"
          onClick={() => setDialogOpen(true)}
        >
          <Trophy className="h-4 w-4" /> Give Award
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Awards", value: totalAwards, icon: Trophy, color: "from-amber-500 to-yellow-500", sub: `${uniqueRecipients} unique recipients` },
          { label: "Total Points Awarded", value: totalPoints.toLocaleString(), icon: Sparkles, color: "from-violet-500 to-purple-600", sub: "Reward points active" },
          { label: "Top Category", value: topCategoryItem?.name || "N/A", icon: Star, color: "from-blue-500 to-cyan-500", sub: `${topCategoryItem?.count || 0} awarded` },
          { label: "Leaderboard Leader", value: leaderboard[0]?.name || "N/A", icon: Crown, color: "from-emerald-500 to-green-600", sub: `${leaderboard[0]?.points || 0} pts` },
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

      {/* Main Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="wall">Recognition Wall</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Wall */}
        <TabsContent value="wall" className="space-y-4 mt-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search recognition by recipient, award, or message..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 text-xs h-9"
              />
            </div>
          </div>

          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.awards} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching awards found.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((a) => {
                const cat = AWARD_CATEGORIES.find((c) => c.value === a.category);
                const Icon = cat?.icon || Award;
                return (
                  <Card key={a.id} className="hover:shadow-sm transition-shadow">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className={cn("p-2 rounded-xl bg-gradient-to-r text-white shrink-0", cat?.color || "from-gray-400 to-gray-500")}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-semibold text-sm">{a.recipientName}</p>
                            <p className="text-xs text-muted-foreground">{cat?.label || a.category}</p>
                          </div>
                        </div>
                        <Badge className="bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 text-xs font-semibold">
                          +{a.points || cat?.points || 50} pts
                        </Badge>
                      </div>
                      {a.description && <p className="text-xs text-muted-foreground line-clamp-3 italic">"{a.description}"</p>}
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t">
                        <span>Given by {a.givenBy || "Anonymous"}</span>
                        <span>{a.date}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Leaderboard */}
        <TabsContent value="leaderboard" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold">Top Performers Leaderboard</CardTitle></CardHeader>
            <CardContent>
              {leaderboard.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No points data recorded yet</p>
              ) : (
                <div className="space-y-2.5">
                  {leaderboard.map((entry, i) => (
                    <div key={entry.name} className="flex items-center justify-between p-3 rounded-xl border bg-muted/20">
                      <div className="flex items-center gap-3">
                        <span className={cn("h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold", i === 0 ? "bg-amber-400 text-amber-950" : i === 1 ? "bg-slate-300 text-slate-900" : i === 2 ? "bg-amber-600 text-white" : "bg-muted text-muted-foreground")}>
                          {i + 1}
                        </span>
                        <div>
                          <p className="font-medium text-sm">{entry.name}</p>
                          <p className="text-xs text-muted-foreground">{entry.count} awards received</p>
                        </div>
                      </div>
                      <Badge className="bg-amber-500 text-white text-xs font-bold">{entry.points} pts</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold">Awards Distribution by Category</CardTitle></CardHeader>
            <CardContent>
              {categoryChartData.every((c) => c.count === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-8">No award data to display</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={categoryChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <RTooltip />
                    <Bar dataKey="count" name="Awards" radius={[4, 4, 0, 0]}>
                      {categoryChartData.map((_, i) => (
                        <Cell key={i} fill={["#f59e0b", "#8b5cf6", "#ec4899", "#3b82f6", "#10b981", "#6366f1"][i % 6]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ENHANCED GIVE AWARD DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-500 text-white shadow-md">
                <Trophy className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Bestow Recognition Award</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Recognize outstanding contributions and award reward points to employees.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            {/* Recipient Selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-amber-500" />
                Recipient Employee <span className="text-destructive">*</span>
              </Label>
              {empStore.items && empStore.items.length > 0 ? (
                <div className="space-y-1.5">
                  <Select value={selectedRecipientId} onValueChange={setSelectedRecipientId}>
                    <SelectTrigger className="w-full h-9 text-xs">
                      <SelectValue placeholder="Select employee to recognize..." />
                    </SelectTrigger>
                    <SelectContent>
                      {empStore.items.map((emp) => {
                        const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ") || String(emp.id);
                        const sub = [emp.designation, emp.department].filter(Boolean).join(" · ");
                        return (
                          <SelectItem key={emp.id} value={emp.id} className="text-xs">
                            <span className="font-medium">{name}</span>
                            {sub ? <span className="text-muted-foreground ml-2 text-[11px]">({sub})</span> : null}
                          </SelectItem>
                        );
                      })}
                      <SelectItem value="manual" className="text-xs text-amber-600 font-medium">
                        + Enter manual name
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {selectedRecipientId === "manual" && (
                    <Input
                      placeholder="Enter full employee name"
                      value={customRecipientName}
                      onChange={(e) => setCustomRecipientName(e.target.value)}
                      className="h-9 text-xs mt-1"
                      required
                    />
                  )}
                </div>
              ) : (
                <Input
                  placeholder="e.g. Ananya Roy"
                  value={customRecipientName}
                  onChange={(e) => setCustomRecipientName(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              )}
            </div>

            {/* Award Category Selector Cards */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Award Category &amp; Recognition Level <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {AWARD_CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const active = category === cat.value;
                  return (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setCategory(cat.value)}
                      className={cn(
                        "p-2.5 rounded-lg border text-left transition-all",
                        active
                          ? "bg-amber-50 dark:bg-amber-950/40 border-amber-500 text-amber-900 dark:text-amber-300 shadow-xs"
                          : "bg-background hover:bg-muted/50 text-muted-foreground border-border"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Icon className={cn("h-4 w-4", active ? "text-amber-600" : "text-muted-foreground")} />
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 font-bold">
                          +{cat.points} pts
                        </span>
                      </div>
                      <p className="font-semibold text-xs text-foreground truncate">{cat.label}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Appreciation Message */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Recognition Message &amp; Citations <span className="text-destructive">*</span></Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Highlight specific achievements, project deliveries, leadership, or core values demonstrated..."
                rows={3}
                className="text-xs resize-none"
                required
              />
            </div>

            {/* Award Preview Banner */}
            <div className="p-3 rounded-lg border bg-amber-50/60 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <activeCatConfig.icon className="h-4 w-4 text-amber-600" />
                <div>
                  <p className="text-xs font-bold text-foreground">{activeCatConfig.label} Honor</p>
                  <p className="text-[11px] text-muted-foreground">
                    Awarding +{activeCatConfig.points} reward points to {selectedRecipientObj ? `${selectedRecipientObj.firstName} ${selectedRecipientObj.lastName}` : "Employee"}
                  </p>
                </div>
              </div>
              <Badge className="bg-amber-600 text-white text-xs">+{activeCatConfig.points} Pts</Badge>
            </div>

            <DialogFooter className="pt-2 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                className="rounded-full text-xs h-9 px-4"
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all"
              >
                {submitting ? "Bestowing…" : "Give Award"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
