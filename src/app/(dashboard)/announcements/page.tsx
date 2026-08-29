"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Megaphone, Plus, Search, Pin, PinOff, Calendar,
  Eye, Trash2, Clock, FileText, Bell, Filter,
  TrendingUp, Archive, Star, Send, Users, Sparkles, User, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRBAC } from "@/hooks/use-rbac";
import { useAnnouncementStore, useEmployeeStore, startSync, type AnnouncementDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, AreaChart, Area,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// ANNOUNCEMENTS — Full announcement system with create, pin,
// category filtering, scheduling, and analytics
// ═══════════════════════════════════════════════════════════════

const CATEGORIES = ["General", "Policy Update", "Event", "Urgent", "HR", "IT", "Safety", "Benefits"];
const AUDIENCES = ["All Employees", "Engineering", "HR", "Sales", "Marketing", "Finance", "Management"];
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "status-active" },
  published: { label: "Published", className: "status-active" },
  scheduled: { label: "Scheduled", className: "status-pending" },
  archived: { label: "Archived", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  draft: { label: "Draft", className: "status-pending" },
};
const CATEGORY_COLORS: Record<string, string> = {
  General: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "Policy Update": "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  Event: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Urgent: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  HR: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  IT: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  Safety: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Benefits: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

export default function AnnouncementsPage() {
  const rbac = useRBAC();
  const store = useAnnouncementStore();
  const empStore = useEmployeeStore();
  const { items, loading, initialized } = store;
  const { items: employees, initialized: empInit } = empStore;

  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [tab, setTab] = useState("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewAnn, setViewAnn] = useState<AnnouncementDoc | null>(null);
  const [form, setForm] = useState({
    title: "", content: "", category: "General", author: "",
    targetAudience: "All Employees", scheduledDate: "",
    pinned: false, status: "active",
  });

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.announcements, store);
    if (!empInit) startSync(COLLECTIONS.employees, empStore);
  }, [initialized, store, empInit, empStore]);

  const filtered = useMemo(() => {
    let result = items;
    if (tab === "active") result = result.filter(a => a.status === "active" || a.status === "published");
    else if (tab === "scheduled") result = result.filter(a => a.status === "scheduled" || a.status === "draft");
    else if (tab === "archived") result = result.filter(a => a.status === "archived");
    if (search) { const q = search.toLowerCase(); result = result.filter(a => a.title?.toLowerCase().includes(q) || a.content?.toLowerCase().includes(q) || a.author?.toLowerCase().includes(q)); }
    if (catFilter !== "all") result = result.filter(a => a.category === catFilter);
    return result.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  }, [items, search, catFilter, tab]);

  const pinned = items.filter(a => a.pinned).length;
  const thisMonth = useMemo(() => {
    const now = new Date();
    return items.filter(a => {
      const d = a.publishedAt ? new Date(a.publishedAt) : null;
      return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
  }, [items]);
  const urgent = items.filter(a => a.category === "Urgent").length;

  const monthlyData = useMemo(() => {
    const months: Record<string, number> = {};
    items.forEach(a => {
      if (!a.publishedAt) return;
      const d = new Date(a.publishedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months[key] = (months[key] || 0) + 1;
    });
    return Object.entries(months).sort().slice(-6).map(([month, count]) => ({ month, count }));
  }, [items]);

  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach(a => { const c = a.category || "General"; map[c] = (map[c] || 0) + 1; });
    return Object.entries(map).map(([name, count]) => ({ name, count }));
  }, [items]);

  const resetForm = () => setForm({ title: "", content: "", category: "General", author: "", targetAudience: "All Employees", scheduledDate: "", pinned: false, status: "active" });

  const handleCreate = async () => {
    if (!form.title || !form.content) { toast.error("Title and content are required"); return; }
    try {
      const status = form.scheduledDate ? "scheduled" : "active";
      await genericService(COLLECTIONS.announcements).create({
        ...form, status, publishedAt: form.scheduledDate || new Date().toISOString(),
      });
      toast.success("Announcement published!");
      setCreateOpen(false); resetForm();
    } catch { toast.error("Failed to create announcement"); }
  };

  const handleTogglePin = async (ann: AnnouncementDoc) => {
    try {
      await genericService(COLLECTIONS.announcements).update(ann.id, { pinned: !ann.pinned });
      store.updateItem(ann.id, { pinned: !ann.pinned });
      toast.success(ann.pinned ? "Unpinned" : "Pinned!");
    } catch { toast.error("Failed to update"); }
  };

  const handleArchive = async (id: string) => {
    try {
      await genericService(COLLECTIONS.announcements).update(id, { status: "archived" });
      store.updateItem(id, { status: "archived" });
      toast.success("Archived");
    } catch { toast.error("Failed to archive"); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this announcement?")) return;
    try {
      await genericService(COLLECTIONS.announcements).remove(id);
      store.removeItem(id);
      toast.success("Deleted");
    } catch { toast.error("Delete failed"); }
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Announcements</h1>
          <p className="text-muted-foreground mt-1">Company-wide communications and updates</p>
        </div>
        {rbac.can("announcements.create") && (
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-lg gap-2" onClick={() => { resetForm(); setCreateOpen(true); }}>
            <Plus className="h-4 w-4" /> New Announcement
          </Button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 stagger-children">
        {[
          { label: "Total", value: items.length, icon: Megaphone, gradient: "from-violet-500 to-purple-600" },
          { label: "Pinned", value: pinned, icon: Pin, gradient: "from-blue-500 to-cyan-500" },
          { label: "This Month", value: thisMonth, icon: Calendar, gradient: "from-emerald-500 to-green-600" },
          { label: "Urgent", value: urgent, icon: Bell, gradient: "from-red-500 to-orange-500" },
          { label: "Archived", value: items.filter(a => a.status === "archived").length, icon: Archive, gradient: "from-amber-500 to-orange-500" },
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

      {/* Search + Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search announcements..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active" className="gap-2"><Megaphone className="h-4 w-4" /> Active</TabsTrigger>
          <TabsTrigger value="scheduled" className="gap-2"><Clock className="h-4 w-4" /> Scheduled</TabsTrigger>
          <TabsTrigger value="archived" className="gap-2"><Archive className="h-4 w-4" /> Archived</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2"><TrendingUp className="h-4 w-4" /> Analytics</TabsTrigger>
        </TabsList>

        {["active", "scheduled", "archived"].map(tabKey => (
          <TabsContent key={tabKey} value={tabKey} className="mt-4">
            {filtered.length === 0 ? (
              <DataEmptyState {...EMPTY_STATES.announcements} onAction={() => setCreateOpen(true)} />
            ) : (
              <div className="space-y-3 stagger-children">
                {filtered.map(ann => (
                  <Card key={ann.id} className="hover:shadow-md transition-shadow animate-slide-up">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0 mt-1">
                          <Megaphone className="h-5 w-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {ann.pinned && <Pin className="h-4 w-4 text-amber-500" />}
                            <h3 className="font-semibold">{ann.title}</h3>
                            <Badge className={cn("text-xs", CATEGORY_COLORS[ann.category] || CATEGORY_COLORS.General)}>
                              {ann.category}
                            </Badge>
                            <Badge className={cn("text-xs", STATUS_CONF[ann.status]?.className || "status-active")}>
                              {STATUS_CONF[ann.status]?.label || ann.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{ann.content}</p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {ann.author || "Admin"}</span>
                            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {ann.publishedAt ? new Date(ann.publishedAt).toLocaleDateString() : "—"}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setViewAnn(ann)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleTogglePin(ann)}>
                            {ann.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleArchive(ann.id)}>
                            <Archive className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => handleDelete(ann.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        ))}

        <TabsContent value="analytics" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Announcements Over Time</CardTitle></CardHeader>
              <CardContent>
                {monthlyData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="month" fontSize={11} />
                      <YAxis fontSize={11} />
                      <RTooltip />
                      <Area type="monotone" dataKey="count" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">By Category</CardTitle></CardHeader>
              <CardContent>
                {categoryData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={categoryData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="name" fontSize={11} />
                      <YAxis fontSize={11} />
                      <RTooltip />
                      <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Pinned Announcements Highlight */}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Pin className="h-4 w-4 text-amber-500" /> Pinned Announcements</CardTitle></CardHeader>
            <CardContent>
              {items.filter(a => a.pinned).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No pinned announcements.</p>
              ) : (
                <div className="space-y-2">
                  {items.filter(a => a.pinned).map(ann => (
                    <div key={ann.id} className="flex items-center justify-between p-3 rounded-lg border border-amber-200 dark:border-amber-800 hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <Pin className="h-4 w-4 text-amber-500" />
                        <div>
                          <p className="font-medium text-sm">{ann.title}</p>
                          <p className="text-xs text-muted-foreground">{ann.author || "Admin"} &middot; {ann.publishedAt ? new Date(ann.publishedAt).toLocaleDateString() : "—"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={cn("text-xs", CATEGORY_COLORS[ann.category] || CATEGORY_COLORS.General)}>{ann.category}</Badge>
                        <Button size="sm" variant="ghost" onClick={() => setViewAnn(ann)}><Eye className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Category Breakdown Table */}
          <Card>
            <CardHeader><CardTitle className="text-base">Category Breakdown</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {CATEGORIES.map(cat => {
                  const catItems = items.filter(a => a.category === cat);
                  const catPinned = catItems.filter(a => a.pinned).length;
                  const catActive = catItems.filter(a => a.status === "active" || a.status === "published").length;
                  const pct = items.length > 0 ? Math.round((catItems.length / items.length) * 100) : 0;
                  return (
                    <div key={cat} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                      <Badge className={cn("text-xs min-w-[80px] justify-center", CATEGORY_COLORS[cat] || CATEGORY_COLORS.General)}>{cat}</Badge>
                      <div className="flex-1">
                        <Progress value={pct} className="h-2" />
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{catItems.length} total</span>
                        <span>{catActive} active</span>
                        <span>{catPinned} pinned</span>
                        <span className="font-medium">{pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ENHANCED CREATE ANNOUNCEMENT DIALOG */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <Megaphone className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">New Company Announcement</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Publish or schedule corporate news, policy changes, and urgent workforce bulletins.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Announcement Title <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. Q3 All-Hands Meeting &amp; Product Roadmap Reveal"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="h-9 text-xs"
                required
              />
            </div>

            {/* Category Selector Cards */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Bulletin Category</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {CATEGORIES.map(cat => {
                  const active = form.category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, category: cat }))}
                      className={cn(
                        "p-2 rounded-lg border text-center transition-all cursor-pointer",
                        active
                          ? "bg-violet-50 dark:bg-violet-950/40 border-violet-500 text-violet-700 dark:text-violet-300 font-bold shadow-xs"
                          : "bg-background hover:bg-muted/50 text-muted-foreground border-border"
                      )}
                    >
                      <span className="text-xs">{cat}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Announcement Body &amp; Details <span className="text-destructive">*</span></Label>
              <Textarea
                placeholder="Write the full announcement details, highlights, links, or actionable instructions..."
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                rows={4}
                className="text-xs resize-none"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-violet-500" />
                  Published By (Author)
                </Label>
                {employees && employees.length > 0 ? (
                  <Select value={form.author} onValueChange={v => setForm(f => ({ ...f, author: v }))}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select publishing author..." />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map(emp => {
                        const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ") || String(emp.id);
                        const sub = [emp.designation, emp.department].filter(Boolean).join(" · ");
                        return (
                          <SelectItem key={emp.id} value={name} className="text-xs">
                            <span className="font-medium">{name}</span>
                            {sub ? <span className="text-muted-foreground ml-2 text-[11px]">({sub})</span> : null}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="e.g. HR Communications"
                    value={form.author}
                    onChange={e => setForm(f => ({ ...f, author: e.target.value }))}
                    className="h-9 text-xs"
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  Target Audience
                </Label>
                <Select value={form.targetAudience} onValueChange={v => setForm(f => ({ ...f, targetAudience: v }))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AUDIENCES.map(a => <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  Schedule Publication Date (Optional)
                </Label>
                <Input
                  type="date"
                  value={form.scheduledDate}
                  onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
                  className="h-9 text-xs"
                />
              </div>

              <div className="p-2.5 rounded-lg border bg-muted/20 flex items-center justify-between mt-4 sm:mt-0">
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Pin className="h-3.5 w-3.5 text-amber-500" /> Pin to Company Top
                  </p>
                  <p className="text-[10px] text-muted-foreground">Keep pinned on all employee dashboards</p>
                </div>
                <Switch checked={form.pinned} onCheckedChange={v => setForm(f => ({ ...f, pinned: v }))} />
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2 gap-2">
            <Button variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all gap-1.5" onClick={handleCreate}>
              <Send className="h-4 w-4" /> {form.scheduledDate ? "Schedule Bulletin" : "Publish Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* VIEW ANNOUNCEMENT DETAIL DIALOG */}
      <Dialog open={!!viewAnn} onOpenChange={() => setViewAnn(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <Megaphone className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg font-bold truncate flex items-center gap-2">
                  {viewAnn?.pinned && <Pin className="h-4 w-4 text-amber-500 shrink-0" />}
                  {viewAnn?.title}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Published by {viewAnn?.author || "Corporate HR"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {viewAnn && (
            <div className="space-y-4 mt-2">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <Badge className={cn("text-xs font-semibold", CATEGORY_COLORS[viewAnn.category] || CATEGORY_COLORS.General)}>
                  {viewAnn.category}
                </Badge>
                <Badge className={cn("text-xs", STATUS_CONF[viewAnn.status]?.className || "status-active")}>
                  {STATUS_CONF[viewAnn.status]?.label || viewAnn.status}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  Audience: {viewAnn.targetAudience || "All Employees"}
                </Badge>
              </div>

              <div className="p-4 rounded-xl border bg-muted/20">
                <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{viewAnn.content}</p>
              </div>

              <Separator />

              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Published: {viewAnn.publishedAt ? new Date(viewAnn.publishedAt).toLocaleString() : "—"}</span>
                {viewAnn.pinned && <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1"><Pin className="h-3 w-3" /> Pinned Bulletin</span>}
              </div>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setViewAnn(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
