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
import { Progress } from "@/components/ui/progress";
import { Banknote, Plus, Search, Clock, CheckCircle2, TrendingDown, DollarSign, Calculator, Calendar, User, FileText, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useLoanStore, useEmployeeStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const STATUS_COLORS: Record<string, string> = {
  pending: "status-pending",
  active: "status-active",
  closed: "status-inactive",
  rejected: "status-rejected",
};

const LOAN_TYPES = [
  { value: "Salary Advance", label: "Salary Advance", desc: "Short-term salary deduction", max: 100000 },
  { value: "Personal Loan", label: "Personal Loan", desc: "General personal financial support", max: 500000 },
  { value: "Emergency", label: "Medical & Emergency Loan", desc: "Urgent health or crisis aid", max: 300000 },
  { value: "Education Loan", label: "Education & Upskilling", desc: "Certifications and degree courses", max: 400000 },
  { value: "Housing & Home", label: "Housing & Relocation", desc: "Rental deposit or relocation support", max: 500000 },
];

const QUICK_AMOUNTS = [25000, 50000, 100000, 200000, 300000];

export default function LoansPage() {
  const store = useLoanStore();
  const empStore = useEmployeeStore();
  const { items, loading, initialized } = store;
  const employees = empStore.items;

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form state
  const [selectedEmp, setSelectedEmp] = useState("");
  const [customEmpName, setCustomEmpName] = useState("");
  const [loanType, setLoanType] = useState("Salary Advance");
  const [amount, setAmount] = useState(50000);
  const [tenure, setTenure] = useState(12);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.loans, store);
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
  }, [initialized, store, empStore]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (l) =>
        (l.employeeName || "").toLowerCase().includes(q) ||
        (l.loanType || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const totalDisbursed = items.reduce((s, l) => s + (l.amount || 0), 0);
  const totalOutstanding = items.reduce((s, l) => s + (l.outstanding || 0), 0);
  const activeLoans = items.filter((l) => l.status === "active").length;
  const pending = items.filter((l) => l.status === "pending").length;
  const repaidPercent =
    totalDisbursed > 0
      ? Math.round(((totalDisbursed - totalOutstanding) / totalDisbursed) * 100)
      : 0;

  const typeBreakdown = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    items.forEach((l) => {
      const t = l.loanType || "Other";
      if (!map[t]) map[t] = { count: 0, total: 0 };
      map[t].count++;
      map[t].total += l.amount || 0;
    });
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [items]);

  // Derived EMI and End Date
  const emi = tenure > 0 ? Math.round(amount / tenure) : 0;
  const endDate = useMemo(() => {
    if (!startDate || tenure <= 0) return "";
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + Number(tenure));
    return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  }, [startDate, tenure]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const finalEmpName = (selectedEmp && selectedEmp !== "other" ? selectedEmp : customEmpName).trim();
    if (!finalEmpName) {
      toast.error("Please enter or select an employee name.");
      return;
    }
    if (amount <= 0) {
      toast.error("Please enter a valid loan amount.");
      return;
    }

    setSubmitting(true);
    const data = {
      employeeName: finalEmpName,
      loanType,
      amount: Number(amount),
      tenure: Number(tenure),
      emi,
      outstanding: Number(amount),
      status: "pending",
      startDate,
      reason: reason.trim() || undefined,
    };

    try {
      await genericService(COLLECTIONS.loans).create(data);
      toast.success("Loan application submitted successfully!");
      setDialogOpen(false);
      // Reset form
      setSelectedEmp("");
      setCustomEmpName("");
      setAmount(50000);
      setTenure(12);
      setReason("");
    } catch {
      toast.error("Failed to submit loan application");
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
          <h1 className="text-2xl font-bold tracking-tight">Loans &amp; Advances</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} loans &middot; ₹{totalOutstanding.toLocaleString("en-IN")} outstanding
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2 rounded-full h-9 px-4 hover:opacity-95"
        >
          <Plus className="h-4 w-4" />
          Apply for Loan
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Disbursed", value: `₹${totalDisbursed.toLocaleString("en-IN")}`, icon: DollarSign, color: "from-violet-500 to-purple-600" },
          { label: "Outstanding", value: `₹${totalOutstanding.toLocaleString("en-IN")}`, icon: TrendingDown, color: "from-red-500 to-rose-500" },
          { label: "Active Loans", value: activeLoans, icon: CheckCircle2, color: "from-emerald-500 to-green-600" },
          { label: "Pending", value: pending, icon: Clock, color: "from-amber-500 to-orange-500" },
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
        <Input placeholder="Search loans by employee or loan type..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">Loans</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3 mt-4">
          {items.length === 0 && initialized ? (
            <DataEmptyState {...EMPTY_STATES.loans} onAction={() => setDialogOpen(true)} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No matching loans found.</p>
          ) : (
            filtered.map((loan) => (
              <Card key={loan.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={cn("p-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white")}>
                    <Banknote className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{loan.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {loan.loanType} &middot; ₹{(loan.amount || 0).toLocaleString("en-IN")} &middot; EMI ₹{(loan.emi || 0).toLocaleString("en-IN")} &middot; {loan.tenure}mo
                    </p>
                  </div>
                  <Badge className={cn("text-xs", STATUS_COLORS[loan.status])}>{loan.status}</Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {items.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Loan Types</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {typeBreakdown.map((t) => (
                    <div key={t.name} className="flex items-center gap-3">
                      <span className="text-sm flex-1">{t.name}</span>
                      <span className="text-xs text-muted-foreground">{t.count} loans</span>
                      <span className="font-semibold">₹{t.total.toLocaleString("en-IN")}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm">Repayment Progress</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-center">
                    <p className="text-3xl font-bold">{repaidPercent}%</p>
                    <p className="text-xs text-muted-foreground">Overall repaid</p>
                  </div>
                  <Progress value={repaidPercent} className="h-3" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Repaid: ₹{(totalDisbursed - totalOutstanding).toLocaleString("en-IN")}</span>
                    <span>Remaining: ₹{totalOutstanding.toLocaleString("en-IN")}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <DataEmptyState {...EMPTY_STATES.loans} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      {/* ENHANCED APPLY FOR LOAN DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <Banknote className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Apply for Loan &amp; Advance</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Submit a salary advance or employee loan request with automated EMI calculation.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            {/* Employee Selection */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-violet-500" />
                Employee Name <span className="text-destructive">*</span>
              </Label>
              {employees && employees.length > 0 ? (
                <div className="space-y-2">
                  <Select value={selectedEmp} onValueChange={setSelectedEmp}>
                    <SelectTrigger className="w-full h-9 text-xs">
                      <SelectValue placeholder="Select an employee..." />
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
                      placeholder="Enter full employee name"
                      value={customEmpName}
                      onChange={(e) => setCustomEmpName(e.target.value)}
                      className="h-9 text-xs mt-1.5"
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

            {/* Loan Type & Start Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Loan Type <span className="text-destructive">*</span></Label>
                <Select value={loanType} onValueChange={setLoanType}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOAN_TYPES.map((lt) => (
                      <SelectItem key={lt.value} value={lt.value} className="text-xs">
                        {lt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-violet-500" />
                  Repayment Start Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>
            </div>

            {/* Loan Amount with Quick Chips */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">
                  Loan Amount (₹) <span className="text-destructive">*</span>
                </Label>
                <span className="text-xs font-bold text-violet-600 dark:text-violet-400">
                  ₹{Number(amount || 0).toLocaleString("en-IN")}
                </span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">₹</span>
                <Input
                  type="number"
                  min={1000}
                  step={1000}
                  value={amount || ""}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  placeholder="50000"
                  className="pl-7 h-9 text-xs font-medium"
                  required
                />
              </div>
              {/* Quick Amount Suggestion Chips */}
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-[11px] text-muted-foreground mr-1">Quick select:</span>
                {QUICK_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setAmount(amt)}
                    className={cn(
                      "text-[11px] px-2 py-0.5 rounded-full border transition-all",
                      amount === amt
                        ? "bg-violet-600 text-white border-violet-600 font-semibold shadow-xs"
                        : "bg-muted/50 hover:bg-muted text-muted-foreground border-border"
                    )}
                  >
                    ₹{amt.toLocaleString("en-IN")}
                  </button>
                ))}
              </div>
            </div>

            {/* Tenure (Months) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Tenure (Months) <span className="text-destructive">*</span></Label>
                <Select value={String(tenure)} onValueChange={(v) => setTenure(Number(v))}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[3, 6, 9, 12, 18, 24, 36, 48].map((m) => (
                      <SelectItem key={m} value={String(m)} className="text-xs">
                        {m} Months ({Math.round(m / 12 * 10) / 10} yrs)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Live EMI Box */}
              <div className="p-3 rounded-lg border bg-violet-50/60 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800 flex flex-col justify-center">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1 font-medium text-foreground">
                    <Calculator className="h-3.5 w-3.5 text-violet-500" />
                    Monthly EMI
                  </span>
                  <span className="text-[11px]">0% Interest</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-lg font-extrabold text-violet-700 dark:text-violet-300">
                    ₹{emi.toLocaleString("en-IN")} <span className="text-[11px] font-normal text-muted-foreground">/ month</span>
                  </span>
                  {endDate && <span className="text-[10px] text-muted-foreground">till {endDate}</span>}
                </div>
              </div>
            </div>

            {/* Reason / Remarks */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                Reason / Purpose
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Brief description of the need (e.g., Medical emergency, course fee payment, relocation deposit)..."
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
                {submitting ? "Submitting…" : "Submit Application"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
