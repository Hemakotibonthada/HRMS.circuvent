"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bell, CalendarDays, DollarSign, UserPlus, CheckCircle2,
  AlertCircle, X, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clickable } from "@/lib/a11y/clickable";

/**
 * A notification, as the server derives it.
 *
 * There is no `time` and no `avatar`. Both were props of the hardcoded set —
 * "5 min ago", "RG" — and both were fiction. A notification here describes
 * outstanding work rather than a past event, so there is no moment to stamp
 * and nobody to attribute it to.
 */
interface Notification {
  id: string;
  title: string;
  message: string;
  type: "leave" | "expense" | "onboarding" | "offboarding" | "payroll" | "system";
  href: string;
  read: boolean;
}

const TYPE_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  leave: { icon: CalendarDays, color: "text-amber-500" },
  expense: { icon: DollarSign, color: "text-emerald-500" },
  payroll: { icon: DollarSign, color: "text-emerald-500" },
  onboarding: { icon: UserPlus, color: "text-violet-500" },
  offboarding: { icon: AlertCircle, color: "text-orange-500" },
  system: { icon: CheckCircle2, color: "text-gray-500" },
};

export function NotificationCenter() {
  const router = useRouter();
  /**
   * Real outstanding work, from `/api/notifications`.
   *
   * `useState(DEMO_NOTIFICATIONS)` seeded this with eight invented entries
   * about people who exist in no customer's organisation, and the unread
   * badge read 3 for everybody forever.
   */
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/notifications", { credentials: "include" });
        if (!response.ok) throw new Error();
        const body = (await response.json()) as { items: Omit<Notification, "read">[] };
        if (cancelled) return;
        setNotifications((body.items ?? []).map((item) => ({ ...item, read: false })));
        setFailed(false);
      } catch {
        // An empty bell and a broken bell are different things, and the badge
        // must not imply "all clear" when nothing was read.
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
  };

  /**
   * Marks it read and goes where the work is.
   *
   * These describe outstanding work, so the useful response to one is to act
   * on it. Marking read without navigating would leave the bell clear and the
   * approvals still waiting.
   */
  const openNotification = (n: Notification) => {
    markAsRead(n.id);
    router.push(n.href);
  };

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const removeNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <Sheet>
      <SheetTrigger
        className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground animate-pulse-glow">
            {unreadCount}
          </span>
        )}
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md p-0">
        <SheetHeader className="px-4 pt-4 pb-2">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base">Notifications</SheetTitle>
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={markAllRead}>
                <Check className="h-3 w-3 mr-1" /> Mark all read
              </Button>
            )}
          </div>
        </SheetHeader>

        <Tabs defaultValue="all" className="px-4">
          <TabsList className="w-full">
            <TabsTrigger value="all" className="flex-1">All ({notifications.length})</TabsTrigger>
            <TabsTrigger value="unread" className="flex-1">Unread ({unreadCount})</TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="mt-2">
            <NotificationList items={notifications} onOpen={openNotification} onRemove={removeNotification} loading={loading} failed={failed} />
          </TabsContent>
          <TabsContent value="unread" className="mt-2">
            <NotificationList items={notifications.filter((n) => !n.read)} onOpen={openNotification} onRemove={removeNotification} loading={loading} failed={failed} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function NotificationList({
  items,
  onOpen,
  onRemove,
  loading,
  failed,
}: {
  items: Notification[];
  onOpen: (n: Notification) => void;
  onRemove: (id: string) => void;
  loading: boolean;
  failed: boolean;
}) {
  if (loading) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (failed) {
    // Distinguished from "nothing to do". A bell that says "all clear" when it
    // failed to read is worse than one that admits it does not know.
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Notifications could not be loaded.
      </p>
    );
  }
  if (items.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Nothing needs your attention</p>;
  }
  return (
    <ScrollArea className="h-[calc(100vh-180px)]">
      <div className="space-y-1 pb-4">
        {items.map((n) => {
          const typeConfig = TYPE_ICONS[n.type] || TYPE_ICONS.system;
          const Icon = typeConfig.icon;
          return (
            <div
              key={n.id}
              {...clickable(() => onOpen(n), {
                label: `${n.title}. ${n.message}`,
              })}
              className={cn(
                "group relative flex gap-3 rounded-xl p-3 cursor-pointer transition-colors",
                n.read ? "hover:bg-muted/50" : "bg-primary/5 hover:bg-primary/10"
              )}
            >
              <div className={cn("flex h-9 w-9 shrink-0 mt-0.5 items-center justify-center rounded-lg bg-muted", typeConfig.color)}>
                <Icon className="h-4.5 w-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={cn("text-sm truncate", !n.read && "font-semibold")}>{n.title}</p>
                  {!n.read && <span className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                {/* No timestamp. These describe work that is outstanding now,
                    not an event that happened at a moment — the "5 min ago"
                    on the old entries was as invented as the entries. */}
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 shrink-0 mt-1"
                onClick={(e) => { e.stopPropagation(); onRemove(n.id); }}
                aria-label={`Dismiss "${n.title}"`}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
