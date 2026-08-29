"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Home, Plus, Search, Clock, CheckCircle2, XCircle, Users, Calendar, User, Building2, Laptop, Sun, Moon, FileText, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useWfhStore, useEmployeeStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const STATUS_COLORS: Record<string, string> = {
  pending: "status-pending",
  approved: "status-active",
  rejected: "status-rejected",
};

const WFH_COVERAGE = [
  { value: "full", label: "Full Day (1.0 d)", icon: Laptop },
  { value: "first_half", label: "First Half (0.5 d)", icon: Sun },
  { value: "second_half", label: "Second Half (0.5 d)", icon: Moon },
];

const REASON_CATEGORIES = [
  "Personal & Family Care",
  "Health & Medical Recovery",
  "Focused Deep Work / Sprint Delivery",
  "Commute / Severe Weather",
  "Home Maintenance / Delivery",
  "Other Reason",
];

export default function WfhPage() {
  const store = useWfhStore();
  const empStore = useEmployeeStore();
  const { items, loading, initialized } = store;
  const employees = empStore.items;

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("requests");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form state
  const [selectedEmp, setSelectedEmp] = useState("");
  const [customEmpName, setCustomEmpName] = useState("");
  const [department, setDepartment] = useState("");
  const [wfhType, setWfhType] = useState("full");
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reasonCategory, setReasonCategory] = useState(REASON_CATEGORIES[0]);
  const [reasonDetails, setReasonDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.wfh, store);
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
  }, [initialized, store, empStore]);

  // When an employee is chosen from the store, auto-populate department
  const handleEmployeeSelect = (empValue: string) => {
    setSelectedEmp(empValue);
    if (empValue === "other") {
      setCustomEmpName("");
      setDepartment("");
      return;
    }
    const found = employees.find((e) => {
      const name = [e.firstName, e.lastName].filter(Boolean).join(" ");
      return name === empValue || e.employeeCode === empValue || e.id === empValue;
    });
    if (found) {
      setDepartment(found.department || "");
    }
  };

  // Smart business days calculation excluding Saturdays and Sundays
  const computedDays = useMemo(() => {
    if (wfhType !== "full") return 0.5;
    if (!fromDate || !toDate) return 1;
    const start = new Date(`${fromDate}T00:00:00Z`);
    const end = new Date(`${toDate}T00:00:00Z`);
    if (end < start) return 1;
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const day = cur.getUTCDay();
      if (day !== 0 && day !== 6) {
        count++;
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return count > 0 ? count : 1;
  }, [fromDate, toDate, wfhType]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (w) =>
          (w.employeeName || "").toLowerCase().includes(q) ||
          (w.department || "").toLowerCase().includes(q) ||
          (w.reason || "").toLowerCase().includes(q)
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
    const finalEmpName = (selectedEmp && selectedEmp !== "other" ? selectedEmp : customEmpName).trim();
    if (!finalEmpName) {
      toast.error("Please enter or select an employee name.");
      return;
    }

    setSubmitting(true);
    const combinedReason = [
      reasonCategory,
      wfhType !== "full" ? `(${wfhType === "first_half" ? "First Half" : "Second Half"})` : "",
      reasonDetails.trim() ? `: ${reasonDetails.trim()}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const data = {
      employeeName: finalEmpName,
      department: department.trim() || "General",
      fromDate,
      toDate: wfhType === "full" ? toDate : fromDate,
      days: computedDays,
      reason: combinedReason,
      status: "pending",
      employeeId: "",
    };

    try {
      await genericService(COLLECTIONS.wfh).create(data);
      toast.success("WFH request submitted successfully!");
      setDialogOpen(false);
      // Reset form
      setSelectedEmp("");
      setCustomEmpName("");
      setReasonDetails("");
    } catch {
      toast.error("Failed to submit WFH request");
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
          <h1 className="text-2xl font-bold tracking-tight">Work From Home</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} requests &middot; {pending} pending
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2 rounded-full h-9 px-4 hover:opacity-95"
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
          <Input placeholder="Search WFH requests by employee, department, or reason..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
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
                  <div className={cn("p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white")}>
                    <Home className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{req.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {req.department} &middot; {req.fromDate} {req.toDate && req.toDate !== req.fromDate ? `→ ${req.toDate}` : ""} ({req.days}d) &middot; {req.reason}
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

      {/* ENHANCED REQUEST WFH DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <Home className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Request Work From Home (WFH)</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Submit a remote work schedule with automated working-days calculation.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            {/* Employee & Department */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-violet-500" />
                  Employee Name <span className="text-destructive">*</span>
                </Label>
                {employees && employees.length > 0 ? (
                  <div className="space-y-1.5">
                    <Select value={selectedEmp} onValueChange={handleEmployeeSelect}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Select employee..." />
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
                          + Enter other / manual name
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {selectedEmp === "other" && (
                      <Input
                        placeholder="Enter full name"
                        value={customEmpName}
                        onChange={(e) => setCustomEmpName(e.target.value)}
                        className="h-9 text-xs mt-1"
                        required
                      />
                    )}
                  </div>
                ) : (
                  <Input
                    name="name"
                    placeholder="e.g. Rahul Sharma"
                    value={customEmpName}
                    onChange={(e) => setCustomEmpName(e.target.value)}
                    className="h-9 text-xs"
                    required
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Department
                </Label>
                <Input
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="e.g. Engineering, Product"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Coverage Type Pills */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Coverage Type</Label>
              <div className="grid grid-cols-3 gap-2">
                {WFH_COVERAGE.map((c) => {
                  const Icon = c.icon;
                  const active = wfhType === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setWfhType(c.value)}
                      className={cn(
                        "flex items-center justify-center gap-2 p-2 rounded-lg border text-xs font-medium transition-all",
                        active
                          ? "bg-violet-50 dark:bg-violet-950/40 border-violet-500 text-violet-700 dark:text-violet-300 shadow-xs"
                          : "bg-background hover:bg-muted/50 text-muted-foreground border-border"
                      )}
                    >
                      <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-violet-600" : "text-muted-foreground")} />
                      <span className="truncate">{c.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* WFH Dates & Working Days Badge */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  From Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>

              {wfhType === "full" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    To Date <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="date"
                    value={toDate}
                    min={fromDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="h-9 text-xs"
                    required
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">Session</Label>
                  <div className="h-9 rounded-md border bg-muted/30 px-3 flex items-center text-xs text-muted-foreground">
                    {wfhType === "first_half" ? "09:00 AM – 01:30 PM" : "02:00 PM – 06:30 PM"}
                  </div>
                </div>
              )}

              {/* Working Days Pill */}
              <div className="p-2 rounded-lg border bg-violet-50/50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800 text-center flex flex-col justify-center h-9">
                <span className="text-xs font-bold text-violet-700 dark:text-violet-300">
                  {computedDays} Working {computedDays === 1 ? "Day" : "Days"}
                </span>
              </div>
            </div>

            {/* Reason Category */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Reason Category</Label>
              <Select value={reasonCategory} onValueChange={setReasonCategory}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASON_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat} className="text-xs">
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Reason Details & Planned Tasks */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                Details &amp; Key Deliverables
              </Label>
              <Textarea
                value={reasonDetails}
                onChange={(e) => setReasonDetails(e.target.value)}
                placeholder="Briefly describe key tasks or reasons for remote work..."
                rows={2}
                className="text-xs resize-none"
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
                {submitting ? "Submitting…" : "Submit WFH Request"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
