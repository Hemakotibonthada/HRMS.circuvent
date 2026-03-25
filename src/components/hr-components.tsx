"use client";

import { useState, useCallback, useMemo, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown,
  ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight,
  Search, Filter, Download, MoreHorizontal, X, Check,
  ChevronDown, ChevronUp, Eye, Edit, Trash2, Copy,
  ExternalLink, RefreshCw, Loader2, AlertTriangle,
  CheckCircle2, Info, XCircle, Star,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════
// COMPREHENSIVE SHARED UI COMPONENT LIBRARY
// Reusable components for KPI cards, data tables, status badges,
// metric displays, pagination, search, and more
// ═══════════════════════════════════════════════════════════════

// ─── KPI Stat Card ───────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  change?: string;
  trend?: "up" | "down" | "neutral";
  icon?: LucideIcon;
  color?: string;
  onClick?: () => void;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function StatCard({
  label, value, change, trend, icon: Icon, color = "from-violet-500 to-purple-600",
  onClick, className, size = "md",
}: StatCardProps) {
  return (
    <Card className={cn("group hover:shadow-md transition-all", onClick && "cursor-pointer", className)} onClick={onClick}>
      <CardContent className={cn("flex items-center gap-3.5", size === "sm" ? "p-3" : size === "lg" ? "p-5" : "p-4")}>
        {Icon && (
          <div className={cn(
            "shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md transition-transform group-hover:scale-110 flex",
            color,
            size === "sm" ? "h-9 w-9" : size === "lg" ? "h-14 w-14" : "h-11 w-11"
          )}>
            <Icon className={cn(size === "sm" ? "h-4 w-4" : size === "lg" ? "h-7 w-7" : "h-5 w-5")} />
          </div>
        )}
        <div className="min-w-0">
          <p className={cn("font-medium text-muted-foreground uppercase tracking-wider",
            size === "sm" ? "text-[8px]" : size === "lg" ? "text-xs" : "text-[10px]"
          )}>{label}</p>
          <p className={cn("font-bold",
            size === "sm" ? "text-lg" : size === "lg" ? "text-3xl" : "text-2xl"
          )}>{value}</p>
          {change && (
            <p className={cn("flex items-center gap-0.5",
              size === "sm" ? "text-[9px]" : "text-[10px]",
              trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-600" : "text-muted-foreground"
            )}>
              {trend === "up" && <ArrowUpRight className="h-2.5 w-2.5" />}
              {trend === "down" && <ArrowDownRight className="h-2.5 w-2.5" />}
              {change}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Status Badge ────────────────────────────────────────────

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const STATUS_STYLES: Record<string, string> = {
  active: "status-active",
  approved: "status-active",
  completed: "status-active",
  resolved: "status-active",
  compliant: "status-active",
  confirmed: "status-active",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  pending: "status-pending",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  on_track: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  at_risk: "status-pending",
  due_soon: "status-pending",
  on_hold: "status-pending",
  probation: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  notice_period: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  rejected: "status-rejected",
  overdue: "status-rejected",
  critical: "status-rejected",
  failed: "status-rejected",
  behind: "status-rejected",
  terminated: "status-rejected",
  inactive: "status-inactive",
  cancelled: "status-inactive",
  closed: "status-inactive",
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  open: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  wfh: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  remote: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  present: "status-active",
  absent: "status-rejected",
  late: "status-pending",
  on_leave: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

export function StatusBadge({ status, size = "md", className }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  const label = status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return (
    <Badge className={cn(
      "border-0",
      style,
      size === "sm" ? "text-[7px] px-1.5 py-0" : size === "lg" ? "text-xs" : "text-[9px]",
      className
    )}>
      {label}
    </Badge>
  );
}

// ─── Avatar with Gradient ────────────────────────────────────

const AVATAR_GRADIENTS = [
  "from-violet-500 to-purple-600","from-blue-500 to-cyan-500","from-emerald-500 to-green-600",
  "from-amber-500 to-orange-500","from-pink-500 to-rose-600","from-teal-500 to-cyan-600",
  "from-indigo-500 to-blue-600","from-red-500 to-orange-500","from-fuchsia-500 to-pink-500",
  "from-purple-500 to-violet-600",
];

interface GradientAvatarProps {
  name: string;
  index?: number;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function GradientAvatar({ name, index = 0, size = "md", className }: GradientAvatarProps) {
  const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) || "?";
  const gradient = AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length];
  const sizeClass = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-12 w-12" : size === "xl" ? "h-16 w-16" : "h-9 w-9";
  const textSize = size === "sm" ? "text-[8px]" : size === "lg" ? "text-sm" : size === "xl" ? "text-lg" : "text-[10px]";

  return (
    <Avatar className={cn(sizeClass, className)}>
      <AvatarFallback className={cn(`bg-gradient-to-br ${gradient} text-white font-semibold`, textSize)}>
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

// ─── Metric Gauge (Circular Progress) ────────────────────────

interface MetricGaugeProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
  showValue?: boolean;
  className?: string;
}

export function MetricGauge({
  value, max = 100, size = 80, strokeWidth = 8,
  color = "#8b5cf6", label, showValue = true, className,
}: MetricGaugeProps) {
  const pct = Math.min(100, (value / max) * 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="-rotate-90" width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-muted" />
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} stroke={color} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-700" />
        </svg>
        {showValue && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold">{Math.round(pct)}%</span>
          </div>
        )}
      </div>
      {label && <p className="text-[10px] text-muted-foreground mt-1.5 text-center">{label}</p>}
    </div>
  );
}

// ─── Data Table Pagination ───────────────────────────────────

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  className?: string;
}

export function DataPagination({
  currentPage, totalPages, totalItems, pageSize,
  onPageChange, onPageSizeChange, className,
}: PaginationProps) {
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className={cn("flex items-center justify-between px-4 py-3 border-t text-xs", className)}>
      <p className="text-muted-foreground">
        Showing {totalItems > 0 ? startItem : 0}–{endItem} of {totalItems}
      </p>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage <= 1} onClick={() => onPageChange(1)}>
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="px-2 text-muted-foreground">{currentPage} / {totalPages || 1}</span>
        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage >= totalPages} onClick={() => onPageChange(totalPages)}>
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Search Bar with Filters ─────────────────────────────────

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  filterCount?: number;
  onClear?: () => void;
  className?: string;
  children?: ReactNode;
}

export function SearchBar({ value, onChange, placeholder = "Search...", filterCount, onClear, className, children }: SearchBarProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9 h-9 pr-8" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
        {value && (
          <button className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground" onClick={() => onChange("")}>
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {children}
      {filterCount !== undefined && filterCount > 0 && (
        <Badge variant="outline" className="text-[9px] gap-1">
          <Filter className="h-2.5 w-2.5" />{filterCount} active
          {onClear && <button onClick={onClear}><X className="h-2.5 w-2.5 ml-0.5" /></button>}
        </Badge>
      )}
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────

interface EmptyCardProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyCard({ icon: Icon = Info, title, description, actionLabel, onAction, className }: EmptyCardProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 text-center", className)}>
      <div className="rounded-2xl bg-muted/50 p-4 mb-4">
        <Icon className="h-8 w-8 text-muted-foreground/40" />
      </div>
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      {description && <p className="text-xs text-muted-foreground mt-1 max-w-sm">{description}</p>}
      {actionLabel && onAction && (
        <Button className="mt-4 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

// ─── Loading Spinner ─────────────────────────────────────────

export function LoadingSpinner({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center", className)}>
      <Loader2 className={cn("animate-spin text-violet-500",
        size === "sm" ? "h-4 w-4" : size === "lg" ? "h-8 w-8" : "h-6 w-6"
      )} />
    </div>
  );
}

// ─── Alert Banner ────────────────────────────────────────────

interface AlertBannerProps {
  type: "info" | "success" | "warning" | "error";
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
}

const ALERT_CONFIG = {
  info: { icon: Info, bg: "bg-blue-50 dark:bg-blue-950/20", border: "border-blue-200 dark:border-blue-800/30", text: "text-blue-700 dark:text-blue-400" },
  success: { icon: CheckCircle2, bg: "bg-emerald-50 dark:bg-emerald-950/20", border: "border-emerald-200 dark:border-emerald-800/30", text: "text-emerald-700 dark:text-emerald-400" },
  warning: { icon: AlertTriangle, bg: "bg-amber-50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-800/30", text: "text-amber-700 dark:text-amber-400" },
  error: { icon: XCircle, bg: "bg-red-50 dark:bg-red-950/20", border: "border-red-200 dark:border-red-800/30", text: "text-red-700 dark:text-red-400" },
};

export function AlertBanner({ type, title, description, action, dismissible, onDismiss, className }: AlertBannerProps) {
  const config = ALERT_CONFIG[type];
  const Icon = config.icon;

  return (
    <div className={cn("rounded-lg border p-4 flex items-start gap-3", config.bg, config.border, className)}>
      <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", config.text)} />
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-semibold", config.text)}>{title}</p>
        {description && <p className={cn("text-xs mt-0.5", config.text, "opacity-80")}>{description}</p>}
        {action && (
          <Button variant="outline" size="sm" className="mt-2 text-xs h-7" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
      {dismissible && onDismiss && (
        <button className={cn("text-muted-foreground hover:text-foreground")} onClick={onDismiss}>
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ─── Trend Indicator ─────────────────────────────────────────

interface TrendIndicatorProps {
  value: number;
  previousValue: number;
  format?: "percent" | "number" | "currency";
  className?: string;
}

export function TrendIndicator({ value, previousValue, format = "percent", className }: TrendIndicatorProps) {
  const change = previousValue > 0 ? ((value - previousValue) / previousValue) * 100 : 0;
  const isPositive = change >= 0;

  let displayValue: string;
  switch (format) {
    case "percent": displayValue = `${Math.abs(Math.round(change * 10) / 10)}%`; break;
    case "number": displayValue = Math.abs(Math.round(value - previousValue)).toString(); break;
    case "currency": displayValue = `₹${Math.abs(Math.round(value - previousValue)).toLocaleString("en-IN")}`; break;
  }

  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium",
      isPositive ? "text-emerald-600" : "text-red-600",
      className
    )}>
      {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {displayValue}
    </span>
  );
}

// ─── Progress Card ───────────────────────────────────────────

interface ProgressCardProps {
  title: string;
  current: number;
  total: number;
  unit?: string;
  color?: string;
  className?: string;
}

export function ProgressCard({ title, current, total, unit = "", color, className }: ProgressCardProps) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className={cn("rounded-lg border p-3", className)}>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-medium">{title}</p>
        <span className="text-xs font-bold">{current}{unit} / {total}{unit}</span>
      </div>
      <Progress value={pct} className="h-2" />
      <p className="text-[9px] text-muted-foreground mt-1">{pct}% complete</p>
    </div>
  );
}

// ─── Action Button Group ─────────────────────────────────────

interface ActionButtonGroupProps {
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  className?: string;
}

export function ActionButtonGroup({ onView, onEdit, onDelete, onCopy, className }: ActionButtonGroupProps) {
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {onView && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onView}><Eye className="h-3.5 w-3.5" /></Button>}
      {onEdit && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit}><Edit className="h-3.5 w-3.5" /></Button>}
      {onCopy && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onCopy}><Copy className="h-3.5 w-3.5" /></Button>}
      {onDelete && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>}
    </div>
  );
}

// ─── Page Header ─────────────────────────────────────────────

interface PageHeaderProps {
  title: string;
  description?: string;
  actionLabel?: string;
  actionIcon?: LucideIcon;
  onAction?: () => void;
  secondaryActions?: Array<{ label: string; onClick: () => void; icon?: LucideIcon; variant?: "outline" | "ghost" }>;
  className?: string;
}

export function PageHeader({ title, description, actionLabel, actionIcon: ActionIcon, onAction, secondaryActions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between animate-slide-up", className)}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground text-sm mt-0.5">{description}</p>}
      </div>
      <div className="flex items-center gap-2">
        {secondaryActions?.map(action => (
          <Button key={action.label} variant={action.variant ?? "outline"} size="sm" className="text-xs gap-1" onClick={action.onClick}>
            {action.icon && <action.icon className="h-3 w-3" />}
            {action.label}
          </Button>
        ))}
        {actionLabel && onAction && (
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2" onClick={onAction}>
            {ActionIcon && <ActionIcon className="h-4 w-4" />}
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── KPI Grid ────────────────────────────────────────────────

interface KPIGridProps {
  items: Array<{
    label: string;
    value: string | number;
    icon?: LucideIcon;
    color?: string;
    change?: string;
    trend?: "up" | "down" | "neutral";
  }>;
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}

export function KPIGrid({ items, columns = 4, className }: KPIGridProps) {
  const gridCols = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
    5: "sm:grid-cols-2 lg:grid-cols-5",
    6: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
  };

  return (
    <div className={cn("grid gap-3 stagger-children", gridCols[columns], className)}>
      {items.map(kpi => (
        <StatCard key={kpi.label} {...kpi} />
      ))}
    </div>
  );
}

// ─── Chart Tooltip ───────────────────────────────────────────

export function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5" style={{ color: p.color }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          {p.name}: <span className="font-bold">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

// ─── Rating Stars ────────────────────────────────────────────

interface RatingStarsProps {
  value: number;
  max?: number;
  size?: "sm" | "md" | "lg";
  onChange?: (value: number) => void;
  className?: string;
}

export function RatingStars({ value, max = 5, size = "md", onChange, className }: RatingStarsProps) {
  const iconSize = size === "sm" ? "h-3 w-3" : size === "lg" ? "h-5 w-5" : "h-4 w-4";
  return (
    <div className={cn("flex gap-0.5", className)}>
      {Array.from({ length: max }, (_, i) => (
        <button key={i} type="button" className="focus:outline-none" onClick={() => onChange?.(i + 1)} disabled={!onChange}>
          <Star className={cn(iconSize, i < value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")} />
        </button>
      ))}
      {size !== "sm" && <span className="text-xs font-bold ml-1">{value.toFixed(1)}</span>}
    </div>
  );
}

// ─── Quick Stat Line ─────────────────────────────────────────

interface QuickStatProps {
  label: string;
  value: string | number;
  color?: string;
  className?: string;
}

export function QuickStat({ label, value, color, className }: QuickStatProps) {
  return (
    <div className={cn("flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-bold", color)}>{value}</span>
    </div>
  );
}

// ─── Chart Colors ────────────────────────────────────────────

export const CHART_COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6","#f97316","#a855f7"];
export const GRADIENT_PAIRS = [
  "from-violet-500 to-purple-600","from-blue-500 to-cyan-500","from-emerald-500 to-green-600",
  "from-amber-500 to-orange-500","from-pink-500 to-rose-600","from-teal-500 to-cyan-600",
  "from-indigo-500 to-blue-600","from-red-500 to-orange-500","from-fuchsia-500 to-pink-500",
  "from-purple-500 to-violet-600",
];
