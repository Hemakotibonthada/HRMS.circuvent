"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Bell, Inbox, Star, StarOff, Check, X, Info, CheckCircle2,
  AlertTriangle, AlertCircle, Zap, Search, Filter, Eye,
  Trash2, Archive, MailOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useNotifStore, startSync, type NotificationDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { useNowMs } from "@/hooks/use-now";

// ═══════════════════════════════════════════════════════════════
// NOTIFICATIONS CENTER — All/Unread/Starred tabs, categories, KPIs
// ═══════════════════════════════════════════════════════════════

const TYPE_ICONS: Record<string, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
  action: Zap,
};
const TYPE_COLORS: Record<string, string> = {
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  error: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  action: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
};
const CATEGORIES = ["All", "Leave", "Attendance", "Payroll", "Helpdesk", "Announcement", "System", "Approval"];

export default function NotificationsPage() {
  const nowMs = useNowMs();
  const store = useNotifStore();
  const [tab, setTab] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!store.initialized) startSync(COLLECTIONS.notifications, store);
  }, [store]);

  const loading = store.loading && !store.initialized;

  const unreadCount = useMemo(() => store.items.filter(n => !n.read).length, [store.items]);
  const starredCount = useMemo(() => store.items.filter(n => n.starred).length, [store.items]);
  const actionCount = useMemo(() => store.items.filter(n => n.type === "action" && !n.read).length, [store.items]);

  const categories = useMemo(() => {
    const cats = new Set(store.items.map(n => n.category).filter(Boolean));
    return ["All", ...Array.from(cats)];
  }, [store.items]);

  const filtered = useMemo(() => {
    let list = store.items;
    if (tab === "unread") list = list.filter(n => !n.read);
    if (tab === "starred") list = list.filter(n => n.starred);
    if (categoryFilter !== "All") list = list.filter(n => n.category === categoryFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(n => n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q));
    }
    return list.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  }, [store.items, tab, categoryFilter, search]);

  const handleMarkRead = useCallback(async (notif: NotificationDoc) => {
    if (notif.read) return;
    try {
      await genericService(COLLECTIONS.notifications).update(notif.id, { read: true });
      store.updateItem(notif.id, { read: true } as Partial<NotificationDoc>);
    } catch { toast.error("Failed to mark as read"); }
  }, [store]);

  const handleToggleStar = useCallback(async (notif: NotificationDoc) => {
    const starred = !notif.starred;
    try {
      await genericService(COLLECTIONS.notifications).update(notif.id, { starred });
      store.updateItem(notif.id, { starred } as Partial<NotificationDoc>);
      toast.success(starred ? "Starred" : "Unstarred");
    } catch { toast.error("Failed to update"); }
  }, [store]);

  const handleDismiss = useCallback(async (notif: NotificationDoc) => {
    try {
      await genericService(COLLECTIONS.notifications).remove(notif.id);
      store.removeItem(notif.id);
      toast.success("Notification dismissed");
    } catch { toast.error("Failed to dismiss"); }
  }, [store]);

  const handleMarkAllRead = useCallback(async () => {
    const unread = store.items.filter(n => !n.read);
    if (unread.length === 0) return;
    try {
      await Promise.all(unread.map(n => genericService(COLLECTIONS.notifications).update(n.id, { read: true })));
      unread.forEach(n => store.updateItem(n.id, { read: true } as Partial<NotificationDoc>));
      toast.success(`${unread.length} notifications marked as read`);
    } catch { toast.error("Failed to mark all as read"); }
  }, [store]);

  const timeAgo = (ts: string) => {
    // Relative times are rendered text, so they cannot come from the
    // render-time clock without a hydration mismatch.
    if (!ts || nowMs === null) return "";
    const diff = nowMs - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  if (loading) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{store.items.length} total · {unreadCount} unread</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleMarkAllRead} disabled={unreadCount === 0}>
          <MailOpen className="h-4 w-4" /> Mark All Read
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total", value: store.items.length, icon: Bell, color: "from-violet-500 to-purple-600" },
          { label: "Unread", value: unreadCount, icon: Inbox, color: "from-red-500 to-rose-600" },
          { label: "Actions Pending", value: actionCount, icon: Zap, color: "from-amber-500 to-orange-500" },
          { label: "Starred", value: starredCount, icon: Star, color: "from-blue-500 to-cyan-500" },
        ].map(kpi => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.color)}>
                <kpi.icon className="h-5 w-5 text-white" />
              </div>
              <div><p className="text-xs text-muted-foreground">{kpi.label}</p><p className="text-lg font-bold">{kpi.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-4">
        <div className="hidden lg:block w-48 space-y-1 shrink-0">
          <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><Filter className="h-3 w-3" /> Categories</p>
          {categories.map(cat => (
            <Button
              key={cat}
              variant={categoryFilter === cat ? "default" : "ghost"}
              size="sm"
              className="w-full justify-start text-xs"
              onClick={() => setCategoryFilter(cat)}
            >{cat}</Button>
          ))}
        </div>

        <div className="flex-1 space-y-4">
          <div className="flex items-center gap-3">
            <Tabs value={tab} onValueChange={setTab} className="flex-1">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="unread">Unread ({unreadCount})</TabsTrigger>
                <TabsTrigger value="starred">Starred ({starredCount})</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search notifications…" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="lg:hidden">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>{categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.notifications} />
          ) : (
            <div className="space-y-2">
              {filtered.map(notif => {
                const Icon = TYPE_ICONS[notif.type] || Info;
                const colorCls = TYPE_COLORS[notif.type] || TYPE_COLORS.info;
                return (
                  <Card
                    key={notif.id}
                    className={cn(
                      "hover:shadow-md transition-all cursor-pointer",
                      !notif.read && "border-l-4 border-l-violet-500 bg-violet-50/30 dark:bg-violet-900/10",
                    )}
                    onClick={() => handleMarkRead(notif)}
                  >
                    <CardContent className="p-4 flex items-start gap-3">
                      <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5", colorCls)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className={cn("text-sm truncate", !notif.read && "font-semibold")}>{notif.title}</h3>
                          {notif.category && <Badge variant="secondary" className="text-[10px] shrink-0">{notif.category}</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                        <span className="text-[10px] text-muted-foreground mt-1 block">{timeAgo(notif.timestamp)}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          onClick={e => { e.stopPropagation(); handleToggleStar(notif); }}
                        >
                          {notif.starred ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> : <StarOff className="h-3.5 w-3.5 text-muted-foreground" />}
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-500"
                          onClick={e => { e.stopPropagation(); handleDismiss(notif); }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}