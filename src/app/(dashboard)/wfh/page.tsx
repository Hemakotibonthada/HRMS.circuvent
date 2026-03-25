"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Home, Plus, Search, Clock, CheckCircle2, XCircle, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useWfhStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/firestore-service";

const STATUS_COLORS: Record<string, string> = {
  pending: "status-pending",
  approved: "status-active",
  rejected: "status-rejected",
};

export default function WfhPage() {
  const store = useWfhStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("requests");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.wfh, store);
  }, [initialized, store]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (w) =>
          (w.employeeName || "").toLowerCase().includes(q) ||
          (w.department || "").toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") result = result.filter((w) => w.status === statusFilter);
    return result;
  }, [items, search, statusFilter]);

  const pending = items.filter((w) => w.status === "pending").length;
  const approved = items.filter((w) => w.status === "approved").length;
  const rejected = items.filter((w) => w.status === "rejected").length;
  const totalDays = items.reduce((s, w) => s + (w.days || 0), 0);

  const deptBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((w) => {
      map[w.department || "Other"] = (map[w.department || "Other"] || 0) + (w.days || 0);
    });
    return Object.entries(map)
      .map(([name, days]) => ({ name, days }))
      .sort((a, b) => b.days - a.days);
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      employeeName: fd.get("name") as string,
      department: fd.get("department") as string,
      fromDate: fd.get("fromDate") as string,
      toDate: fd.get("toDate") as string,
      days: Number(fd.get("days")) || 1,
      reason: fd.get("reason") as string,
      status: "pending",
      employeeId: "",
    };
    try {
      await genericService(COLLECTIONS.wfh).create(data);
      toast.success("WFH request submitted!");
      setDialogOpen(false);
    } catch {
      toast.error("Failed to submit request");
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
          <h1 className="text-2xl font-bold tracking-tight">Work From Home</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} requests &middot; {pending} pending
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"
        >
          <Plus className="h-4 w-4" />
          Request WFH
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Requests", value: items.length, icon: Home, color: "from-violet-500 to-purple-600" },
          { label: "Pending", value: pending, icon: Clock, color: "from-amber-500 to-orange-500" },
          { label: "Approved", value: approved, icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Total Days", value: totalDays, icon: Users, color: "from-blue-500 to-cyan-500" },
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
          <Input placeholder="Search WFH requests..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.wfh} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching requests found.</p>
          ) : (
            filtered.map((req) => (
              <Card key={req.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{req.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {req.department} &middot; {req.fromDate} → {req.toDate} ({req.days}d) &middot; {req.reason}
                    </p>
                  </div>
                  <Badge className={cn("text-xs", STATUS_COLORS[req.status])}>{req.status}</Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {items.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Department WFH Days</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {deptBreakdown.map((d) => (
                    <div key={d.name} className="flex items-center gap-3">
                      <span className="text-sm flex-1">{d.name}</span>
                      <span className="font-semibold">{d.days}d</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Status Summary</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Pending", count: pending, color: "bg-amber-500" },
                    { label: "Approved", count: approved, color: "bg-emerald-500" },
                    { label: "Rejected", count: rejected, color: "bg-red-500" },
                  ].map((s) => (
                    <div key={s.label} className="flex items-center gap-3">
                      <div className={cn("h-3 w-3 rounded-full", s.color)} />
                      <span className="text-sm flex-1">{s.label}</span>
                      <span className="font-semibold">{s.count}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          ) : (
            <DataEmptyState {...EMPTY_STATES.wfh} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request WFH</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Employee Name</Label><Input name="name" required /></div>
              <div><Label>Department</Label><Input name="department" /></div>
              <div><Label>From</Label><Input name="fromDate" type="date" required /></div>
              <div><Label>To</Label><Input name="toDate" type="date" required /></div>
            </div>
            <div><Label>Days</Label><Input name="days" type="number" defaultValue={1} min={1} /></div>
            <div><Label>Reason</Label><Textarea name="reason" rows={2} /></div>
            <DialogFooter>
              <Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white">Submit</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
