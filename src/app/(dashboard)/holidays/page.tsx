"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, Plus, Search, Sun, Star, Palmtree, Gift } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useHolidayStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const TYPE_COLORS: Record<string, string> = {
  national: "status-active",
  regional: "status-pending",
  restricted: "status-inactive",
  optional: "status-pending",
};

export default function HolidaysPage() {
  const store = useHolidayStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("list");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.holidays, store);
  }, [initialized, store]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (h) =>
          (h.name || "").toLowerCase().includes(q) ||
          (h.type || "").toLowerCase().includes(q)
      );
    }
    if (typeFilter !== "all") result = result.filter((h) => h.type === typeFilter);
    return result;
  }, [items, search, typeFilter]);

  const national = items.filter((h) => h.type === "national").length;
  const regional = items.filter((h) => h.type === "regional").length;
  const upcoming = items.filter((h) => new Date(h.date) >= new Date()).length;
  const restricted = items.filter((h) => h.type === "restricted").length;

  const monthBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((h) => {
      const month = h.date
        ? new Date(h.date).toLocaleDateString("en-US", { month: "short" })
        : "Unknown";
      map[month] = (map[month] || 0) + 1;
    });
    return Object.entries(map).map(([name, count]) => ({ name, count }));
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const dateStr = fd.get("date") as string;
    const data = {
      name: fd.get("name") as string,
      date: dateStr,
      day: dateStr
        ? new Date(dateStr).toLocaleDateString("en-US", { weekday: "long" })
        : "",
      type: fd.get("type") as string,
    };
    try {
      await genericService(COLLECTIONS.holidays).create(data);
      toast.success("Holiday added!");
      setDialogOpen(false);
    } catch {
      toast.error("Failed to add holiday");
    }
  };

  if (loading && !initialized)
    return (
      <div className="p-6">
        <DataLoadingSkeleton />
      </div>
    );

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Holiday Calendar</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} holidays &middot; {upcoming} upcoming
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Holiday
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Holidays", value: items.length, icon: CalendarDays, color: "from-violet-500 to-purple-600" },
          { label: "National", value: national, icon: Star, color: "from-emerald-500 to-green-600" },
          { label: "Regional", value: regional, icon: Palmtree, color: "from-amber-500 to-orange-500" },
          { label: "Upcoming", value: upcoming, icon: Sun, color: "from-blue-500 to-cyan-500" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={cn("p-3 rounded-xl bg-gradient-to-r text-white", kpi.color)}>
                <kpi.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-2xl font-bold">{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search holidays..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="national">National</SelectItem>
            <SelectItem value="regional">Regional</SelectItem>
            <SelectItem value="restricted">Restricted</SelectItem>
            <SelectItem value="optional">Optional</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">Holidays</TabsTrigger>
          <TabsTrigger value="analytics">By Month</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.holidays} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching holidays found.</p>
          ) : (
            filtered.map((holiday) => (
              <Card key={holiday.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={cn("p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white")}>
                    <Gift className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{holiday.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {holiday.date} &middot; {holiday.day}
                    </p>
                  </div>
                  <Badge className={cn("text-xs", TYPE_COLORS[holiday.type])}>{holiday.type}</Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {items.length > 0 ? (
            <Card>
              <CardHeader><CardTitle className="text-sm">Holidays by Month</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {monthBreakdown.map((m) => (
                  <div key={m.name} className="flex items-center gap-3">
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm flex-1">{m.name}</span>
                    <span className="font-semibold">{m.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <DataEmptyState {...EMPTY_STATES.holidays} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Holiday</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label>Holiday Name</Label><Input name="name" required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input name="date" type="date" required /></div>
              <div>
                <Label>Type</Label>
                <Select name="type">
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="national">National</SelectItem>
                    <SelectItem value="regional">Regional</SelectItem>
                    <SelectItem value="restricted">Restricted</SelectItem>
                    <SelectItem value="optional">Optional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white">Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
