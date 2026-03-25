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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Megaphone, Plus, Search, Pin, PinOff, Calendar,
  Eye, Trash2, Clock, FileText, Bell, Filter,
  TrendingUp, Archive, Star, Send, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRBAC } from "@/hooks/use-rbac";
import { useAnnouncementStore, startSync, type AnnouncementDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/firestore-service";
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
  const { items, loading, initialized } = store;

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

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.announcements, store); }, [initialized, store]);

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

      {/* Create Announcement Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>New Announcement</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input placeholder="Announcement title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Content *</Label>
              <Textarea placeholder="Write your announcement..." value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} rows={4} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Target Audience</Label>
                <Select value={form.targetAudience} onValueChange={v => setForm(f => ({ ...f, targetAudience: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{AUDIENCES.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Author</Label>
                <Input placeholder="Your name" value={form.author} onChange={e => setForm(f => ({ ...f, author: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Schedule Date</Label>
                <Input type="date" value={form.scheduledDate} onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.pinned} onCheckedChange={v => setForm(f => ({ ...f, pinned: v }))} />
              <Label>Pin this announcement</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={handleCreate}>
              <Send className="h-4 w-4" /> Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Announcement Dialog */}
      <Dialog open={!!viewAnn} onOpenChange={() => setViewAnn(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {viewAnn?.pinned && <Pin className="h-4 w-4 text-amber-500" />}
              {viewAnn?.title}
            </DialogTitle>
          </DialogHeader>
          {viewAnn && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge className={cn("text-xs", CATEGORY_COLORS[viewAnn.category] || CATEGORY_COLORS.General)}>{viewAnn.category}</Badge>
                <Badge className={cn("text-xs", STATUS_CONF[viewAnn.status]?.className || "status-active")}>{STATUS_CONF[viewAnn.status]?.label || viewAnn.status}</Badge>
              </div>
              <p className="text-sm whitespace-pre-wrap">{viewAnn.content}</p>
              <Separator />
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>By {viewAnn.author || "Admin"}</span>
                <span>{viewAnn.publishedAt ? new Date(viewAnn.publishedAt).toLocaleString() : "—"}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
