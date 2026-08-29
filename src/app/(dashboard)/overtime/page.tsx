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
import { Clock, Plus, Search, DollarSign, CheckCircle2, TrendingUp, Users, Calendar, User, Building2, Calculator, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useOvertimeStore, useEmployeeStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const STATUS_COLORS: Record<string, string> = {
  pending: "status-pending",
  approved: "status-active",
  rejected: "status-rejected",
};

const OVERTIME_REASONS = [
  "Release & Deployment Support",
  "Critical Client Outage / Escalation",
  "Month-end / Year-end Closing",
  "Weekend Coverage & Maintenance",
  "High Priority Milestone Delivery",
  "Other Overtime Work",
];

export default function OvertimePage() {
  const store = useOvertimeStore();
  const empStore = useEmployeeStore();
  const { items, loading, initialized } = store;
  const employees = empStore.items;

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("records");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form state
  const [selectedEmp, setSelectedEmp] = useState("");
  const [customEmpName, setCustomEmpName] = useState("");
  const [department, setDepartment] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState(3);
  const [rate, setRate] = useState(450);
  const [reasonCategory, setReasonCategory] = useState(OVERTIME_REASONS[0]);
  const [reasonDetails, setReasonDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.overtime, store);
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

  const calculatedTotalAmount = Math.round(Number(hours || 0) * Number(rate || 0));

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (o) =>
          (o.employeeName || "").toLowerCase().includes(q) ||
          (o.department || "").toLowerCase().includes(q) ||
          (o.reason || "").toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") result = result.filter((o) => o.status === statusFilter);
    return result;
  }, [items, search, statusFilter]);

  const totalHours = items.reduce((s, o) => s + (o.hours || 0), 0);
  const totalAmount = items.reduce((s, o) => s + (o.amount || 0), 0);
  const pending = items.filter((o) => o.status === "pending").length;
  const approved = items.filter((o) => o.status === "approved").length;

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
    const finalEmpName = (selectedEmp && selectedEmp !== "other" ? selectedEmp : customEmpName).trim();
    if (!finalEmpName) {
      toast.error("Please enter or select an employee name.");
      return;
    }
    if (Number(hours) <= 0) {
      toast.error("Please enter overtime hours.");
      return;
    }

    setSubmitting(true);
    const combinedReason = [
      reasonCategory,
      reasonDetails.trim() ? `: ${reasonDetails.trim()}` : "",
    ]
      .filter(Boolean)
      .join("");

    const data = {
      employeeName: finalEmpName,
      department: department.trim() || "General",
      date,
      hours: Number(hours),
      rate: Number(rate) || 0,
      amount: calculatedTotalAmount,
      reason: combinedReason,
      status: "pending",
    };

    try {
      await genericService(COLLECTIONS.overtime).create(data);
      toast.success("Overtime logged successfully!");
      setDialogOpen(false);
      // Reset form
      setSelectedEmp("");
      setCustomEmpName("");
      setReasonDetails("");
    } catch {
      toast.error("Failed to log overtime");
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
          <h1 className="text-2xl font-bold tracking-tight">Overtime Management</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} records &middot; {totalHours} total hours &middot; ₹{totalAmount.toLocaleString("en-IN")} total pay
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2 rounded-full h-9 px-4 hover:opacity-95"
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
          { label: "Total Pay", value: `₹${totalAmount.toLocaleString("en-IN")}`, icon: DollarSign, color: "from-blue-500 to-cyan-500" },
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
          <Input placeholder="Search overtime records by employee, department, or reason..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
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
                  <div className={cn("p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white")}>
                    <Clock className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{ot.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {ot.department} &middot; {ot.date} &middot; {ot.hours}h @ ₹{ot.rate}/h = ₹{(ot.amount || 0).toLocaleString("en-IN")}
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
                    <span className="font-semibold">₹{d.amount.toLocaleString("en-IN")}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <DataEmptyState {...EMPTY_STATES.overtime} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      {/* ENHANCED LOG OVERTIME DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Log Overtime</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Record extra working hours with automated overtime pay computation.
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
                  placeholder="e.g. Operations, IT Support"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Date, Hours, Rate & Live Total Pay Box */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  Overtime Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Hours Worked <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={hours || ""}
                  onChange={(e) => setHours(Number(e.target.value))}
                  placeholder="3"
                  className="h-9 text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Rate (₹/hour)</Label>
                <Input
                  type="number"
                  min={0}
                  step={50}
                  value={rate || ""}
                  onChange={(e) => setRate(Number(e.target.value))}
                  placeholder="450"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Live Computed Amount Banner */}
            <div className="p-3 rounded-lg border bg-violet-50/60 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-violet-500" />
                <span className="text-xs font-medium text-foreground">
                  Computed Overtime Payout:
                </span>
                <span className="text-xs text-muted-foreground">({hours}h × ₹{rate}/h)</span>
              </div>
              <span className="text-base font-extrabold text-violet-700 dark:text-violet-300">
                ₹{calculatedTotalAmount.toLocaleString("en-IN")}
              </span>
            </div>

            {/* Reason Category */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Work Justification Category</Label>
              <Select value={reasonCategory} onValueChange={setReasonCategory}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OVERTIME_REASONS.map((r) => (
                    <SelectItem key={r} value={r} className="text-xs">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Reason / Remarks */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                Task Description &amp; Details
              </Label>
              <Textarea
                value={reasonDetails}
                onChange={(e) => setReasonDetails(e.target.value)}
                placeholder="Specific tickets, systems worked on, or project deliverables completed..."
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
                {submitting ? "Logging…" : "Log Overtime"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
