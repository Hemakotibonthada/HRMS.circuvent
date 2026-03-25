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
import { Clock, Plus, Search, DollarSign, CheckCircle2, TrendingUp, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useOvertimeStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/firestore-service";

const STATUS_COLORS: Record<string, string> = {
  pending: "status-pending",
  approved: "status-active",
  rejected: "status-rejected",
};

export default function OvertimePage() {
  const store = useOvertimeStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("records");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.overtime, store);
  }, [initialized, store]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (o) =>
          (o.employeeName || "").toLowerCase().includes(q) ||
          (o.department || "").toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") result = result.filter((o) => o.status === statusFilter);
    return result;
  }, [items, search, statusFilter]);

  const totalHours = items.reduce((s, o) => s + (o.hours || 0), 0);
  const totalAmount = items.reduce((s, o) => s + (o.amount || 0), 0);
  const pending = items.filter((o) => o.status === "pending").length;
  const approved = items.filter((o) => o.status === "approved").length;
  const avgRate =
    items.length > 0
      ? Math.round(items.reduce((s, o) => s + (o.rate || 0), 0) / items.length)
      : 0;

  const deptBreakdown = useMemo(() => {
    const map: Record<string, { hours: number; amount: number }> = {};
    items.forEach((o) => {
      const d = o.department || "Other";
      if (!map[d]) map[d] = { hours: 0, amount: 0 };
      map[d].hours += o.hours || 0;
      map[d].amount += o.amount || 0;
    });
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.hours - a.hours);
  }, [items]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const hours = Number(fd.get("hours")) || 0;
    const rate = Number(fd.get("rate")) || 0;
    const data = {
      employeeName: fd.get("name") as string,
      department: fd.get("department") as string,
      date: fd.get("date") as string,
      hours,
      rate,
      amount: hours * rate,
      reason: fd.get("reason") as string,
      status: "pending",
    };
    try {
      await genericService(COLLECTIONS.overtime).create(data);
      toast.success("Overtime logged!");
      setDialogOpen(false);
    } catch {
      toast.error("Failed to log overtime");
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
          <h1 className="text-2xl font-bold tracking-tight">Overtime Management</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} records &middot; {totalHours} total hours
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"
        >
          <Plus className="h-4 w-4" />
          Log Overtime
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Total Hours", value: totalHours, icon: Clock, color: "from-violet-500 to-purple-600" },
          { label: "Pending", value: pending, icon: TrendingUp, color: "from-amber-500 to-orange-500" },
          { label: "Approved", value: approved, icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Total Pay", value: `₹${totalAmount.toLocaleString()}`, icon: DollarSign, color: "from-blue-500 to-cyan-500" },
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
          <Input placeholder="Search overtime records..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
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
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.overtime} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching records found.</p>
          ) : (
            filtered.map((ot) => (
              <Card key={ot.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{ot.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {ot.department} &middot; {ot.date} &middot; {ot.hours}h @ ₹{ot.rate}/h = ₹{(ot.amount || 0).toLocaleString()}
                    </p>
                  </div>
                  <Badge className={cn("text-xs", STATUS_COLORS[ot.status])}>{ot.status}</Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {items.length > 0 ? (
            <Card>
              <CardHeader><CardTitle className="text-sm">Department Breakdown</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {deptBreakdown.map((d) => (
                  <div key={d.name} className="flex items-center gap-3">
                    <span className="text-sm flex-1">{d.name}</span>
                    <span className="text-xs text-muted-foreground">{d.hours}h</span>
                    <span className="font-semibold">₹{d.amount.toLocaleString()}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <DataEmptyState {...EMPTY_STATES.overtime} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Overtime</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Employee Name</Label><Input name="name" required /></div>
              <div><Label>Department</Label><Input name="department" /></div>
              <div><Label>Date</Label><Input name="date" type="date" required /></div>
              <div><Label>Hours</Label><Input name="hours" type="number" min={0.5} step={0.5} required /></div>
              <div><Label>Rate (₹/h)</Label><Input name="rate" type="number" min={0} /></div>
            </div>
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
