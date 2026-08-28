"use client";

import { useState, useEffect, useMemo } from "react";
import { dateKeyInZone, toLocalDateKey } from "@/lib/date-keys";
import { useNowMs } from "@/hooks/use-now";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  PartyPopper, Search, Calendar, Gift, Star, Award,
  Cake, Heart, Trophy, Users, Send, Crown, Sparkles,
  TrendingUp, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useCelebrationStore, useEmployeeStore, startSync,
  type CelebrationDoc, type EmployeeDoc,
} from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, PieChart, Pie, Cell, Legend,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// CELEBRATIONS — Birthdays, anniversaries, milestone badges,
// celebration wall, and wishes
// ═══════════════════════════════════════════════════════════════

const MILESTONE_BADGES = [
  { years: 1, label: "1 Year", icon: Star, color: "from-blue-500 to-cyan-500" },
  { years: 3, label: "3 Years", icon: Award, color: "from-emerald-500 to-green-600" },
  { years: 5, label: "5 Years", icon: Trophy, color: "from-amber-500 to-orange-500" },
  { years: 10, label: "10 Years", icon: Crown, color: "from-violet-500 to-purple-600" },
];
const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#6366f1"];
const TYPE_CONF: Record<string, { label: string; className: string; icon: typeof Cake }> = {
  birthday: { label: "Birthday", className: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400", icon: Cake },
  anniversary: { label: "Work Anniversary", className: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400", icon: Award },
  milestone: { label: "Milestone", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: Trophy },
  promotion: { label: "Promotion", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", icon: TrendingUp },
};

export default function CelebrationsPage() {
  const nowMs = useNowMs();
  const celebStore = useCelebrationStore();
  const empStore = useEmployeeStore();
  const { items: celebrations, loading, initialized } = celebStore;
  const { items: employees, initialized: empInit } = empStore;

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("upcoming");
  const [wishOpen, setWishOpen] = useState(false);
  const [wishTarget, setWishTarget] = useState<CelebrationDoc | null>(null);
  const [wishMessage, setWishMessage] = useState("");

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.celebrations, celebStore); }, [initialized, celebStore]);
  useEffect(() => { if (!empInit) startSync(COLLECTIONS.employees, empStore); }, [empInit, empStore]);

  const upcomingFromEmployees = useMemo(() => {
    // `new Date()` inside the memo was impure, so the value went stale and the
    // server and client disagreed.
    //
    // Written as a single expression with no early return and no mutation
    // after the fact. The React Compiler could not preserve this memo while it
    // used `forEach`+`push` and an in-place `sort`: it treats a value as frozen
    // once a closure has captured it, so mutating `upcoming` afterwards made it
    // bail out of optimising the entire component.
    const now = nowMs === null ? null : new Date(nowMs);
    const currentYear = now === null ? 0 : now.getFullYear();

    const upcoming = now === null ? [] : employees.flatMap(emp => {
      if (!emp.joiningDate) return [];
      const jd = new Date(emp.joiningDate);
      if (Number.isNaN(jd.getTime())) return [];

      const thisYear = new Date(currentYear, jd.getMonth(), jd.getDate());
      const anniversary = thisYear < now
        ? new Date(currentYear + 1, jd.getMonth(), jd.getDate())
        : thisYear;

      const daysUntil = Math.ceil((anniversary.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntil > 30) return [];

      return [{
        name: `${emp.firstName} ${emp.lastName}`,
        type: "anniversary",
        // `anniversary` is local midnight, so toISOString() would shift it
        // back a day everywhere east of UTC — including IST, this product's
        // default zone. Formatted from local parts instead.
        date: toLocalDateKey(anniversary),
        department: emp.department || "—",
        daysUntil,
      }];
    });

    return [...upcoming].sort((a, b) => a.daysUntil - b.daysUntil);
  }, [employees, nowMs]);

  const filtered = useMemo(() => {
    if (!search) return celebrations;
    const q = search.toLowerCase();
    return celebrations.filter(c =>
      c.employeeName?.toLowerCase().includes(q) || c.type?.toLowerCase().includes(q) || c.department?.toLowerCase().includes(q)
    );
  }, [celebrations, search]);

  const milestoneEmployees = useMemo(() => {
    const now = new Date();
    return employees.filter(emp => {
      if (!emp.joiningDate) return false;
      const years = now.getFullYear() - new Date(emp.joiningDate).getFullYear();
      return MILESTONE_BADGES.some(m => m.years === years);
    }).map(emp => {
      const years = now.getFullYear() - new Date(emp.joiningDate).getFullYear();
      const badge = MILESTONE_BADGES.find(m => m.years === years);
      return { ...emp, milestoneYears: years, badge };
    });
  }, [employees]);

  const monthlyStats = useMemo(() => {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months.map((name, i) => ({
      name,
      count: celebrations.filter(c => {
        const d = c.date ? new Date(c.date) : null;
        return d && d.getMonth() === i;
      }).length + upcomingFromEmployees.filter(u => new Date(u.date).getMonth() === i).length,
    }));
  }, [celebrations, upcomingFromEmployees]);

  const typeDistribution = useMemo(() => {
    const map: Record<string, number> = {};
    celebrations.forEach(c => { const t = c.type || "other"; map[t] = (map[t] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name: TYPE_CONF[name]?.label || name, value }));
  }, [celebrations]);

  const totalCelebrations = celebrations.length;
  const thisMonth = celebrations.filter(c => {
    const d = c.date ? new Date(c.date) : null;
    const now = new Date();
    return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const handleSendWish = async () => {
    if (!wishMessage.trim()) { toast.error("Please write a message"); return; }
    try {
      await genericService(COLLECTIONS.celebrations).create({
        employeeName: wishTarget?.employeeName || "Team",
        type: "wish",
        date: dateKeyInZone(new Date()),
        department: wishTarget?.department || "",
        details: wishMessage,
      });
      toast.success("Wish sent!");
      setWishOpen(false); setWishMessage(""); setWishTarget(null);
    } catch { toast.error("Failed to send wish"); }
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Celebrations</h1>
          <p className="text-muted-foreground mt-1">Birthdays, anniversaries, and milestones</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-lg gap-2" onClick={() => { setWishTarget(null); setWishOpen(true); }}>
          <Sparkles className="h-4 w-4" /> Send Wishes
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        {[
          { label: "Total Celebrations", value: totalCelebrations, icon: PartyPopper, gradient: "from-violet-500 to-purple-600" },
          { label: "This Month", value: thisMonth, icon: Calendar, gradient: "from-blue-500 to-cyan-500" },
          { label: "Upcoming", value: upcomingFromEmployees.length, icon: Gift, gradient: "from-emerald-500 to-green-600" },
          { label: "Milestones", value: milestoneEmployees.length, icon: Trophy, gradient: "from-amber-500 to-orange-500" },
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

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search celebrations..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="upcoming" className="gap-2"><Calendar className="h-4 w-4" /> Upcoming</TabsTrigger>
          <TabsTrigger value="wall" className="gap-2"><Heart className="h-4 w-4" /> Wall</TabsTrigger>
          <TabsTrigger value="milestones" className="gap-2"><Trophy className="h-4 w-4" /> Milestones</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2"><TrendingUp className="h-4 w-4" /> Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="mt-4">
          {upcomingFromEmployees.length === 0 && filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.celebrations} />
          ) : (
            <div className="space-y-3 stagger-children">
              {upcomingFromEmployees.map((item, i) => {
                const conf = TYPE_CONF[item.type] || TYPE_CONF.anniversary;
                return (
                  <Card key={`up-${i}`} className="animate-slide-up hover:shadow-md transition-shadow">
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                        <conf.icon className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold">{item.name}</h3>
                        <p className="text-sm text-muted-foreground">{item.department}</p>
                      </div>
                      <div className="text-right">
                        <Badge className={cn("text-xs", conf.className)}>{conf.label}</Badge>
                        <p className="text-xs text-muted-foreground mt-1">
                          {item.daysUntil === 0 ? "Today!" : `In ${item.daysUntil} day${item.daysUntil > 1 ? "s" : ""}`}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => { setWishTarget({ employeeName: item.name, department: item.department } as CelebrationDoc); setWishOpen(true); }}>
                        <Send className="h-3 w-3" /> Wish
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
              {filtered.filter(c => {
                const d = c.date ? new Date(c.date) : null;
                return d && d >= new Date();
              }).map(c => {
                const conf = TYPE_CONF[c.type] || TYPE_CONF.anniversary;
                return (
                  <Card key={c.id} className="animate-slide-up hover:shadow-md transition-shadow">
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center">
                        <conf.icon className="h-6 w-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold">{c.employeeName}</h3>
                        <p className="text-sm text-muted-foreground">{c.department} &middot; {c.details}</p>
                      </div>
                      <div className="text-right">
                        <Badge className={cn("text-xs", conf.className)}>{conf.label}</Badge>
                        <p className="text-xs text-muted-foreground mt-1">{c.date ? new Date(c.date).toLocaleDateString() : "—"}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="wall" className="mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.celebrations} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
              {filtered.map(c => {
                const conf = TYPE_CONF[c.type] || TYPE_CONF.anniversary;
                return (
                  <Card key={c.id} className="animate-slide-up hover:shadow-md transition-shadow">
                    <CardContent className="p-4 text-center">
                      <div className="h-16 w-16 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mx-auto mb-3">
                        <conf.icon className="h-8 w-8 text-white" />
                      </div>
                      <h3 className="font-semibold">{c.employeeName}</h3>
                      <Badge className={cn("text-xs my-2", conf.className)}>{conf.label}</Badge>
                      <p className="text-sm text-muted-foreground">{c.details}</p>
                      <Separator className="my-3" />
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{c.department}</span>
                        <span>{c.date ? new Date(c.date).toLocaleDateString() : "—"}</span>
                      </div>
                      <Button size="sm" variant="outline" className="w-full mt-3 gap-1" onClick={() => { setWishTarget(c); setWishOpen(true); }}>
                        <Heart className="h-3 w-3" /> Send Wish
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="milestones" className="mt-4">
          {milestoneEmployees.length === 0 ? (
            <DataEmptyState icon={Trophy} title="No milestones this year" description="Employees reaching 1, 3, 5, or 10 year milestones will appear here." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
              {milestoneEmployees.map(emp => (
                <Card key={emp.id} className="animate-slide-up text-center">
                  <CardContent className="p-4">
                    <Avatar className="h-16 w-16 mx-auto mb-3">
                      <AvatarFallback className={cn("text-lg bg-gradient-to-br text-white", emp.badge?.color || "from-violet-500 to-purple-600")}>
                        {emp.firstName?.[0]}{emp.lastName?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <h3 className="font-semibold">{emp.firstName} {emp.lastName}</h3>
                    <p className="text-sm text-muted-foreground mb-2">{emp.department}</p>
                    <div className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r text-white text-sm font-medium", emp.badge?.color || "from-violet-500 to-purple-600")}>
                      {emp.badge && <emp.badge.icon className="h-4 w-4" />}
                      {emp.badge?.label || `${emp.milestoneYears} Years`}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">Joined {new Date(emp.joiningDate).toLocaleDateString()}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Monthly Celebrations</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={monthlyStats}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="name" fontSize={11} />
                    <YAxis fontSize={11} />
                    <RTooltip />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">By Type</CardTitle></CardHeader>
              <CardContent>
                {typeDistribution.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={typeDistribution} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name }) => name}>
                        {typeDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Milestone Distribution */}
          <Card>
            <CardHeader><CardTitle className="text-base">Milestone Distribution</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4">
                {MILESTONE_BADGES.map(mb => {
                  const count = milestoneEmployees.filter(e => e.milestoneYears === mb.years).length;
                  return (
                    <div key={mb.years} className="text-center p-4 rounded-lg border hover:bg-muted/50 transition-colors">
                      <div className={cn("h-14 w-14 rounded-full bg-gradient-to-br flex items-center justify-center mx-auto mb-2 shadow", mb.color)}>
                        <mb.icon className="h-7 w-7 text-white" />
                      </div>
                      <p className="font-semibold text-lg">{count}</p>
                      <p className="text-xs text-muted-foreground">{mb.label} milestone</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* All Celebrations List */}
          <Card>
            <CardHeader><CardTitle className="text-base">Recent Celebrations</CardTitle></CardHeader>
            <CardContent>
              {celebrations.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No celebrations recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {celebrations.slice(0, 15).map(c => {
                    const conf = TYPE_CONF[c.type] || TYPE_CONF.anniversary;
                    return (
                      <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                        <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center", conf.className)}>
                          <conf.icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{c.employeeName}</p>
                          <p className="text-xs text-muted-foreground">{c.department} &middot; {c.details}</p>
                        </div>
                        <div className="text-right">
                          <Badge className={cn("text-xs", conf.className)}>{conf.label}</Badge>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {c.date ? new Date(c.date).toLocaleDateString() : "—"}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Send Wish Dialog */}
      <Dialog open={wishOpen} onOpenChange={setWishOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-500" />
              Send Wishes {wishTarget?.employeeName ? `to ${wishTarget.employeeName}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Your Message</Label>
              <Textarea placeholder="Write your wishes..." value={wishMessage} onChange={e => setWishMessage(e.target.value)} rows={4} />
            </div>
            <div className="flex gap-2 flex-wrap">
              {["Happy Birthday! 🎂", "Congratulations! 🎉", "Great milestone! 🏆", "Well done! ⭐"].map(quick => (
                <Button key={quick} size="sm" variant="outline" onClick={() => setWishMessage(quick)}>{quick}</Button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWishOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={handleSendWish}>
              <Send className="h-4 w-4" /> Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
