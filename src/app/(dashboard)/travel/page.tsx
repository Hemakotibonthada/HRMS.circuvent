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
import { Plane, Plus, Search, Clock, CheckCircle2, DollarSign, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTravelStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const STATUS_COLORS: Record<string, string> = {
  pending: "status-pending",
  approved: "status-active",
  rejected: "status-rejected",
  completed: "status-active",
};

export default function TravelPage() {
  const store = useTravelStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("requests");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.travel, store);
  }, [initialized, store]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          (t.employeeName || "").toLowerCase().includes(q) ||
          (t.destination || "").toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") result = result.filter((t) => t.status === statusFilter);
    return result;
  }, [items, search, statusFilter]);

  const pending = items.filter((t) => t.status === "pending").length;
  const approved = items.filter((t) => t.status === "approved").length;
  const totalCost = items.reduce((s, t) => s + (t.estimatedCost || 0), 0);
  const approvedCost = items
    .filter((t) => t.status === "approved")
    .reduce((s, t) => s + (t.estimatedCost || 0), 0);

  const destBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((t) => {
      map[t.destination || "Other"] = (map[t.destination || "Other"] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      employeeName: fd.get("name") as string,
      department: fd.get("department") as string,
      destination: fd.get("destination") as string,
      fromDate: fd.get("fromDate") as string,
      toDate: fd.get("toDate") as string,
      purpose: fd.get("purpose") as string,
      estimatedCost: Number(fd.get("cost")) || 0,
      status: "pending",
    };
    try {
      await genericService(COLLECTIONS.travel).create(data);
      toast.success("Travel request submitted!");
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
          <h1 className="text-2xl font-bold tracking-tight">Travel Requests</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} requests &middot; ₹{totalCost.toLocaleString()} estimated
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"
        >
          <Plus className="h-4 w-4" />
          New Request
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Requests", value: items.length, icon: Plane, color: "from-violet-500 to-purple-600" },
          { label: "Pending", value: pending, icon: Clock, color: "from-amber-500 to-orange-500" },
          { label: "Approved", value: approved, icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Approved Cost", value: `₹${approvedCost.toLocaleString()}`, icon: DollarSign, color: "from-blue-500 to-cyan-500" },
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
          <Input placeholder="Search travel requests..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
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
            <DataEmptyState {...EMPTY_STATES.travel} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching requests found.</p>
          ) : (
            filtered.map((req) => (
              <Card key={req.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={cn("p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white")}>
                    <MapPin className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{req.employeeName} → {req.destination}</p>
                    <p className="text-xs text-muted-foreground">
                      {req.department} &middot; {req.fromDate} → {req.toDate} &middot; ₹{(req.estimatedCost || 0).toLocaleString()}
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
                <CardHeader><CardTitle className="text-sm">Top Destinations</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {destBreakdown.map((d) => (
                    <div key={d.name} className="flex items-center gap-3">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm flex-1">{d.name}</span>
                      <span className="font-semibold">{d.count}</span>
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
                    { label: "Completed", count: items.filter((t) => t.status === "completed").length, color: "bg-blue-500" },
                    { label: "Rejected", count: items.filter((t) => t.status === "rejected").length, color: "bg-red-500" },
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
            <DataEmptyState {...EMPTY_STATES.travel} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Travel Request</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Employee Name</Label><Input name="name" required /></div>
              <div><Label>Department</Label><Input name="department" /></div>
              <div><Label>Destination</Label><Input name="destination" required /></div>
              <div><Label>Est. Cost (₹)</Label><Input name="cost" type="number" min={0} /></div>
              <div><Label>From</Label><Input name="fromDate" type="date" required /></div>
              <div><Label>To</Label><Input name="toDate" type="date" required /></div>
            </div>
            <div><Label>Purpose</Label><Textarea name="purpose" rows={2} /></div>
            <DialogFooter>
              <Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white">Submit</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
