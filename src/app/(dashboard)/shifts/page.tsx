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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Clock, Plus, Search, Sun, Sunset, Moon, Coffee, Zap,
  Users, CalendarDays, Calendar, CheckCircle2, AlertTriangle, BarChart3,
  User, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useRBAC } from "@/hooks/use-rbac";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
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

  // Form State
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [customEmpName, setCustomEmpName] = useState("");
  const [shiftType, setShiftType] = useState<string>("general");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [isRange, setIsRange] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedEmployeeObj = useMemo(() => {
    return empStore.items.find((e) => e.id === selectedEmpId);
  }, [empStore.items, selectedEmpId]);

  const activeShiftConfig = useMemo(() => {
    return SHIFT_TYPES.find((st) => st.value === shiftType) || SHIFT_TYPES[1];
  }, [shiftType]);

  useEffect(() => {
    if (!initialized) {
      store.setLoading(true);
      genericService(COLLECTION_NAME).getAll().then((data) => {
        store.setItems(data as unknown as ShiftDoc[]);
      }).catch(() => store.setItems([]));
    }
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
    // Neither store belongs in the deps: they are whole zustand state objects,
    // and setLoading() above replaces `store`, so listing it re-triggers this
    // effect forever. `initialized` is the real guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized]);

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

  const weeklyDays = useMemo(() => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days.map(day => ({
        day,
        count: items.filter(s => new Date(s.date).getDay() === days.indexOf(day)).length
    }));
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const finalEmpName = selectedEmployeeObj
      ? [selectedEmployeeObj.firstName, selectedEmployeeObj.lastName].filter(Boolean).join(" ")
      : customEmpName.trim();

    if (!selectedEmpId && !customEmpName.trim()) {
      toast.error("Please select an employee.");
      return;
    }

    setSubmitting(true);
    const shiftConfig = SHIFT_TYPES.find((st) => st.value === shiftType);
    const [startTime, endTime] = (shiftConfig?.time || "09:00 – 18:00").split(" – ");

    try {
      if (isRange && endDate && endDate > date) {
        const start = new Date(date);
        const end = new Date(endDate);
        const cur = new Date(start);
        let count = 0;

        while (cur <= end) {
          const curIso = cur.toISOString().slice(0, 10);
          const data: Omit<ShiftDoc, "id"> = {
            employeeId: selectedEmpId || "manual",
            employeeName: finalEmpName,
            shiftType,
            date: curIso,
            startTime: startTime || "09:00",
            endTime: endTime || "18:00",
            status: "assigned",
            department: selectedEmployeeObj?.department || "General",
            notes: notes.trim() || undefined,
          };
          const id = await genericService(COLLECTION_NAME).create(data as Record<string, unknown>);
          store.addItem({ ...data, id } as ShiftDoc);
          count++;
          cur.setDate(cur.getDate() + 1);
        }
        toast.success(`Assigned ${count} shifts across date range!`);
      } else {
        const data: Omit<ShiftDoc, "id"> = {
          employeeId: selectedEmpId || "manual",
          employeeName: finalEmpName,
          shiftType,
          date,
          startTime: startTime || "09:00",
          endTime: endTime || "18:00",
          status: "assigned",
          department: selectedEmployeeObj?.department || "General",
          notes: notes.trim() || undefined,
        };
        const id = await genericService(COLLECTION_NAME).create(data as Record<string, unknown>);
        store.addItem({ ...data, id } as ShiftDoc);
        toast.success("Shift assigned successfully!");
      }
      setDialogOpen(false);
      setNotes("");
    } catch {
      toast.error("Failed to assign shift");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !initialized) return <DataLoadingSkeleton rows={6} />;

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shift Management</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Schedule and manage workforce shift rosters</p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2 rounded-full h-9 px-4 hover:opacity-95"
        >
          <Plus className="h-4 w-4" />
          Assign Shift
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Shifts", value: totalShifts, sub: `${uniqueEmployees} employees scheduled`, icon: CalendarDays, color: "from-blue-500 to-cyan-500" },
          { label: "Assigned", value: assigned, sub: "Active shift roasters", icon: Clock, color: "from-amber-500 to-orange-500" },
          { label: "Completed", value: completed, sub: "Shifts fulfilled", icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Cancelled", value: cancelled, sub: "Shifts cancelled", icon: AlertTriangle, color: "from-red-500 to-rose-500" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={cn("p-3 rounded-xl bg-gradient-to-r text-white", kpi.color)}>
                <kpi.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-2xl font-bold">{kpi.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{kpi.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant={filterType === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilterType("all")}
          className={cn("rounded-full h-8 text-xs", filterType === "all" ? "bg-violet-600 text-white" : "")}
        >
          All Shifts
        </Button>
        {SHIFT_TYPES.map((st) => (
          <Button
            key={st.value}
            variant={filterType === st.value ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterType(st.value)}
            className={cn(
              "rounded-full h-8 text-xs gap-1.5",
              filterType === st.value ? "bg-violet-600 text-white" : ""
            )}
          >
            <st.icon className="h-3.5 w-3.5" />
            {st.label}
          </Button>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="space-y-4 mt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search shifts by employee name, department, or shift type..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>

          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.shifts} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching shifts found.</p>
          ) : (
            <div className="space-y-2.5">
              {filtered.map((s) => {
                const shiftCfg = SHIFT_TYPES.find((st) => st.value === s.shiftType) || SHIFT_TYPES[1];
                const Icon = shiftCfg.icon;
                return (
                  <Card key={s.id} className="hover:shadow-sm transition-shadow">
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className={cn("p-2.5 rounded-xl bg-gradient-to-r text-white shrink-0", shiftCfg.color)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{s.employeeName}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                            <span>{s.department || "General"}</span>
                            <span>&middot;</span>
                            <span className="font-medium text-foreground">{s.date}</span>
                            <span>&middot;</span>
                            <span>{s.startTime} – {s.endTime}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge className={cn("text-xs font-normal", STATUS_COLORS[s.status] || "bg-muted text-muted-foreground")}>
                          {s.status}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="coverage" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold">Weekly Shift Coverage</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {weeklyDays.map((d) => (
                  <div key={d.day} className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                    <div className="font-medium text-sm">{d.day}</div>
                    <div className="text-xs text-muted-foreground">{d.count} shifts scheduled</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold">Shift Distribution by Type</CardTitle></CardHeader>
            <CardContent>
              {shiftTypeData.every((s) => s.value === 0) ? (
                <p className="text-center text-muted-foreground py-8">No shift data recorded yet.</p>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Assign Shift</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Schedule single or recurring workforce shift rosters with timing rules.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-violet-500" />
                Employee <span className="text-destructive">*</span>
              </Label>
              {empStore.items && empStore.items.length > 0 ? (
                <div className="space-y-1.5">
                  <Select value={selectedEmpId} onValueChange={setSelectedEmpId}>
                    <SelectTrigger className="w-full h-9 text-xs">
                      <SelectValue placeholder="Select an employee..." />
                    </SelectTrigger>
                    <SelectContent>
                      {empStore.items.map((emp) => {
                        const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ") || String(emp.id);
                        const sub = [emp.designation, emp.department].filter(Boolean).join(" · ");
                        return (
                          <SelectItem key={emp.id} value={emp.id} className="text-xs">
                            <span className="font-medium">{name}</span>
                            {sub ? <span className="text-muted-foreground ml-2 text-[11px]">({sub})</span> : null}
                          </SelectItem>
                        );
                      })}
                      <SelectItem value="manual" className="text-xs text-violet-600 font-medium">
                        + Enter manual name
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {selectedEmpId === "manual" && (
                    <Input
                      placeholder="Enter full employee name"
                      value={customEmpName}
                      onChange={(e) => setCustomEmpName(e.target.value)}
                      className="h-9 text-xs mt-1"
                      required
                    />
                  )}
                </div>
              ) : (
                <Input
                  placeholder="e.g. Rahul Sharma"
                  value={customEmpName}
                  onChange={(e) => setCustomEmpName(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Shift Timing &amp; Type <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {SHIFT_TYPES.map((st) => {
                  const Icon = st.icon;
                  const active = shiftType === st.value;
                  return (
                    <button
                      key={st.value}
                      type="button"
                      onClick={() => setShiftType(st.value)}
                      className={cn(
                        "p-2.5 rounded-lg border text-left transition-all",
                        active
                          ? "bg-violet-50 dark:bg-violet-950/40 border-violet-500 text-violet-700 dark:text-violet-300 shadow-xs"
                          : "bg-background hover:bg-muted/50 text-muted-foreground border-border"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className={cn("h-4 w-4", active ? "text-violet-600" : "text-muted-foreground")} />
                        <span className="font-semibold text-xs text-foreground">{st.label}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{st.time}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  Schedule Date <span className="text-destructive">*</span>
                </Label>
                <button
                  type="button"
                  onClick={() => setIsRange(!isRange)}
                  className="text-xs text-violet-600 hover:text-violet-700 font-medium cursor-pointer"
                >
                  {isRange ? "Switch to single date" : "+ Assign multi-day range"}
                </button>
              </div>

              <div className={cn("grid gap-3", isRange ? "grid-cols-2" : "grid-cols-1")}>
                <div>
                  {isRange && <Label className="text-[11px] text-muted-foreground">Start Date</Label>}
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-9 text-xs"
                    required
                  />
                </div>
                {isRange && (
                  <div>
                    <Label className="text-[11px] text-muted-foreground">End Date</Label>
                    <Input
                      type="date"
                      value={endDate}
                      min={date}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="h-9 text-xs"
                      required
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 rounded-lg border bg-violet-50/60 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <activeShiftConfig.icon className="h-4 w-4 text-violet-600" />
                <div>
                  <p className="text-xs font-semibold text-foreground">{activeShiftConfig.label} Shift ({activeShiftConfig.time})</p>
                  <p className="text-[11px] text-muted-foreground">
                    {selectedEmployeeObj ? `${selectedEmployeeObj.firstName} ${selectedEmployeeObj.lastName} · ${selectedEmployeeObj.department}` : "General Assignment"}
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="text-[11px] bg-background">Active</Badge>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                Shift Notes / Handover Instructions
              </Label>
              <Input
                placeholder="Optional notes or project coverage requirements..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <DialogFooter className="pt-2 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                className="rounded-full text-xs h-9 px-4"
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all"
              >
                {submitting ? "Assigning…" : "Assign Shift"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
