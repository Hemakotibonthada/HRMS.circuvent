"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  TrendingUp, TrendingDown, Search, Filter, Download, Upload,
  Plus, X, ChevronRight, ChevronDown, MoreVertical, Eye,
  Edit, Trash2, Copy, ExternalLink, RefreshCw, Check,
  Calendar, Clock, Users, Star, Heart, AlertCircle,
  CheckCircle2, XCircle, ArrowRight, ArrowUp, ArrowDown,
  FileText, Send, Bell, Settings, Building2, MapPin,
  Phone, Mail, Globe, Lock, Unlock, Key, Shield,
  BarChart3, Target, Award, Briefcase, DollarSign,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ═══════════════════════════════════════════════════════════════════════
// SHARED UI COMPONENT LIBRARY
// Reusable patterns used across 80+ pages
// ═══════════════════════════════════════════════════════════════════════

// ─── FORMATTING UTILITIES ────────────────────────────────────────────

export const fmt = (n: number) => "₹" + n.toLocaleString("en-IN");
export const fmtUSD = (n: number) => "$" + n.toLocaleString("en-US");
export const fmtK = (n: number) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}K` : n.toString();
export const pct = (v: number, t: number) => Math.round((v / Math.max(t, 1)) * 100);
export const pluralize = (n: number, singular: string, plural?: string) => n === 1 ? `${n} ${singular}` : `${n} ${plural || singular + "s"}`;

export const timeAgo = (date: Date | string): string => {
  const now = new Date();
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
};

export const formatDate = (date: string | Date, format: "short" | "medium" | "long" = "medium"): string => {
  const d = typeof date === "string" ? new Date(date) : date;
  if (format === "short") return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  if (format === "long") return d.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
};

// ─── GRADIENT PALETTE ────────────────────────────────────────────────

export const GRADIENTS = [
  "from-violet-500 to-purple-600", "from-blue-500 to-cyan-500",
  "from-emerald-500 to-green-600", "from-amber-500 to-orange-500",
  "from-pink-500 to-rose-600", "from-indigo-500 to-blue-600",
  "from-teal-500 to-cyan-600", "from-red-500 to-orange-500",
  "from-fuchsia-500 to-pink-500", "from-sky-500 to-blue-500",
  "from-lime-500 to-green-500", "from-purple-500 to-violet-600",
];

export const getGradient = (index: number) => GRADIENTS[index % GRADIENTS.length];
export const getInitials = (name: string, max = 2) => name.split(" ").map(n => n[0]).join("").slice(0, max).toUpperCase();
export const generateColor = (str: string) => GRADIENTS[Math.abs(str.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % GRADIENTS.length];

// ─── STATUS CONFIGURATIONS ──────────────────────────────────────────

export const STATUS_STYLES = {
  active: "status-active",
  inactive: "status-inactive",
  pending: "status-pending",
  rejected: "status-rejected",
  success: "status-active",
  warning: "status-pending",
  error: "status-rejected",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  purple: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
};

export type StatusStyle = keyof typeof STATUS_STYLES;

// ─── STAT CARD COMPONENT ────────────────────────────────────────────

export interface StatCardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: "up" | "down" | "neutral";
  icon: LucideIcon;
  color: string;
  sub?: string;
  delay?: number;
  href?: string;
}

export function StatCard({ title, value, change, changeType, icon: Icon, color, sub, delay = 0 }: StatCardProps) {
  return (
    <div className="animate-slide-up" style={{ animationDelay: `${delay}ms` }}>
      <Card className="group relative overflow-hidden">
        <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-0 group-hover:opacity-[0.04] transition-opacity duration-500`} />
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
              <p className="mt-1.5 text-xl font-bold tracking-tight">{value}</p>
              {change && (
                <div className="mt-0.5 flex items-center gap-1 text-[10px]">
                  {changeType === "up" && <TrendingUp className="h-3 w-3 text-emerald-500" />}
                  {changeType === "down" && <TrendingDown className="h-3 w-3 text-red-500" />}
                  <span className={cn(
                    changeType === "up" && "text-emerald-600 dark:text-emerald-400",
                    changeType === "down" && "text-red-600 dark:text-red-400",
                    (!changeType || changeType === "neutral") && "text-muted-foreground"
                  )}>{change}</span>
                </div>
              )}
              {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
            </div>
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${color} text-white shadow-md transition-transform group-hover:scale-110`}>
              <Icon className="h-5 w-5" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── CHART TOOLTIP ───────────────────────────────────────────────────

export function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string;
}) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2 shadow-xl text-xs">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: <span className="font-semibold">{typeof p.value === "number" ? p.value.toLocaleString() : p.value}</span>
        </p>
      ))}
    </div>
  );
}

// ─── PAGE HEADER ─────────────────────────────────────────────────────

export function PageHeader({ title, description, children }: {
  title: string; description: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between animate-slide-up">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm mt-0.5">{description}</p>
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}

// ─── DATA TABLE WRAPPER ──────────────────────────────────────────────

export function DataTableEmpty({ icon: Icon = FileText, title, description, actionLabel, onAction }: {
  icon?: LucideIcon; title: string; description: string; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center animate-fade-in">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md mb-4">
        <Icon className="h-8 w-8" />
      </div>
      <h3 className="text-lg font-semibold mt-2">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-md">{description}</p>
      {actionLabel && onAction && (
        <Button onClick={onAction} className="mt-4 gap-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md">
          <Plus className="h-4 w-4" />{actionLabel}
        </Button>
      )}
    </div>
  );
}

// ─── SEARCH & FILTER BAR ─────────────────────────────────────────────

export function SearchBar({ value, onChange, placeholder = "Search...", className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <div className={cn("relative flex-1 max-w-sm", className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="pl-9" />
    </div>
  );
}

// ─── AVATAR WITH GRADIENT ────────────────────────────────────────────

export function GradientAvatar({ name, size = "md", index = 0, className }: {
  name: string; size?: "sm" | "md" | "lg"; index?: number; className?: string;
}) {
  const sizeClass = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-14 w-14" : "h-10 w-10";
  const textSize = size === "sm" ? "text-[9px]" : size === "lg" ? "text-lg" : "text-xs";
  const gradient = generateColor(name);
  return (
    <Avatar className={cn(sizeClass, className)}>
      <AvatarFallback className={`bg-gradient-to-br ${gradient} text-white ${textSize} font-semibold`}>
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

// ─── STATUS BADGE ────────────────────────────────────────────────────

export function StatusBadge({ status, label, icon: Icon, className }: {
  status: StatusStyle; label: string; icon?: LucideIcon; className?: string;
}) {
  return (
    <Badge className={cn("text-[10px] border-0 gap-0.5", STATUS_STYLES[status], className)}>
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </Badge>
  );
}

// ─── RATING STARS ────────────────────────────────────────────────────

export function RatingStars({ rating, max = 5, size = "sm", interactive, onChange }: {
  rating: number; max?: number; size?: "sm" | "md" | "lg";
  interactive?: boolean; onChange?: (v: number) => void;
}) {
  const s = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-6 w-6" : "h-5 w-5";
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => i + 1).map(v => (
        <button
          key={v}
          type="button"
          disabled={!interactive}
          className={cn("p-0", interactive && "cursor-pointer")}
          onClick={() => interactive && onChange?.(v)}
        >
          <Star className={cn(s, "transition-colors",
            v <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/20",
            interactive && "hover:text-amber-300"
          )} />
        </button>
      ))}
      {rating > 0 && <span className={cn("ml-1 font-semibold", size === "sm" ? "text-xs" : size === "lg" ? "text-base" : "text-sm")}>{rating.toFixed(1)}</span>}
    </div>
  );
}

// ─── PROGRESS RING ───────────────────────────────────────────────────

export function ProgressRing({ value, total, size = 80, strokeWidth = 2.5, label, className, strokeClass = "stroke-primary" }: {
  value: number; total: number; size?: number;
  strokeWidth?: number; label?: string;
  className?: string; strokeClass?: string;
}) {
  const percentage = pct(value, total);
  return (
    <div className={cn("text-center", className)}>
      <div className="relative mx-auto" style={{ width: size, height: size }}>
        <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
          <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-muted/30" />
          <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" strokeWidth={strokeWidth} strokeDasharray={`${percentage}, 100`}
            className={strokeClass} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold">{value}</span>
        </div>
      </div>
      {label && <p className="mt-1.5 text-xs font-medium text-muted-foreground">{label}</p>}
    </div>
  );
}

// ─── TIMELINE ────────────────────────────────────────────────────────

export interface TimelineItem {
  date: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  status?: StatusStyle;
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className="relative pl-6 space-y-4">
      <div className="absolute left-2 top-1 bottom-1 w-0.5 bg-border" />
      {items.map((item, i) => {
        const Icon = item.icon || CheckCircle2;
        return (
          <div key={i} className="relative">
            <div className="absolute -left-4 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary ring-2 ring-background">
              <Icon className="h-2.5 w-2.5 text-primary-foreground" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{item.title}</p>
                {item.status && <StatusBadge status={item.status} label={item.status} />}
              </div>
              {item.description && <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>}
              <p className="text-[10px] text-muted-foreground mt-0.5">{item.date}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── KANBAN COLUMN ───────────────────────────────────────────────────

export interface KanbanItem {
  id: string;
  title: string;
  subtitle?: string;
  avatar?: string;
  badges?: { label: string; style: StatusStyle }[];
  meta?: string;
}

export function KanbanColumn({ title, count, color, items, onItemClick }: {
  title: string; count: number; color: string;
  items: KanbanItem[]; onItemClick?: (id: string) => void;
}) {
  return (
    <div className="min-w-[260px] flex-shrink-0">
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className={cn("h-3 w-3 rounded-full", color)} />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        <Badge variant="outline" className="text-[10px] ml-auto">{count}</Badge>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <Card key={item.id} className="group cursor-pointer hover:shadow-md transition-all" onClick={() => onItemClick?.(item.id)}>
            <CardContent className="p-3.5">
              <div className="flex items-start gap-3">
                {item.avatar && <GradientAvatar name={item.avatar} size="sm" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  {item.subtitle && <p className="text-[10px] text-muted-foreground truncate">{item.subtitle}</p>}
                </div>
              </div>
              {item.badges && item.badges.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.badges.map((b, j) => <StatusBadge key={j} status={b.style} label={b.label} />)}
                </div>
              )}
              {item.meta && <p className="mt-2 text-[10px] text-muted-foreground">{item.meta}</p>}
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && <p className="text-center text-xs text-muted-foreground py-6">No items</p>}
      </div>
    </div>
  );
}

// ─── DETAIL SHEET (key-value pairs) ──────────────────────────────────

export interface DetailField {
  label: string;
  value: string | number | React.ReactNode;
  icon?: LucideIcon;
}

export function DetailSheet({ fields, columns = 2 }: { fields: DetailField[]; columns?: 2 | 3 }) {
  return (
    <div className={cn("grid gap-3", columns === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {fields.map(f => (
        <div key={f.label}>
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            {f.icon && <f.icon className="h-3 w-3" />}
            {f.label}
          </p>
          <p className="text-sm font-medium mt-0.5">{f.value}</p>
        </div>
      ))}
    </div>
  );
}

// ─── CONFIRM DIALOG ──────────────────────────────────────────────────

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", variant = "default", onConfirm }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  title: string; description: string;
  confirmLabel?: string; variant?: "default" | "destructive";
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={variant === "destructive" ? "destructive" : "default"}
            className={variant !== "destructive" ? "bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" : ""}
            onClick={() => { onConfirm(); onOpenChange(false); }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── METRIC COMPARISON ───────────────────────────────────────────────

export function MetricComparison({ label, current, previous, format = "number" }: {
  label: string; current: number; previous: number; format?: "number" | "currency" | "percent";
}) {
  const diff = current - previous;
  const diffPct = previous > 0 ? Math.round((diff / previous) * 100) : 0;
  const isUp = diff > 0;
  const formatted = format === "currency" ? fmt(current) : format === "percent" ? `${current}%` : current.toLocaleString();

  return (
    <div className="rounded-xl border p-4">
      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
      <p className="text-xl font-bold mt-1">{formatted}</p>
      <div className="mt-1 flex items-center gap-1 text-xs">
        {isUp ? <ArrowUp className="h-3 w-3 text-emerald-500" /> : <ArrowDown className="h-3 w-3 text-red-500" />}
        <span className={cn(isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
          {isUp ? "+" : ""}{diffPct}% ({isUp ? "+" : ""}{format === "currency" ? fmt(diff) : diff})
        </span>
        <span className="text-muted-foreground">vs prev</span>
      </div>
    </div>
  );
}

// ─── QUICK FILTER PILLS ─────────────────────────────────────────────

export function FilterPills({ options, value, onChange }: {
  options: { label: string; value: string; count?: number }[];
  value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
            value === opt.value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          )}
        >
          {opt.label}
          {opt.count !== undefined && (
            <span className={cn("rounded-full px-1.5 py-0.5 text-[9px]",
              value === opt.value ? "bg-primary-foreground/20" : "bg-background"
            )}>
              {opt.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── ACTIVITY FEED ITEM ──────────────────────────────────────────────

export interface ActivityItem {
  user: string;
  action: string;
  target?: string;
  time: string;
  icon?: LucideIcon;
  type?: "success" | "warning" | "info" | "error";
}

export function ActivityFeed({ items, maxItems }: { items: ActivityItem[]; maxItems?: number }) {
  const displayed = maxItems ? items.slice(0, maxItems) : items;
  return (
    <div className="space-y-4">
      {displayed.map((item, i) => {
        const Icon = item.icon || CheckCircle2;
        return (
          <div key={i} className="flex items-start gap-3">
            <GradientAvatar name={item.user} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-sm">
                <span className="font-medium">{item.user}</span>{" "}
                <span className="text-muted-foreground">{item.action}</span>
                {item.target && <span className="font-medium"> {item.target}</span>}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{item.time}</p>
            </div>
            {item.type === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-1 shrink-0" />}
            {item.type === "warning" && <AlertCircle className="h-4 w-4 text-amber-500 mt-1 shrink-0" />}
            {item.type === "error" && <XCircle className="h-4 w-4 text-red-500 mt-1 shrink-0" />}
          </div>
        );
      })}
    </div>
  );
}

// ─── APPROVAL ACTIONS ────────────────────────────────────────────────

export function ApprovalActions({ onApprove, onReject, size = "xs" }: {
  onApprove: () => void; onReject: () => void; size?: "xs" | "sm";
}) {
  return (
    <div className="flex gap-1.5 shrink-0">
      <Button size={size} className="bg-emerald-500 hover:bg-emerald-600 text-white border-0 h-7 px-2.5 text-xs" onClick={(e) => { e.stopPropagation(); onApprove(); }}>
        Approve
      </Button>
      <Button size={size} variant="outline" className="h-7 px-2.5 text-xs" onClick={(e) => { e.stopPropagation(); onReject(); }}>
        Reject
      </Button>
    </div>
  );
}

// ─── PERCENTAGE BAR ──────────────────────────────────────────────────

export function PercentageBar({ label, value, max, color, showLabel = true }: {
  label?: string; value: number; max: number; color?: string; showLabel?: boolean;
}) {
  const percentage = pct(value, max);
  return (
    <div className="space-y-1">
      {(label || showLabel) && (
        <div className="flex justify-between text-[10px] text-muted-foreground">
          {label && <span>{label}</span>}
          <span>{value} / {max} ({percentage}%)</span>
        </div>
      )}
      <Progress value={percentage} className="h-2" />
    </div>
  );
}

// ─── INSIGHT CARD ────────────────────────────────────────────────────

export type InsightType = "warning" | "opportunity" | "success" | "info";

const INSIGHT_STYLES: Record<InsightType, { borderClass: string; bgClass: string; iconClass: string; icon: LucideIcon }> = {
  warning: { borderClass: "border-l-amber-500", bgClass: "bg-amber-50/50 dark:bg-amber-950/10", iconClass: "text-amber-500", icon: AlertCircle },
  opportunity: { borderClass: "border-l-blue-500", bgClass: "bg-blue-50/50 dark:bg-blue-950/10", iconClass: "text-blue-500", icon: Target },
  success: { borderClass: "border-l-emerald-500", bgClass: "bg-emerald-50/50 dark:bg-emerald-950/10", iconClass: "text-emerald-500", icon: CheckCircle2 },
  info: { borderClass: "border-l-violet-500", bgClass: "bg-violet-50/50 dark:bg-violet-950/10", iconClass: "text-violet-500", icon: Bell },
};

export function InsightCard({ type, title, description, action, onAction }: {
  type: InsightType; title: string; description: string;
  action?: string; onAction?: () => void;
}) {
  const style = INSIGHT_STYLES[type];
  const Icon = style.icon;
  return (
    <Card className={cn("border-l-4", style.borderClass, style.bgClass)}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Icon className={cn("h-5 w-5 mt-0.5 shrink-0", style.iconClass)} />
          <div className="flex-1">
            <h4 className="text-sm font-semibold">{title}</h4>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
            {action && onAction && (
              <Button size="sm" variant="outline" className="mt-2 text-xs gap-1 h-7" onClick={onAction}>
                <ArrowRight className="h-3 w-3" />{action}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── FORM SECTION ────────────────────────────────────────────────────

export function FormSection({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="grid gap-4">{children}</div>
    </div>
  );
}

// ─── PRIORITY INDICATOR ──────────────────────────────────────────────

export function PriorityIndicator({ priority }: { priority: "low" | "medium" | "high" | "critical" | "urgent" }) {
  const config = {
    low: { label: "Low", style: "inactive" as StatusStyle },
    medium: { label: "Medium", style: "pending" as StatusStyle },
    high: { label: "High", style: "orange" as StatusStyle },
    critical: { label: "Critical", style: "rejected" as StatusStyle },
    urgent: { label: "Urgent", style: "rejected" as StatusStyle },
  };
  const c = config[priority];
  return <StatusBadge status={c.style} label={c.label} />;
}

// ─── EXPORT UTILITIES ────────────────────────────────────────────────

// Re-export everything for easy imports
export {
  Card, CardContent, CardHeader, CardTitle,
  Button, Badge, Avatar, AvatarFallback,
  Input, Label, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Progress, Separator, Switch, Checkbox,
  cn, toast,
};
