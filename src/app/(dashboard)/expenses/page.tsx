"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Receipt, Plus, Search, CheckCircle2, Clock, DollarSign, Eye,
  TrendingUp, FileText, Upload, AlertTriangle, Filter,
  CreditCard, ArrowUpRight, Building2, Calendar, Tag,
  ThumbsUp, ThumbsDown, Download, Wallet, PieChart as PieIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
  Tooltip as RTooltip,
} from "recharts";
import { useExpenseStore, startSync, type ExpenseDoc } from "@/stores/unified-store";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// EXPENSES — Expense claims, approval workflow, category
// analytics, monthly trends, and policy limits
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const CATEGORIES = ["Travel", "Meals", "Office Supplies", "Software", "Training", "Equipment", "Communication", "Miscellaneous"];
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  submitted: { label: "Submitted", className: "status-pending" },
  pending: { label: "Pending", className: "status-pending" },
  approved: { label: "Approved", className: "status-active" },
  rejected: { label: "Rejected", className: "status-rejected" },
  reimbursed: { label: "Reimbursed", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
};
// A per-category "policy limit" map used to live here (Travel: ₹50,000,
// Meals: ₹5,000, ...) and was displayed to employees and approvers as if it
// were a real, admin-configured company policy. No such policy is
// configured anywhere in this app — the numbers were invented once and
// never touched again, so the "Max ₹X per quarter" and progress bars that
// depended on them were removed rather than shown as real policy.

export default function ExpensesPage() {
  const store = useExpenseStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tab, setTab] = useState("claims");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<ExpenseDoc | null>(null);
  const [form, setForm] = useState({
    employeeName: "", department: "", category: "",
    amount: "", date: "", description: "", receipt: false,
  });

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.expenses, store); }, [initialized, store]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(e =>
        e.employeeName?.toLowerCase().includes(q) ||
        e.category?.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== "all") result = result.filter(e => e.category === categoryFilter);
    if (statusFilter !== "all") result = result.filter(e => e.status === statusFilter);
    return result;
  }, [items, search, categoryFilter, statusFilter]);

  // KPIs
  const submittedTotal = items.reduce((s, e) => s + (e.amount || 0), 0);
  const pendingTotal = items.filter(e => e.status === "pending" || e.status === "submitted").reduce((s, e) => s + (e.amount || 0), 0);
  const approvedTotal = items.filter(e => e.status === "approved").reduce((s, e) => s + (e.amount || 0), 0);
  const reimbursedTotal = items.filter(e => e.status === "reimbursed").reduce((s, e) => s + (e.amount || 0), 0);

  // Category breakdown
  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(e => {
      counts[e.category || "Other"] = (counts[e.category || "Other"] || 0) + (e.amount || 0);
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  // Monthly trend
  const monthlyData = useMemo(() => {
    const byMonth: Record<string, number> = {};
    items.forEach(e => {
      if (!e.date) return;
      const d = new Date(e.date);
      const key = d.toLocaleString("default", { month: "short", year: "2-digit" });
      byMonth[key] = (byMonth[key] || 0) + (e.amount || 0);
    });
    return Object.entries(byMonth).map(([name, value]) => ({ name, value }));
  }, [items]);

  const resetForm = () => setForm({ employeeName: "", department: "", category: "", amount: "", date: "", description: "", receipt: false });

  const handleCreate = async () => {
    if (!form.employeeName || !form.category || !form.amount) {
      toast.error("Please fill required fields"); return;
    }
    try {
      await genericService(COLLECTIONS.expenses).create({
        ...form,
        amount: Number(form.amount),
        status: "submitted",
      });
      toast.success("Expense claim submitted!");
      setCreateOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to submit expense");
    }
  };

  const handleAction = async (id: string, action: string) => {
    try {
      await genericService(COLLECTIONS.expenses).update(id, { status: action });
      toast.success(`Expense ${action}`);
      if (selectedExpense?.id === id) setSelectedExpense(null);
    } catch {
      toast.error("Failed to update expense");
    }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && items.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.expenses} onAction={() => setCreateOpen(true)} />;
  }

  const kpis = [
    { label: "Total Submitted", value: `₹${submittedTotal.toLocaleString()}`, icon: Receipt, gradient: "from-violet-500 to-purple-600" },
    { label: "Pending", value: `₹${pendingTotal.toLocaleString()}`, icon: Clock, gradient: "from-amber-500 to-orange-500" },
    { label: "Approved", value: `₹${approvedTotal.toLocaleString()}`, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "Reimbursed", value: `₹${reimbursedTotal.toLocaleString()}`, icon: Wallet, gradient: "from-blue-500 to-cyan-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Expenses</h1>
          <p className="text-muted-foreground mt-1">Submit, track, and manage expense claims</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Submit Expense
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                  <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                </div>
                <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.gradient)}>
                  <kpi.icon className="h-5 w-5 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name, category..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="reimbursed">Reimbursed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="claims">Claims</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Claims Tab */}
        <TabsContent value="claims" className="space-y-3 mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.expenses} compact onAction={() => setCreateOpen(true)} />
          ) : (
            filtered.map((exp) => {
              const st = STATUS_CONF[exp.status] || STATUS_CONF.submitted;
              return (
                <Card key={exp.id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedExpense(exp)}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                          <Receipt className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{exp.employeeName}</h3>
                            <Badge variant="outline"><Tag className="h-3 w-3 mr-1" />{exp.category}</Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                            <span>{exp.description || "No description"}</span>
                            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{exp.date}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-lg font-bold">₹{(exp.amount || 0).toLocaleString()}</p>
                        <Badge className={st.className}>{st.label}</Badge>
                        {(exp.status === "submitted" || exp.status === "pending") && (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600" onClick={(e) => { e.stopPropagation(); handleAction(exp.id, "approved"); }}>
                              <ThumbsUp className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={(e) => { e.stopPropagation(); handleAction(exp.id, "rejected"); }}>
                              <ThumbsDown className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                        {exp.receipt && <Badge variant="outline" className="text-xs"><Upload className="h-3 w-3 mr-1" />Receipt</Badge>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Expense by Category</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                      {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Monthly Expense Trend</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="value" name="Amount" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* A "Category Policy Limits" card used to sit here, comparing
              real per-category spend against invented limits (e.g. "Travel:
              ₹50,000 per quarter") that no admin ever configured — nothing
              in this app defines expense policy limits, so the comparison
              was fake even though the spend half of it was real. The
              category pie chart above already shows the real spend
              breakdown without pretending a limit exists. */}
        </TabsContent>
      </Tabs>

      {/* Expense Detail Dialog */}
      <Dialog open={!!selectedExpense} onOpenChange={(v) => { if (!v) setSelectedExpense(null); }}>
        <DialogContent>
          {selectedExpense && (
            <>
              <DialogHeader><DialogTitle>Expense Claim Details</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-xs">
                        {selectedExpense.employeeName?.split(" ").map(n => n[0]).join("").slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold">{selectedExpense.employeeName}</p>
                      <p className="text-sm text-muted-foreground">{selectedExpense.department}</p>
                    </div>
                  </div>
                  <Badge className={(STATUS_CONF[selectedExpense.status] || STATUS_CONF.submitted).className}>
                    {(STATUS_CONF[selectedExpense.status] || STATUS_CONF.submitted).label}
                  </Badge>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Category</p><p className="font-medium">{selectedExpense.category}</p></div>
                  <div><p className="text-muted-foreground">Date</p><p className="font-medium">{selectedExpense.date}</p></div>
                  <div><p className="text-muted-foreground">Amount</p><p className="font-bold text-lg">₹{(selectedExpense.amount || 0).toLocaleString()}</p></div>
                  <div><p className="text-muted-foreground">Receipt</p><p className="font-medium">{selectedExpense.receipt ? "Attached" : "Not attached"}</p></div>
                </div>
                {selectedExpense.description && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Description</p>
                      <p className="text-sm">{selectedExpense.description}</p>
                    </div>
                  </>
                )}
                {/* This dialog used to assert a per-category "Policy Limit"
                    (e.g. "Max: ₹50,000 per quarter") here, which could have
                    influenced a real approve/reject decision even though no
                    such policy was ever configured anywhere in the app. */}
              </div>
              <DialogFooter className="gap-2">
                {(selectedExpense.status === "submitted" || selectedExpense.status === "pending") && (
                  <>
                    <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => handleAction(selectedExpense.id, "rejected")}>Reject</Button>
                    <Button className="bg-gradient-to-r from-emerald-500 to-green-600 text-white border-0" onClick={() => handleAction(selectedExpense.id, "approved")}>Approve</Button>
                  </>
                )}
                {selectedExpense.status === "approved" && (
                  <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-0" onClick={() => handleAction(selectedExpense.id, "reimbursed")}>
                    Mark Reimbursed
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Submit Expense Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Submit Expense</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Employee Name *</Label>
                <Input value={form.employeeName} onChange={(e) => setForm(f => ({ ...f, employeeName: e.target.value }))} placeholder="Your name" />
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={form.department} onChange={(e) => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Department" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category *</Label>
                <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount (₹) *</Label>
                <Input type="number" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the expense..." rows={3} />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="receipt" checked={form.receipt} onChange={(e) => setForm(f => ({ ...f, receipt: e.target.checked }))} className="rounded" />
              <Label htmlFor="receipt" className="text-sm font-normal cursor-pointer">I have a receipt</Label>
            </div>
            {/* A "Policy limit for {category}: ₹X per quarter" hint used to
                render here, telling the employee about a per-category cap
                that was invented for display purposes only — no such policy
                is configured anywhere in the app, so showing it risked an
                employee under- or over-claiming against a rule that doesn't
                actually exist. */}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" /> Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
