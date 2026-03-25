"use client";

import { useState, useEffect, useMemo } from "react";
import { create } from "zustand";
import { type BaseRecord, useEmployeeStore, startSync } from "@/stores/unified-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Clock, Plus, Search, Sun, Sunset, Moon, Coffee, Zap,
  Users, CalendarDays, CheckCircle2, AlertTriangle, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRBAC } from "@/hooks/use-rbac";
import { genericService, COLLECTIONS } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";

// ─── Shift Store ─────────────────────────────────────────────

interface ShiftDoc extends BaseRecord {
  employeeId: string;
  employeeName: string;
  shiftType: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  department: string;
  notes: string;
}

const COLLECTION_NAME = "shifts";

const useShiftStore = create<{
  items: ShiftDoc[]; loading: boolean; initialized: boolean; error: string | null;
  setItems: (items: ShiftDoc[]) => void; addItem: (item: ShiftDoc) => void;
  updateItem: (id: string, u: Partial<ShiftDoc>) => void; removeItem: (id: string) => void;
  setLoading: (v: boolean) => void; setInitialized: (v: boolean) => void; setError: (e: string | null) => void;
}>((set) => ({
  items: [], loading: false, initialized: false, error: null,
  setItems: (items) => set({ items, loading: false, initialized: true }),
  addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
  updateItem: (id, u) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...u } : i)) })),
  removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  setLoading: (loading) => set({ loading }),
  setInitialized: (initialized) => set({ initialized }),
  setError: (error) => set({ error }),
}));

// ─── Config Constants ────────────────────────────────────────

const SHIFT_TYPES = [
  { value: "morning", label: "Morning", icon: Sun, time: "06:00 – 14:00", color: "from-orange-400 to-yellow-400" },
  { value: "general", label: "General", icon: Coffee, time: "09:00 – 18:00", color: "from-blue-400 to-cyan-400" },
  { value: "evening", label: "Evening", icon: Sunset, time: "14:00 – 22:00", color: "from-purple-400 to-pink-400" },
  { value: "night", label: "Night", icon: Moon, time: "22:00 – 06:00", color: "from-indigo-500 to-blue-600" },
  { value: "flexible", label: "Flexible", icon: Zap, time: "Flex hours", color: "from-green-400 to-emerald-400" },
] as const;

const STATUS_OPTIONS = ["assigned", "completed", "cancelled", "swapped"] as const;
const STATUS_COLORS: Record<string, string> = {
  assigned: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  swapped: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
};
const CHART_COLORS = ["#f97316", "#3b82f6", "#a855f7", "#6366f1", "#22c55e"];

export default function ShiftsPage() {
  const { user } = useAuth();
  const { isAdmin, isHR } = useRBAC();
  const store = useShiftStore();
  const empStore = useEmployeeStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tab, setTab] = useState("schedule");
  const [filterType, setFilterType] = useState("all");

  useEffect(() => {
    if (!initialized) {
      store.setLoading(true);
      genericService(COLLECTION_NAME).getAll().then((data) => {
        store.setItems(data as unknown as ShiftDoc[]);
      }).catch(() => store.setItems([]));
    }
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
  }, [initialized, store, empStore]);

  const filtered = useMemo(() => {
    let list = items;
    if (filterType !== "all") list = list.filter((s) => s.shiftType === filterType);
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(
      (s) =>
        s.employeeName?.toLowerCase().includes(q) ||
        s.department?.toLowerCase().includes(q) ||
        s.shiftType?.toLowerCase().includes(q)
    );
  }, [items, search, filterType]);

  // KPIs from store
  const totalShifts = items.length;
  const assigned = items.filter((s) => s.status === "assigned").length;
  const completed = items.filter((s) => s.status === "completed").length;
  const cancelled = items.filter((s) => s.status === "cancelled").length;
  const uniqueEmployees = new Set(items.map((s) => s.employeeId)).size;

  // Shift type breakdown
  const shiftTypeData = useMemo(() => {
    return SHIFT_TYPES.map((st) => ({
      name: st.label,
      value: items.filter((s) => s.shiftType === st.value).length,
    }));
  }, [items]);

  // Coverage by department
  const deptCoverage = useMemo(() => {
    const map: Record<string, { total: number; assigned: number }> = {};
    items.forEach((s) => {
      const dept = s.department || "Unassigned";
      if (!map[dept]) map[dept] = { total: 0, assigned: 0 };
      map[dept].total++;
      if (s.status === "assigned" || s.status === "completed") map[dept].assigned++;
    });
    return Object.entries(map).map(([name, v]) => ({ name, ...v }));
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const employeeId = fd.get("employeeId") as string;
    const emp = empStore.items.find((e) => e.id === employeeId);
    const shiftType = fd.get("shiftType") as string;
    const shiftConfig = SHIFT_TYPES.find((st) => st.value === shiftType);
    const [startTime, endTime] = (shiftConfig?.time || "09:00 – 18:00").split(" – ");
    const data: Omit<ShiftDoc, "id"> = {
      employeeId,
      employeeName: emp ? `${emp.firstName} ${emp.lastName}` : "",
      shiftType,
      date: fd.get("date") as string,
      startTime: startTime || "09:00",
      endTime: endTime || "18:00",
      status: "assigned",
      department: emp?.department || "",
      notes: fd.get("notes") as string,
    };
    try {
      const id = await genericService(COLLECTION_NAME).create(data as Record<string, unknown>);
      store.addItem({ ...data, id } as ShiftDoc);
      toast.success("Shift assigned!");
      setDialogOpen(false);
    } catch {
      toast.error("Failed to assign shift");
    }
  };

  if (loading && !initialized) return <DataLoadingSkeleton rows={6} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shift Management</h1>
          <p className="text-muted-foreground">Schedule and manage employee shifts</p>
        </div>
        {(isAdmin || isHR) && (
          <Button className="gap-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-0" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> Assign Shift
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Shifts", value: totalShifts, icon: Clock, color: "text-blue-600", sub: `${uniqueEmployees} employees scheduled` },
          { label: "Assigned", value: assigned, icon: CalendarDays, color: "text-orange-600", sub: "Active shift slots" },
          { label: "Completed", value: completed, icon: CheckCircle2, color: "text-green-600", sub: "Shifts fulfilled" },
          { label: "Cancelled", value: cancelled, icon: AlertTriangle, color: "text-red-600", sub: "Shifts cancelled" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
                  <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{kpi.sub}</p>
                </div>
                <div className={cn("h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center", kpi.color)}>
                  <kpi.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Shift Type Quick Filters */}
      <div className="flex flex-wrap gap-2">
        <Button variant={filterType === "all" ? "default" : "outline"} size="sm" onClick={() => setFilterType("all")}>All</Button>
        {SHIFT_TYPES.map((st) => (
          <Button key={st.value} variant={filterType === st.value ? "default" : "outline"} size="sm" className="gap-1.5" onClick={() => setFilterType(st.value)}>
            <st.icon className="h-3.5 w-3.5" /> {st.label}
          </Button>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Schedule Grid */}
        <TabsContent value="schedule">
          <Card>
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <CardTitle className="text-base flex-1">Shift Schedule</CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search shifts..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
              </div>
            </CardHeader>
            <CardContent>
              {filtered.length === 0 ? (
                <DataEmptyState {...EMPTY_STATES.shifts} onAction={isAdmin || isHR ? () => setDialogOpen(true) : undefined} compact />
              ) : (
                <div className="space-y-2">
                  {filtered.map((s) => {
                    const st = SHIFT_TYPES.find((t) => t.value === s.shiftType);
                    const ShiftIcon = st?.icon || Clock;
                    return (
                      <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                        <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shrink-0", st?.color || "from-gray-400 to-gray-500")}>
                          <ShiftIcon className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{s.employeeName}</p>
                          <p className="text-xs text-muted-foreground">
                            {st?.label || s.shiftType} · {s.date} · {s.startTime} – {s.endTime}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-xs">{s.department}</Badge>
                        <Badge className={cn("text-xs", STATUS_COLORS[s.status] || STATUS_COLORS.assigned)}>{s.status}</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Coverage */}
        <TabsContent value="coverage">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Department Coverage</CardTitle></CardHeader>
            <CardContent>
              {deptCoverage.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No shift data for coverage analysis</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={deptCoverage}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <RTooltip />
                    <Bar dataKey="total" name="Total Shifts" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="assigned" name="Active" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics */}
        <TabsContent value="analytics">
          <Card>
            <CardHeader><CardTitle className="text-base">Shifts by Type</CardTitle></CardHeader>
            <CardContent>
              {shiftTypeData.every((s) => s.value === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-12">No data to display</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie data={shiftTypeData.filter((s) => s.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={120} label={({ name, value }) => `${name}: ${value}`}>
                      {shiftTypeData.filter((s) => s.value > 0).map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <RTooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Shift Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign Shift</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Employee</Label>
              <Select name="employeeId" required>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {empStore.items.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} — {emp.department}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Shift Type</Label>
                <Select name="shiftType" required>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {SHIFT_TYPES.map((st) => (
                      <SelectItem key={st.value} value={st.value}>{st.label} ({st.time})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input id="date" name="date" type="date" required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" name="notes" placeholder="Optional notes" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-0">Assign</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
