"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bell, CalendarDays, DollarSign, UserPlus, CheckCircle2,
  Clock, AlertCircle, Award, X, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clickable } from "@/lib/a11y/clickable";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: "leave" | "payroll" | "attendance" | "recruitment" | "performance" | "system" | "award";
  time: string;
  read: boolean;
  avatar?: string;
}

const DEMO_NOTIFICATIONS: Notification[] = [
  { id: "1", title: "Leave Request", message: "Riya Gupta requested 3 days sick leave", type: "leave", time: "5 min ago", read: false, avatar: "RG" },
  { id: "2", title: "Payroll Processed", message: "March 2026 payroll has been processed for 1,248 employees", type: "payroll", time: "1 hr ago", read: false },
  { id: "3", title: "New Application", message: "Sarah Chen applied for Senior Full Stack Developer", type: "recruitment", time: "2 hrs ago", read: false, avatar: "SC" },
  { id: "4", title: "Performance Review Due", message: "Q1 2026 reviews for your team are due in 3 days", type: "performance", time: "3 hrs ago", read: true },
  { id: "5", title: "Late Arrival Alert", message: "5 employees arrived late today (after 10:00 AM)", type: "attendance", time: "4 hrs ago", read: true },
  { id: "6", title: "Award Given", message: "Vikram Mehta received Employee of the Month award", type: "award", time: "5 hrs ago", read: true, avatar: "VM" },
  { id: "7", title: "System Update", message: "HRMS v2.1 deployed with new Expense Management module", type: "system", time: "1 day ago", read: true },
  { id: "8", title: "Expense Claim", message: "Amit Shah submitted ₹12,500 expense for approval", type: "payroll", time: "1 day ago", read: true, avatar: "AS" },
];

const TYPE_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  leave: { icon: CalendarDays, color: "text-amber-500" },
  payroll: { icon: DollarSign, color: "text-emerald-500" },
  attendance: { icon: Clock, color: "text-blue-500" },
  recruitment: { icon: UserPlus, color: "text-violet-500" },
  performance: { icon: AlertCircle, color: "text-orange-500" },
  system: { icon: CheckCircle2, color: "text-gray-500" },
  award: { icon: Award, color: "text-yellow-500" },
};

export function NotificationCenter() {
  const [notifications, setNotifications] = useState(DEMO_NOTIFICATIONS);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
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
            <NotificationList items={notifications} onRead={markAsRead} onRemove={removeNotification} />
          </TabsContent>
          <TabsContent value="unread" className="mt-2">
            <NotificationList items={notifications.filter((n) => !n.read)} onRead={markAsRead} onRemove={removeNotification} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function NotificationList({ items, onRead, onRemove }: { items: Notification[]; onRead: (id: string) => void; onRemove: (id: string) => void }) {
  if (items.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No notifications</p>;
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
              {...clickable(() => !n.read && onRead(n.id), {
                // Unread items act; read ones have nothing left to do, and a
                // focus stop that does nothing is noise in the tab order.
                disabled: n.read,
                label: n.read ? undefined : `Mark "${n.title}" as read`,
              })}
              className={cn(
                "group relative flex gap-3 rounded-xl p-3 cursor-pointer transition-colors",
                n.read ? "hover:bg-muted/50" : "bg-primary/5 hover:bg-primary/10"
              )}
            >
              {n.avatar ? (
                <Avatar className="h-9 w-9 mt-0.5 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{n.avatar}</AvatarFallback>
                </Avatar>
              ) : (
                <div className={cn("flex h-9 w-9 shrink-0 mt-0.5 items-center justify-center rounded-lg bg-muted", typeConfig.color)}>
                  <Icon className="h-4.5 w-4.5" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={cn("text-sm truncate", !n.read && "font-semibold")}>{n.title}</p>
                  {!n.read && <span className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{n.time}</p>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 shrink-0 mt-1"
                onClick={(e) => { e.stopPropagation(); onRemove(n.id); }}
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