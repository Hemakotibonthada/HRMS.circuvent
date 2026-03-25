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
import { CalendarDays, Plus, Search, Clock, Users, CheckCircle2, DoorOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useMeetingStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/firestore-service";

const STATUS_COLORS: Record<string, string> = {
  confirmed: "status-active",
  pending: "status-pending",
  cancelled: "status-rejected",
};

export default function MeetingsPage() {
  const store = useMeetingStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("bookings");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.meetings, store);
  }, [initialized, store]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (m) =>
        (m.title || "").toLowerCase().includes(q) ||
        (m.room || "").toLowerCase().includes(q) ||
        (m.organizer || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const todayStr = new Date().toISOString().split("T")[0];
  const confirmed = items.filter((m) => m.status === "confirmed").length;
  const todayMeetings = items.filter((m) => m.date === todayStr).length;
  const totalAttendees = items.reduce((s, m) => s + (m.attendees || 0), 0);
  const rooms = useMemo(
    () => [...new Set(items.map((m) => m.room).filter(Boolean))],
    [items]
  );

  const roomUtilization = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((m) => {
      map[m.room || "Unknown"] = (map[m.room || "Unknown"] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      title: fd.get("title") as string,
      room: fd.get("room") as string,
      organizer: fd.get("organizer") as string,
      date: fd.get("date") as string,
      startTime: fd.get("startTime") as string,
      endTime: fd.get("endTime") as string,
      attendees: Number(fd.get("attendees")) || 1,
      status: "confirmed",
    };
    try {
      await genericService(COLLECTIONS.meetings).create(data);
      toast.success("Meeting booked!");
      setDialogOpen(false);
    } catch {
      toast.error("Failed to book meeting");
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
          <h1 className="text-2xl font-bold tracking-tight">Meeting Room Booking</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} bookings &middot; {todayMeetings} today
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"
        >
          <Plus className="h-4 w-4" />
          Book Room
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Bookings", value: items.length, icon: CalendarDays, color: "from-violet-500 to-purple-600" },
          { label: "Today", value: todayMeetings, icon: Clock, color: "from-amber-500 to-orange-500" },
          { label: "Confirmed", value: confirmed, icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Rooms", value: rooms.length, icon: DoorOpen, color: "from-blue-500 to-cyan-500" },
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

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search meetings..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="rooms">Room Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="bookings" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.meetings} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching bookings found.</p>
          ) : (
            filtered.map((meeting) => (
              <Card key={meeting.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={cn("p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white")}>
                    <DoorOpen className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{meeting.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {meeting.room} &middot; {meeting.date} &middot; {meeting.startTime}–{meeting.endTime} &middot; {meeting.organizer} &middot; {meeting.attendees} attendees
                    </p>
                  </div>
                  <Badge className={cn("text-xs", STATUS_COLORS[meeting.status])}>{meeting.status}</Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="rooms" className="mt-4">
          {items.length > 0 ? (
            <Card>
              <CardHeader><CardTitle className="text-sm">Room Utilization</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {roomUtilization.map((r) => (
                  <div key={r.name} className="flex items-center gap-3">
                    <DoorOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm flex-1">{r.name}</span>
                    <span className="font-semibold">{r.count} bookings</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <DataEmptyState {...EMPTY_STATES.meetings} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Book Meeting Room</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><Label>Meeting Title</Label><Input name="title" required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Room</Label>
                <Select name="room">
                  <SelectTrigger><SelectValue placeholder="Select room" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Conference A">Conference A</SelectItem>
                    <SelectItem value="Conference B">Conference B</SelectItem>
                    <SelectItem value="Boardroom">Boardroom</SelectItem>
                    <SelectItem value="Huddle Room">Huddle Room</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Organizer</Label><Input name="organizer" required /></div>
              <div><Label>Date</Label><Input name="date" type="date" required /></div>
              <div><Label>Attendees</Label><Input name="attendees" type="number" defaultValue={2} min={1} /></div>
              <div><Label>Start Time</Label><Input name="startTime" type="time" required /></div>
              <div><Label>End Time</Label><Input name="endTime" type="time" required /></div>
            </div>
            <DialogFooter>
              <Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white">Book</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
