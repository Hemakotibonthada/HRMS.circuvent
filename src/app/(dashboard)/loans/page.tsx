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
import { Progress } from "@/components/ui/progress";
import { Banknote, Plus, Search, Clock, CheckCircle2, TrendingDown, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useLoanStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

const STATUS_COLORS: Record<string, string> = {
  pending: "status-pending",
  active: "status-active",
  closed: "status-inactive",
  rejected: "status-rejected",
};

export default function LoansPage() {
  const store = useLoanStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("list");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!initialized) startSync(COLLECTIONS.loans, store);
  }, [initialized, store]);

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

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const amount = Number(fd.get("amount")) || 0;
    const tenure = Number(fd.get("tenure")) || 12;
    const data = {
      employeeName: fd.get("name") as string,
      loanType: fd.get("loanType") as string,
      amount,
      tenure,
      emi: Math.round(amount / tenure),
      outstanding: amount,
      status: "pending",
      startDate: fd.get("startDate") as string,
    };
    try {
      await genericService(COLLECTIONS.loans).create(data);
      toast.success("Loan application submitted!");
      setDialogOpen(false);
    } catch {
      toast.error("Failed to submit application");
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
          <h1 className="text-2xl font-bold tracking-tight">Loans & Advances</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {items.length} loans &middot; ₹{totalOutstanding.toLocaleString()} outstanding
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"
        >
          <Plus className="h-4 w-4" />
          Apply for Loan
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        {[
          { label: "Disbursed", value: `₹${totalDisbursed.toLocaleString()}`, icon: DollarSign, color: "from-violet-500 to-purple-600" },
          { label: "Outstanding", value: `₹${totalOutstanding.toLocaleString()}`, icon: TrendingDown, color: "from-red-500 to-rose-500" },
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
        <Input placeholder="Search loans..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
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
                      {loan.loanType} &middot; ₹{(loan.amount || 0).toLocaleString()} &middot; EMI ₹{(loan.emi || 0).toLocaleString()} &middot; {loan.tenure}mo
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
                      <span className="font-semibold">₹{t.total.toLocaleString()}</span>
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
                    <span>Repaid: ₹{(totalDisbursed - totalOutstanding).toLocaleString()}</span>
                    <span>Remaining: ₹{totalOutstanding.toLocaleString()}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <DataEmptyState {...EMPTY_STATES.loans} compact onAction={() => setDialogOpen(true)} />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Apply for Loan</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Employee Name</Label><Input name="name" required /></div>
              <div>
                <Label>Loan Type</Label>
                <Select name="loanType">
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Salary Advance">Salary Advance</SelectItem>
                    <SelectItem value="Personal Loan">Personal Loan</SelectItem>
                    <SelectItem value="Education Loan">Education Loan</SelectItem>
                    <SelectItem value="Emergency">Emergency</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Amount (₹)</Label><Input name="amount" type="number" min={1000} required /></div>
              <div><Label>Tenure (months)</Label><Input name="tenure" type="number" defaultValue={12} min={1} /></div>
            </div>
            <div><Label>Start Date</Label><Input name="startDate" type="date" required /></div>
            <DialogFooter>
              <Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white">Apply</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
