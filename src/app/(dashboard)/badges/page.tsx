"use client";

import { useState, useEffect, useMemo } from "react";
import { create } from "zustand";
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
  Award, Plus, Search, Trophy, Crown, Star,
  Medal, Target, Users, TrendingUp, Gift,
  Sparkles, Shield, Zap, Gem,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useEmployeeStore, startSync, type BaseRecord } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, PieChart, Pie, Cell, Legend,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// BADGES — Gamification system, leaderboard, badge awards
// ═══════════════════════════════════════════════════════════════

interface BadgeDoc extends BaseRecord {
  name: string; description: string; icon: string;
  level: string; category: string; criteria: string;
  points: number; awardedTo: string[]; createdBy: string;
}

interface BadgeStore {
  items: BadgeDoc[];
  loading: boolean;
  initialized: boolean;
  error: string | null;
  setItems: (items: BadgeDoc[]) => void;
  addItem: (item: BadgeDoc) => void;
  updateItem: (id: string, updates: Partial<BadgeDoc>) => void;
  removeItem: (id: string) => void;
  setLoading: (v: boolean) => void;
  setInitialized: (v: boolean) => void;
  setError: (e: string | null) => void;
}

const useBadgeStore = create<BadgeStore>((set) => ({
  items: [], loading: false, initialized: false, error: null,
  setItems: (items) => set({ items, loading: false, initialized: true }),
  addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
  updateItem: (id, updates) => set((s) => ({ items: s.items.map(i => i.id === id ? { ...i, ...updates } : i) })),
  removeItem: (id) => set((s) => ({ items: s.items.filter(i => i.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setInitialized: (initialized) => set({ initialized }),
  setError: (error) => set({ error }),
}));

const LEVELS = [
  { key: "Bronze", color: "from-amber-600 to-amber-700", textColor: "text-amber-700 dark:text-amber-400", points: 10 },
  { key: "Silver", color: "from-gray-400 to-gray-500", textColor: "text-gray-600 dark:text-gray-400", points: 25 },
  { key: "Gold", color: "from-yellow-400 to-yellow-500", textColor: "text-yellow-600 dark:text-yellow-400", points: 50 },
  { key: "Platinum", color: "from-violet-500 to-purple-600", textColor: "text-violet-600 dark:text-violet-400", points: 100 },
];
const BADGE_CATEGORIES = ["Performance", "Teamwork", "Innovation", "Leadership", "Learning", "Culture", "Attendance", "Customer Service"];
const BADGE_ICONS = [
  { key: "trophy", icon: Trophy }, { key: "star", icon: Star }, { key: "award", icon: Award },
  { key: "crown", icon: Crown }, { key: "medal", icon: Medal }, { key: "gem", icon: Gem },
  { key: "zap", icon: Zap }, { key: "shield", icon: Shield }, { key: "sparkles", icon: Sparkles },
];
const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#6366f1","#14b8a6"];

export default function BadgesPage() {
  const store = useBadgeStore();
  const empStore = useEmployeeStore();
  const { items: badges, loading, initialized } = store;
  const { items: employees, initialized: empInit } = empStore;

  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [tab, setTab] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [awardOpen, setAwardOpen] = useState(false);
  const [awardBadge, setAwardBadge] = useState<BadgeDoc | null>(null);
  const [awardEmployee, setAwardEmployee] = useState("");
  const [form, setForm] = useState({
    name: "", description: "", icon: "trophy", level: "Bronze",
    category: "Performance", criteria: "", points: "10",
  });

  useEffect(() => {
    if (!store.initialized) {
      store.setLoading(true);
      genericService(COLLECTIONS.badges).getAll().then(data => {
        store.setItems(data as unknown as BadgeDoc[]);
      }).catch(() => { store.setItems([]); });
    }
    // `store` is deliberately not a dependency. It is the whole zustand state
    // object, so setLoading() above replaces it — listing it here re-triggers
    // this effect, which sets loading again, forever, firing a fetch each pass.
    // The setters are stable, so calling them from this closure is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (!empInit) startSync(COLLECTIONS.employees, empStore); }, [empInit, empStore]);

  const filtered = useMemo(() => {
    let result = badges;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(b =>
        b.name?.toLowerCase().includes(q) || b.category?.toLowerCase().includes(q) ||
        b.description?.toLowerCase().includes(q)
      );
    }
    if (levelFilter !== "all") result = result.filter(b => b.level === levelFilter);
    return result;
  }, [badges, search, levelFilter]);

  const totalAwarded = useMemo(() =>
    badges.reduce((s, b) => s + (b.awardedTo?.length || 0), 0),
  [badges]);

  const leaderboard = useMemo(() => {
    const pointsMap: Record<string, { name: string; points: number; badgeCount: number }> = {};
    badges.forEach(b => {
      (b.awardedTo || []).forEach(empName => {
        if (!pointsMap[empName]) pointsMap[empName] = { name: empName, points: 0, badgeCount: 0 };
        pointsMap[empName].points += (b.points || 0);
        pointsMap[empName].badgeCount += 1;
      });
    });
    return Object.values(pointsMap).sort((a, b) => b.points - a.points).slice(0, 10);
  }, [badges]);

  const levelDistribution = useMemo(() =>
    LEVELS.map(l => ({ name: l.key, value: badges.filter(b => b.level === l.key).length })),
  [badges]);

  const categoryDistribution = useMemo(() => {
    const map: Record<string, number> = {};
    badges.forEach(b => { const c = b.category || "Other"; map[c] = (map[c] || 0) + 1; });
    return Object.entries(map).map(([name, count]) => ({ name, count }));
  }, [badges]);

  const getIconComponent = (iconKey: string) => {
    const found = BADGE_ICONS.find(bi => bi.key === iconKey);
    return found?.icon || Award;
  };

  const resetForm = () => setForm({ name: "", description: "", icon: "trophy", level: "Bronze", category: "Performance", criteria: "", points: "10" });

  const handleCreate = async () => {
    if (!form.name) { toast.error("Badge name is required"); return; }
    try {
      await genericService(COLLECTIONS.badges).create({
        ...form, points: parseInt(form.points) || 10, awardedTo: [], createdBy: "Admin",
      });
      toast.success(`Badge "${form.name}" created!`);
      setCreateOpen(false); resetForm();
    } catch { toast.error("Failed to create badge"); }
  };

  const handleAward = async () => {
    if (!awardBadge || !awardEmployee) { toast.error("Select an employee"); return; }
    try {
      const updated = [...(awardBadge.awardedTo || []), awardEmployee];
      await genericService(COLLECTIONS.badges).update(awardBadge.id, { awardedTo: updated });
      store.updateItem(awardBadge.id, { awardedTo: updated });
      toast.success(`Badge awarded to ${awardEmployee}!`);
      setAwardOpen(false); setAwardEmployee(""); setAwardBadge(null);
    } catch { toast.error("Failed to award badge"); }
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Badges</h1>
          <p className="text-muted-foreground mt-1">Gamification and employee recognition system</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-lg gap-2" onClick={() => { resetForm(); setCreateOpen(true); }}>
          <Plus className="h-4 w-4" /> Create Badge
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        {[
          { label: "Total Badges", value: badges.length, icon: Award, gradient: "from-violet-500 to-purple-600" },
          { label: "Total Awarded", value: totalAwarded, icon: Gift, gradient: "from-emerald-500 to-green-600" },
          { label: "Leaderboard Size", value: leaderboard.length, icon: Trophy, gradient: "from-amber-500 to-orange-500" },
          { label: "Categories", value: new Set(badges.map(b => b.category).filter(Boolean)).size, icon: Target, gradient: "from-blue-500 to-cyan-500" },
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

      {/* Search + Filter */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search badges..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Level" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            {LEVELS.map(l => <SelectItem key={l.key} value={l.key}>{l.key}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all" className="gap-2"><Award className="h-4 w-4" /> All Badges</TabsTrigger>
          <TabsTrigger value="leaderboard" className="gap-2"><Trophy className="h-4 w-4" /> Leaderboard</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2"><TrendingUp className="h-4 w-4" /> Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.badges} onAction={() => setCreateOpen(true)} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 stagger-children">
              {filtered.map(badge => {
                const BadgeIcon = getIconComponent(badge.icon);
                const levelInfo = LEVELS.find(l => l.key === badge.level);
                return (
                  <Card key={badge.id} className="animate-slide-up hover:shadow-md transition-shadow text-center">
                    <CardContent className="p-4">
                      <div className={cn("h-16 w-16 rounded-full bg-gradient-to-br flex items-center justify-center mx-auto mb-3 shadow-lg", levelInfo?.color || "from-violet-500 to-purple-600")}>
                        <BadgeIcon className="h-8 w-8 text-white" />
                      </div>
                      <h3 className="font-semibold">{badge.name}</h3>
                      <Badge className={cn("text-xs my-2", levelInfo?.color ? `bg-gradient-to-r ${levelInfo.color} text-white border-0` : "")}>
                        {badge.level} &middot; {badge.points || 0} pts
                      </Badge>
                      <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{badge.description}</p>
                      <Badge variant="outline" className="text-xs mb-3">{badge.category}</Badge>
                      <Separator className="my-2" />
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{badge.awardedTo?.length || 0} awarded</span>
                        <Button size="sm" variant="outline" className="gap-1 h-7" onClick={() => { setAwardBadge(badge); setAwardOpen(true); }}>
                          <Gift className="h-3 w-3" /> Award
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="leaderboard" className="mt-4">
          {leaderboard.length === 0 ? (
            <DataEmptyState icon={Trophy} title="No leaders yet" description="Award badges to employees to populate the leaderboard." />
          ) : (
            <Card>
              <CardHeader><CardTitle className="text-base">Top Performers</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {leaderboard.map((leader, i) => (
                    <div key={leader.name} className={cn("flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/50 transition-colors", i < 3 && "border-amber-200 dark:border-amber-800")}>
                      <div className={cn(
                        "h-10 w-10 rounded-full flex items-center justify-center font-bold text-white",
                        i === 0 ? "bg-gradient-to-br from-yellow-400 to-yellow-500" :
                        i === 1 ? "bg-gradient-to-br from-gray-400 to-gray-500" :
                        i === 2 ? "bg-gradient-to-br from-amber-600 to-amber-700" :
                        "bg-gradient-to-br from-violet-500 to-purple-600"
                      )}>
                        {i < 3 ? <Crown className="h-5 w-5" /> : i + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold">{leader.name}</p>
                        <p className="text-xs text-muted-foreground">{leader.badgeCount} badges earned</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg">{leader.points}</p>
                        <p className="text-xs text-muted-foreground">points</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Badges by Level</CardTitle></CardHeader>
              <CardContent>
                {levelDistribution.every(l => l.value === 0) ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={levelDistribution} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name }) => name}>
                        {levelDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Badges by Category</CardTitle></CardHeader>
              <CardContent>
                {categoryDistribution.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={categoryDistribution}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="name" fontSize={10} />
                      <YAxis fontSize={11} />
                      <RTooltip />
                      <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Create Badge Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Create Badge</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Badge Name *</Label>
              <Input placeholder="e.g. Innovation Champion" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Level</Label>
                <Select value={form.level} onValueChange={v => setForm(f => ({ ...f, level: v, points: String(LEVELS.find(l => l.key === v)?.points || 10) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{LEVELS.map(l => <SelectItem key={l.key} value={l.key}>{l.key} ({l.points} pts)</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{BADGE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Icon</Label>
              <div className="flex gap-2 flex-wrap">
                {BADGE_ICONS.map(bi => {
                  const Icon = bi.icon;
                  return (
                    <Button key={bi.key} size="icon" variant={form.icon === bi.key ? "default" : "outline"} className={cn("h-9 w-9", form.icon === bi.key && "bg-gradient-to-r from-violet-500 to-purple-600 text-white")} onClick={() => setForm(f => ({ ...f, icon: bi.key }))}>
                      <Icon className="h-4 w-4" />
                    </Button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea placeholder="Badge description..." value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Criteria</Label>
              <Input placeholder="How to earn this badge" value={form.criteria} onChange={e => setForm(f => ({ ...f, criteria: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>Create Badge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Award Badge Dialog */}
      <Dialog open={awardOpen} onOpenChange={setAwardOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-violet-500" />
              Award Badge: {awardBadge?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Select Employee</Label>
              <Select value={awardEmployee} onValueChange={setAwardEmployee}>
                <SelectTrigger><SelectValue placeholder="Choose employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map(emp => (
                    <SelectItem key={emp.id} value={`${emp.firstName} ${emp.lastName}`}>
                      {emp.firstName} {emp.lastName} — {emp.department}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAwardOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={handleAward}>
              <Gift className="h-4 w-4" /> Award Badge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
