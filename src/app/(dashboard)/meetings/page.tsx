"use client";

import { useState, useEffect, useMemo } from "react";
import { useToday } from "@/hooks/use-now";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarDays, Plus, Search, Clock, Users, CheckCircle2, DoorOpen, Calendar, User, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useMeetingStore, useEmployeeStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const STATUS_COLORS: Record<string, string> = {
  confirmed: "status-active",
  pending: "status-pending",
  cancelled: "status-rejected",
};

const ROOM_PRESETS = [
  { id: "Boardroom", label: "Executive Boardroom", capacity: 16, desc: "4K Display · Dual Camera VC" },
  { id: "Conference A", label: "Conference Room A", capacity: 10, desc: "Ultra HD TV · Polycom VC" },
  { id: "Conference B", label: "Conference Room B", capacity: 8, desc: "Smart Board · Mic Array" },
  { id: "Huddle Room 1", label: "Huddle Pod 1", capacity: 4, desc: "Quick Discussion · Display" },
  { id: "Innovation Lab", label: "Innovation Hub", capacity: 12, desc: "Interactive Screen · Demo Area" },
];

export default function MeetingsPage() {
  const store = useMeetingStore();
  const empStore = useEmployeeStore();
  const { items, loading, initialized } = store;
  const employees = empStore.items;

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("bookings");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form State
  const [title, setTitle] = useState("");
  const [selectedRoom, setSelectedRoom] = useState(ROOM_PRESETS[0].id);
  const [selectedOrganizer, setSelectedOrganizer] = useState("");
  const [customOrganizer, setCustomOrganizer] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");
  const [attendees, setAttendees] = useState(4);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.meetings, store);
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
  }, [initialized, store, empStore]);

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

  const todayStr = useToday() ?? "";
  const confirmed = items.filter((m) => m.status === "confirmed").length;
  const todayMeetings = items.filter((m) => m.date === todayStr).length;
  const totalAttendees = items.reduce((s, m) => s + (m.attendees || 0), 0);

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
    const finalOrganizer = selectedOrganizer && selectedOrganizer !== "other" ? selectedOrganizer : customOrganizer.trim();
    if (!title.trim()) {
      toast.error("Please enter a meeting title.");
      return;
    }
    if (!finalOrganizer) {
      toast.error("Please select or enter the meeting organizer.");
      return;
    }

    setSubmitting(true);
    const data = {
      title: title.trim(),
      room: selectedRoom,
      organizer: finalOrganizer,
      date,
      startTime,
      endTime,
      attendees: Number(attendees) || 1,
      status: "confirmed",
    };
    try {
      await genericService(COLLECTIONS.meetings).create(data);
      toast.success("Meeting room reserved successfully!");
      setDialogOpen(false);
      setTitle("");
      setSelectedOrganizer("");
      setCustomOrganizer("");
    } catch {
      toast.error("Failed to book meeting");
    } finally {
      setSubmitting(false);
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Meeting Room Booking</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} reservations &middot; {todayMeetings} scheduled today
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2 rounded-full h-9 px-4 hover:opacity-95"
        >
          <Plus className="h-4 w-4" />
          Book Room
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Bookings", value: items.length, icon: CalendarDays, color: "from-violet-500 to-purple-600" },
          { label: "Today's Meetings", value: todayMeetings, icon: Clock, color: "from-blue-500 to-cyan-500" },
          { label: "Confirmed", value: confirmed, icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Total Attendees", value: totalAttendees, icon: Users, color: "from-amber-500 to-orange-500" },
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
          <Input placeholder="Search meetings by title, room, or organizer..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 text-xs h-9" />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="rooms">Room Utilization</TabsTrigger>
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
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {meeting.room} &middot; {meeting.date} &middot; {meeting.startTime}–{meeting.endTime} &middot; {meeting.organizer} &middot; {meeting.attendees} attendees
                    </p>
                  </div>
                  <Badge className={cn("text-xs", STATUS_COLORS[meeting.status] || "bg-muted text-muted-foreground")}>{meeting.status}</Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="rooms" className="mt-4">
          {items.length > 0 ? (
            <Card>
              <CardHeader><CardTitle className="text-sm font-semibold">Room Utilization</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {roomUtilization.map((r) => (
                  <div key={r.name} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20">
                    <DoorOpen className="h-4 w-4 text-violet-500" />
                    <span className="text-xs font-semibold flex-1">{r.name}</span>
                    <Badge variant="outline" className="text-xs font-medium">{r.count} reservations</Badge>
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
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <DoorOpen className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Book Meeting Room</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Schedule conference facilities with AV integration and calendar invites.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-violet-500" />
                Meeting Title <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. Q3 Roadmap Review &amp; Sprint Planning"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-9 text-xs"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Select Facility / Room <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ROOM_PRESETS.map((rm) => {
                  const active = selectedRoom === rm.id;
                  return (
                    <button
                      key={rm.id}
                      type="button"
                      onClick={() => setSelectedRoom(rm.id)}
                      className={cn(
                        "p-2.5 rounded-lg border text-left transition-all",
                        active
                          ? "bg-violet-50 dark:bg-violet-950/40 border-violet-500 text-violet-700 dark:text-violet-300 shadow-xs"
                          : "bg-background hover:bg-muted/50 text-muted-foreground border-border"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-xs text-foreground truncate">{rm.label}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-medium">{rm.capacity} seats</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-1">{rm.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-violet-500" />
                  Organizer <span className="text-destructive">*</span>
                </Label>
                {employees && employees.length > 0 ? (
                  <div className="space-y-1.5">
                    <Select value={selectedOrganizer} onValueChange={setSelectedOrganizer}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Select organizer..." />
                      </SelectTrigger>
                      <SelectContent>
                        {employees.map((emp) => {
                          const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ") || String(emp.id);
                          const sub = [emp.designation, emp.department].filter(Boolean).join(" · ");
                          return (
                            <SelectItem key={emp.id} value={name} className="text-xs">
                              <span className="font-medium">{name}</span>
                              {sub ? <span className="text-muted-foreground ml-2 text-[11px]">({sub})</span> : null}
                            </SelectItem>
                          );
                        })}
                        <SelectItem value="other" className="text-xs text-violet-600 font-medium">
                          + Enter manual name
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {selectedOrganizer === "other" && (
                      <Input
                        placeholder="Enter organizer name"
                        value={customOrganizer}
                        onChange={(e) => setCustomOrganizer(e.target.value)}
                        className="h-9 text-xs mt-1"
                        required
                      />
                    )}
                  </div>
                ) : (
                  <Input
                    placeholder="e.g. Priya Nair"
                    value={customOrganizer}
                    onChange={(e) => setCustomOrganizer(e.target.value)}
                    className="h-9 text-xs"
                    required
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  Expected Attendees
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={attendees}
                  onChange={(e) => setAttendees(Number(e.target.value))}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  Date <span className="text-destructive">*</span>
                </Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 text-xs" required />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  Start Time <span className="text-destructive">*</span>
                </Label>
                <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-9 text-xs" required />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  End Time <span className="text-destructive">*</span>
                </Label>
                <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="h-9 text-xs" required />
              </div>
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
                {submitting ? "Booking…" : "Confirm Booking"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
