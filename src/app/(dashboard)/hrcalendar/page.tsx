"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Sun,
  Snowflake, Flag, Clock, Users, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useHolidayStore, useLeaveStore, startSync, type HolidayDoc } from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { clickable } from "@/lib/a11y/clickable";

// ═══════════════════════════════════════════════════════════════
// HR CALENDAR — Holidays, leave overlay, monthly grid navigation
// ═══════════════════════════════════════════════════════════════

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// `hrms.holidays` has no "type" column and never did — it has `isOptional`,
// a gazetted closure versus a day drawn from a floating pool. This screen
// used to read `h.type` and colour by "Public"/"Company"/"Regional", none of
// which the API has ever sent, so every badge fell through to grey and the
// legend counted zeros. The two kinds below are the two the data actually has.
const KIND_COLORS: Record<string, string> = {
  Gazetted: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  Optional: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};
const KIND_ICONS: Record<string, typeof Sun> = { Gazetted: Flag, Optional: Sun };

function kindOf(holiday: HolidayDoc): string {
  return holiday.isOptional ? "Optional" : "Gazetted";
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function HRCalendarPage() {
  const holidayStore = useHolidayStore();
  const leaveStore = useLeaveStore();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [addOpen, setAddOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [tab, setTab] = useState("calendar");
  const [form, setForm] = useState({ name: "", date: "", isOptional: false });

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthName = currentDate.toLocaleString("default", { month: "long" });

  useEffect(() => {
    if (!holidayStore.initialized) startSync(COLLECTIONS.holidays, holidayStore);
    if (!leaveStore.initialized) startSync(COLLECTIONS.leaves, leaveStore);
  }, [holidayStore, leaveStore]);

  const loading = (holidayStore.loading && !holidayStore.initialized);

  const holidayMap = useMemo(() => {
    const map = new Map<string, HolidayDoc[]>();
    holidayStore.items.forEach(h => {
      const key = h.holidayDate?.slice(0, 10);
      if (key) map.set(key, [...(map.get(key) || []), h]);
    });
    return map;
  }, [holidayStore.items]);

  const leaveCountMap = useMemo(() => {
    const map = new Map<string, number>();
    leaveStore.items.filter(l => l.status === "approved").forEach(l => {
      const from = new Date(l.fromDate);
      const to = new Date(l.toDate);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        map.set(key, (map.get(key) || 0) + 1);
      }
    });
    return map;
  }, [leaveStore.items]);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const calendarCells = useMemo(() => {
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [daysInMonth, firstDay]);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => setCurrentDate(new Date());

  // Compared as plain date strings rather than parsed: `holidayDate` is a
  // calendar date, and `new Date("2026-01-26")` is UTC midnight, which reads
  // as the 25th anywhere west of Greenwich.
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const todayIso = new Date().toISOString().slice(0, 10);

  const monthHolidays = useMemo(() =>
    holidayStore.items
      .filter(h => (h.holidayDate || "").startsWith(monthPrefix))
      .sort((a, b) => a.holidayDate.localeCompare(b.holidayDate)),
  [holidayStore.items, monthPrefix]);

  const totalHolidays = holidayStore.items.length;
  const thisMonthCount = monthHolidays.length;
  const upcomingCount = holidayStore.items.filter(h => (h.holidayDate || "") >= todayIso).length;
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    holidayStore.items.forEach(h => { const k = kindOf(h); counts[k] = (counts[k] || 0) + 1; });
    return counts;
  }, [holidayStore.items]);

  const handleAdd = useCallback(async () => {
    if (!form.name || !form.date) { toast.error("Name and date are required"); return; }
    try {
      const response = await fetch("/api/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, holidayDate: form.date, isOptional: form.isOptional }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Failed to add holiday");
      }
      toast.success(`Holiday "${form.name}" added`);
      setAddOpen(false);
      setForm({ name: "", date: "", isOptional: false });
      startSync(COLLECTIONS.holidays, holidayStore);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add holiday");
    }
  }, [form, holidayStore]);

  const getDateKey = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  if (loading) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">HR Calendar</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{totalHolidays} holidays · {upcomingCount} upcoming</p>
        </div>
        <Button className="gap-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add Holiday
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Holidays", value: totalHolidays, icon: CalendarDays, color: "from-violet-500 to-purple-600" },
          { label: "This Month", value: thisMonthCount, icon: Sun, color: "from-amber-500 to-orange-500" },
          { label: "Upcoming", value: upcomingCount, icon: Clock, color: "from-blue-500 to-cyan-500" },
          { label: "Holiday Types", value: Object.keys(typeCounts).length, icon: Flag, color: "from-emerald-500 to-green-600" },
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="calendar">Calendar</TabsTrigger><TabsTrigger value="list">Holiday List</TabsTrigger></TabsList>

        <TabsContent value="calendar" className="space-y-4">
          <div className="flex items-center justify-between">
            <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
            <h2 className="text-lg font-semibold">{monthName} {year}</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
              <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>

          <div className="grid grid-cols-7 border rounded-lg overflow-hidden">
            {DAYS.map(d => (
              <div key={d} className="p-2 text-center text-xs font-semibold bg-muted/50 border-b">{d}</div>
            ))}
            {calendarCells.map((day, i) => {
              if (day === null) return <div key={`e-${i}`} className="p-2 min-h-[80px] bg-muted/20 border-b border-r" />;
              const dateKey = getDateKey(day);
              const holidays = holidayMap.get(dateKey) || [];
              const leaveCount = leaveCountMap.get(dateKey) || 0;
              const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
              const isSunday = (i % 7) === 0;

              return (
                <div
                  key={dateKey}
                  className={cn(
                    "p-1.5 min-h-[80px] border-b border-r cursor-pointer hover:bg-accent/50 transition-colors relative",
                    isToday && "bg-violet-50 dark:bg-violet-900/20",
                    isSunday && "bg-red-50/50 dark:bg-red-900/10",
                    holidays.length > 0 && "bg-amber-50/50 dark:bg-amber-900/10",
                  )}
                  {...clickable(() => setSelectedDay(day))}
                >
                  <span className={cn("text-xs font-medium", isToday && "bg-violet-500 text-white rounded-full px-1.5 py-0.5")}>{day}</span>
                  <div className="mt-1 space-y-0.5">
                    {holidays.slice(0, 2).map(h => (
                      <div key={h.id} className={cn("text-[10px] px-1 rounded truncate", KIND_COLORS[kindOf(h)])}>{h.name}</div>
                    ))}
                    {holidays.length > 2 && <div className="text-[10px] text-muted-foreground">+{holidays.length - 2} more</div>}
                    {leaveCount > 0 && (
                      <div className="text-[10px] flex items-center gap-0.5 text-orange-600"><Users className="h-2.5 w-2.5" />{leaveCount} on leave</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3">
            {Object.entries(KIND_COLORS).map(([kind, cls]) => (
              <div key={kind} className="flex items-center gap-1.5 text-xs">
                <div className={cn("h-3 w-3 rounded", cls)} />
                <span>{kind} ({typeCounts[kind] || 0})</span>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="list">
          {monthHolidays.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.holidays} onAction={() => setAddOpen(true)} />
          ) : (
            <div className="space-y-2">
              {monthHolidays.map(h => {
                const kind = kindOf(h);
                const Icon = KIND_ICONS[kind];
                return (
                  <Card key={h.id}>
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center", KIND_COLORS[kind])}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-sm">{h.name}</h3>
                        <p className="text-xs text-muted-foreground">{new Date(`${h.holidayDate}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}</p>
                      </div>
                      <Badge className={cn("text-xs", KIND_COLORS[kind])}>{kind}</Badge>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Day Detail Dialog */}
      <Dialog open={selectedDay !== null} onOpenChange={() => setSelectedDay(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{selectedDay && `${monthName} ${selectedDay}, ${year}`}</DialogTitle></DialogHeader>
          {selectedDay && (() => {
            const key = getDateKey(selectedDay);
            const dayHolidays = holidayMap.get(key) || [];
            const leaves = leaveCountMap.get(key) || 0;
            return (
              <div className="space-y-3">
                {dayHolidays.length > 0 ? dayHolidays.map(h => (
                  <div key={h.id} className="flex items-center gap-3">
                    <Badge className={cn("text-xs", KIND_COLORS[kindOf(h)])}>{kindOf(h)}</Badge>
                    <span className="text-sm font-medium">{h.name}</span>
                  </div>
                )) : <p className="text-sm text-muted-foreground">No holidays on this day.</p>}
                {leaves > 0 && <p className="text-sm flex items-center gap-1"><Users className="h-4 w-4 text-orange-500" />{leaves} employee(s) on leave</p>}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Add Holiday Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Holiday</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Holiday Name</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Republic Day" /></div>
            <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} /></div>
            <div>
              <Label>Kind</Label>
              <Select value={form.isOptional ? "optional" : "gazetted"} onValueChange={v => setForm(p => ({ ...p, isOptional: v === "optional" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gazetted">Gazetted — office closed</SelectItem>
                  <SelectItem value="optional">Optional — chosen from a pool</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0">Add Holiday</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}