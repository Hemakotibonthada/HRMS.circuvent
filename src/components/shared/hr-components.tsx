"use client";

import React, { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowUpDown, ArrowUp, ArrowDown, Search, Filter, X, Download,
  Eye, Edit, Trash2, MoreHorizontal, CheckCircle2, XCircle,
  Clock, AlertTriangle, TrendingUp, TrendingDown, Minus,
  Star, Copy, ExternalLink, Mail, Phone, MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

// ═══════════════════════════════════════════════════════════════
// SHARED UI COMPONENT LIBRARY — Comprehensive reusable
// components for the Circuvent HRMS platform including tables,
// stat cards, charts, filters, pagination, and widgets
// ═══════════════════════════════════════════════════════════════

// ─── Gradient Stat Card ──────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  change?: string;
  trend?: "up" | "down" | "neutral";
  icon: LucideIcon;
  gradient: string;
  onClick?: () => void;
}

export function StatCard({ label, value, change, trend, icon: Icon, gradient, onClick }: StatCardProps) {
  return (
    <Card className={cn("group hover:shadow-md transition-all", onClick && "cursor-pointer")} onClick={onClick}>
      <CardContent className="flex items-center gap-3.5 p-4">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-md transition-transform group-hover:scale-110`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider truncate">{label}</p>
          <p className="text-xl font-bold leading-tight">{value}</p>
          {change && (
            <p className={cn("text-[10px] flex items-center gap-0.5 truncate", trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-600" : "text-muted-foreground")}>
              {trend === "up" && <TrendingUp className="h-2.5 w-2.5" />}
              {trend === "down" && <TrendingDown className="h-2.5 w-2.5" />}
              {trend === "neutral" && <Minus className="h-2.5 w-2.5" />}
              {change}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Data Table ──────────────────────────────────────────────

interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  width?: string;
  align?: "left" | "center" | "right";
  render?: (item: T, index: number) => React.ReactNode;
}

interface DataTableProps<T extends Record<string, unknown>> {
  data: T[];
  columns: Column<T>[];
  searchable?: boolean;
  searchPlaceholder?: string;
  pageSize?: number;
  onRowClick?: (item: T) => void;
  selectedIds?: Set<string>;
  onSelect?: (id: string) => void;
  idKey?: string;
  emptyMessage?: string;
  actions?: Array<{ label: string; icon: LucideIcon; onClick: (item: T) => void; variant?: string }>;
  footer?: React.ReactNode;
}

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  searchable = true,
  searchPlaceholder = "Search...",
  pageSize = 10,
  onRowClick,
  emptyMessage = "No data available",
  actions,
  footer,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let result = [...data];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((item) =>
        Object.values(item).some((v) => String(v).toLowerCase().includes(q))
      );
    }
    if (sortKey) {
      result.sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        if (aVal == null || bVal == null) return 0;
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }, [data, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }, [sortKey]);

  return (
    <div className="space-y-3">
      {searchable && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input className="pl-8 h-8 text-xs" placeholder={searchPlaceholder} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            {search && (
              <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setSearch("")}>
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0">{filtered.length} results</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/30">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn("py-2.5 px-3 font-semibold", col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "text-left", col.sortable && "cursor-pointer hover:bg-muted/50 select-none")}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <div className={cn("flex items-center gap-1", col.align === "center" && "justify-center", col.align === "right" && "justify-end")}>
                    {col.label}
                    {col.sortable && sortKey === col.key && (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    {col.sortable && sortKey !== col.key && <ArrowUpDown className="h-3 w-3 text-muted-foreground/40" />}
                  </div>
                </th>
              ))}
              {actions && <th className="py-2.5 px-3 text-center font-semibold">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="text-center py-12 text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginated.map((item, i) => (
                <tr
                  key={i}
                  className={cn("border-b last:border-0 hover:bg-muted/50 transition-colors", onRowClick && "cursor-pointer")}
                  onClick={() => onRowClick?.(item)}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cn("py-2.5 px-3", col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "")}>
                      {col.render ? col.render(item, (page - 1) * pageSize + i) : String(item[col.key] ?? "")}
                    </td>
                  ))}
                  {actions && (
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {actions.map((action) => (
                          <Button key={action.label} variant="ghost" size="sm" className="h-6 w-6 p-0" title={action.label} onClick={(e) => { e.stopPropagation(); action.onClick(item); }}>
                            <action.icon className="h-3.5 w-3.5" />
                          </Button>
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page === 1} onClick={() => setPage(1)}><ChevronsLeft className="h-3 w-3" /></Button>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-3 w-3" /></Button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const startPage = Math.max(1, Math.min(page - 2, totalPages - 4));
              const p = startPage + i;
              return p <= totalPages ? (
                <Button key={p} variant={p === page ? "default" : "outline"} size="sm" className={cn("h-7 w-7 p-0 text-[10px]", p === page && "bg-violet-600 text-white")} onClick={() => setPage(p)}>{p}</Button>
              ) : null;
            })}
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page === totalPages} onClick={() => setPage(page + 1)}><ChevronRight className="h-3 w-3" /></Button>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page === totalPages} onClick={() => setPage(totalPages)}><ChevronsRight className="h-3 w-3" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Status Badge ────────────────────────────────────────────

const STATUS_MAP: Record<string, { className: string; icon?: LucideIcon }> = {
  active: { className: "status-active", icon: CheckCircle2 },
  approved: { className: "status-active", icon: CheckCircle2 },
  completed: { className: "status-active", icon: CheckCircle2 },
  paid: { className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", icon: CheckCircle2 },
  processed: { className: "status-active", icon: CheckCircle2 },
  pending: { className: "status-pending", icon: Clock },
  under_review: { className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: Eye },
  in_progress: { className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: Clock },
  rejected: { className: "status-rejected", icon: XCircle },
  cancelled: { className: "status-inactive", icon: XCircle },
  inactive: { className: "status-inactive" },
  on_hold: { className: "status-pending", icon: AlertTriangle },
  draft: { className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  open: { className: "status-rejected", icon: AlertTriangle },
  closed: { className: "status-inactive" },
  resolved: { className: "status-active", icon: CheckCircle2 },
  expired: { className: "status-rejected" },
  expiring: { className: "status-pending", icon: AlertTriangle },
};

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
  showIcon?: boolean;
}

export function StatusBadge({ status, size = "sm", showIcon = true }: StatusBadgeProps) {
  const config = STATUS_MAP[status] ?? STATUS_MAP["inactive"];
  const Icon = config?.icon;
  const label = status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <Badge className={cn("border-0", size === "sm" ? "text-[9px]" : "text-xs", config?.className)}>
      {showIcon && Icon && <Icon className={cn("mr-0.5", size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3")} />}
      {label}
    </Badge>
  );
}

// ─── Priority Badge ──────────────────────────────────────────

const PRIORITY_MAP: Record<string, string> = {
  low: "status-inactive",
  medium: "status-pending",
  normal: "status-active",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  urgent: "status-rejected",
  critical: "status-rejected",
};

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge className={cn("text-[9px] border-0", PRIORITY_MAP[priority] ?? PRIORITY_MAP["medium"])}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </Badge>
  );
}

// ─── Employee Avatar ─────────────────────────────────────────

const GRADIENTS = [
  "from-violet-500 to-purple-600", "from-blue-500 to-cyan-500", "from-emerald-500 to-green-600",
  "from-amber-500 to-orange-500", "from-pink-500 to-rose-600", "from-teal-500 to-cyan-600",
  "from-indigo-500 to-blue-600", "from-red-500 to-orange-500", "from-fuchsia-500 to-pink-500",
];

interface EmployeeAvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function EmployeeAvatar({ name, size = "md", className }: EmployeeAvatarProps) {
  const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const gradient = GRADIENTS[Math.abs(hash) % GRADIENTS.length];
  const sizeClass = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-12 w-12" : "h-9 w-9";
  const textSize = size === "sm" ? "text-[8px]" : size === "lg" ? "text-sm" : "text-[10px]";

  return (
    <Avatar className={cn(sizeClass, className)}>
      <AvatarFallback className={cn(`bg-gradient-to-br ${gradient} text-white font-semibold`, textSize)}>
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

// ─── Employee Chip ───────────────────────────────────────────

interface EmployeeChipProps {
  name: string;
  role?: string;
  department?: string;
  email?: string;
  size?: "sm" | "md";
  showDetails?: boolean;
  onClick?: () => void;
}

export function EmployeeChip({ name, role, department, email, size = "md", showDetails = true, onClick }: EmployeeChipProps) {
  return (
    <div className={cn("flex items-center gap-2", onClick && "cursor-pointer hover:bg-muted/50 rounded-lg p-1 transition-colors")} onClick={onClick}>
      <EmployeeAvatar name={name} size={size === "sm" ? "sm" : "md"} />
      <div className="min-w-0">
        <p className={cn("font-medium truncate", size === "sm" ? "text-[11px]" : "text-xs")}>{name}</p>
        {showDetails && (role || department) && (
          <p className="text-[9px] text-muted-foreground truncate">
            {role}{role && department ? " · " : ""}{department}
          </p>
        )}
        {showDetails && email && <p className="text-[9px] text-muted-foreground truncate">{email}</p>}
      </div>
    </div>
  );
}

// ─── Rating Stars ────────────────────────────────────────────

interface RatingStarsProps {
  rating: number;
  maxRating?: number;
  size?: "sm" | "md";
  showValue?: boolean;
}

export function RatingStars({ rating, maxRating = 5, size = "sm", showValue = true }: RatingStarsProps) {
  const iconSize = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: maxRating }, (_, i) => (
        <Star key={i} className={cn(iconSize, i < Math.round(rating) ? "text-amber-500 fill-amber-500" : "text-muted-foreground/30")} />
      ))}
      {showValue && <span className={cn("font-bold ml-1", size === "sm" ? "text-xs" : "text-sm")}>{rating.toFixed(1)}</span>}
    </div>
  );
}

// ─── Progress Ring ───────────────────────────────────────────

interface ProgressRingProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  color?: string;
}

export function ProgressRing({ value, size = 80, strokeWidth = 6, label, color }: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;
  const colorClass = color ?? (value >= 80 ? "text-emerald-500" : value >= 50 ? "text-amber-500" : "text-red-500");

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="-rotate-90" width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-muted" />
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} className={colorClass.replace("text-", "stroke-")} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("font-bold", colorClass, size < 80 ? "text-sm" : "text-lg")}>{value}%</span>
        </div>
      </div>
      {label && <span className="text-[9px] text-muted-foreground">{label}</span>}
    </div>
  );
}

// ─── Timeline ────────────────────────────────────────────────

interface TimelineItem {
  title: string;
  description?: string;
  time: string;
  status: "completed" | "current" | "upcoming";
  icon?: LucideIcon;
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className="space-y-0">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const dotColor = item.status === "completed" ? "bg-emerald-500" : item.status === "current" ? "bg-violet-500 animate-pulse" : "bg-muted-foreground/30";
        return (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={cn("h-3 w-3 rounded-full shrink-0", dotColor)} />
              {!isLast && <div className="w-0.5 flex-1 bg-border min-h-[24px]" />}
            </div>
            <div className={cn("pb-4", !isLast && "")}>
              <p className={cn("text-xs font-medium", item.status === "upcoming" && "text-muted-foreground")}>{item.title}</p>
              {item.description && <p className="text-[10px] text-muted-foreground mt-0.5">{item.description}</p>}
              <p className="text-[9px] text-muted-foreground mt-0.5">{item.time}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Metric Comparison ───────────────────────────────────────

interface MetricComparisonProps {
  label: string;
  current: number;
  previous: number;
  format?: "number" | "currency" | "percent";
}

export function MetricComparison({ label, current, previous, format = "number" }: MetricComparisonProps) {
  const change = previous > 0 ? ((current - previous) / previous) * 100 : 0;
  const isPositive = change > 0;
  const formatValue = (v: number) => {
    if (format === "currency") return "₹" + v.toLocaleString("en-IN");
    if (format === "percent") return v.toFixed(1) + "%";
    return v.toLocaleString("en-IN");
  };

  return (
    <div className="rounded-lg border p-3">
      <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <div className="flex items-end gap-2 mt-1">
        <span className="text-lg font-bold">{formatValue(current)}</span>
        <span className={cn("text-[10px] flex items-center gap-0.5 mb-0.5", isPositive ? "text-emerald-600" : "text-red-600")}>
          {isPositive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
          {Math.abs(change).toFixed(1)}%
        </span>
      </div>
      <p className="text-[9px] text-muted-foreground mt-0.5">vs {formatValue(previous)} prev.</p>
    </div>
  );
}

// ─── Filter Chips ────────────────────────────────────────────

interface FilterChipsProps {
  filters: Array<{ key: string; label: string; options: Array<{ value: string; label: string }> }>;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onClear?: () => void;
}

export function FilterChips({ filters, values, onChange, onClear }: FilterChipsProps) {
  const activeCount = Object.values(values).filter((v) => v && v !== "all").length;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      {filters.map((filter) => (
        <Select key={filter.key} value={values[filter.key] || "all"} onValueChange={(v) => onChange(filter.key, v)}>
          <SelectTrigger className="h-7 text-[10px] w-auto min-w-[80px] gap-1">
            <SelectValue placeholder={filter.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All {filter.label}</SelectItem>
            {filter.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {activeCount > 0 && onClear && (
        <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1" onClick={onClear}>
          <X className="h-3 w-3" />Clear ({activeCount})
        </Button>
      )}
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50 mb-4">
        <Icon className="h-8 w-8 text-muted-foreground/50" />
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground mt-1 max-w-[300px]">{description}</p>
      {action && (
        <Button className="mt-4 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-1.5 text-xs" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

// ─── KPI Summary Row ─────────────────────────────────────────

interface KPISummaryProps {
  items: Array<{
    label: string;
    value: string | number;
    change?: string;
    trend?: "up" | "down" | "neutral";
    icon: LucideIcon;
    color: string;
  }>;
}

export function KPISummary({ items }: KPISummaryProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
      {items.map((item) => (
        <StatCard key={item.label} label={item.label} value={item.value} change={item.change} trend={item.trend} icon={item.icon} gradient={item.color} />
      ))}
    </div>
  );
}

// ─── Info Grid ───────────────────────────────────────────────

interface InfoGridProps {
  items: Array<{ label: string; value: string | React.ReactNode; icon?: LucideIcon }>;
  columns?: 2 | 3 | 4;
}

export function InfoGrid({ items, columns = 2 }: InfoGridProps) {
  return (
    <div className={cn("grid gap-3 text-xs", columns === 2 ? "grid-cols-2" : columns === 3 ? "grid-cols-3" : "grid-cols-4")}>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          {item.icon && <item.icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <span className="text-muted-foreground">{item.label}:</span>
          <span className="font-medium truncate">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Currency Display ────────────────────────────────────────

export function CurrencyDisplay({ amount, size = "md" }: { amount: number; size?: "sm" | "md" | "lg" }) {
  const formatted = "₹" + amount.toLocaleString("en-IN");
  return <span className={cn("font-bold", size === "sm" ? "text-xs" : size === "lg" ? "text-xl" : "text-sm")}>{formatted}</span>;
}

export function CurrencyShort({ amount }: { amount: number }) {
  const formatted = amount >= 10000000 ? `₹${(amount / 10000000).toFixed(1)}Cr` : amount >= 100000 ? `₹${(amount / 100000).toFixed(1)}L` : amount >= 1000 ? `₹${(amount / 1000).toFixed(1)}K` : `₹${amount}`;
  return <span className="font-bold">{formatted}</span>;
}

// ─── Skeleton Loader ─────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-muted rounded", className)} />;
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-4 mb-4">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }, (_, j) => (
            <Skeleton key={j} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-16" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page Header ─────────────────────────────────────────────

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: { label: string; icon: LucideIcon; onClick: () => void };
  children?: React.ReactNode;
}

export function PageHeader({ title, description, action, children }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between animate-slide-up">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground text-sm mt-0.5">{description}</p>}
      </div>
      <div className="flex items-center gap-2">
        {children}
        {action && (
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2" onClick={action.onClick}>
            <action.icon className="h-4 w-4" />{action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
