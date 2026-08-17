"use client";

import { useState, useEffect, useMemo } from "react";
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
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Receipt, Plus, Search, CheckCircle2, Clock, DollarSign,
  TrendingUp, PieChart as PieIcon, Wallet, ArrowUpRight,
  ThumbsUp, ThumbsDown, Tag, Calendar, Building2, Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip,
} from "recharts";
import { useExpenseStore, startSync, type ExpenseDoc } from "@/stores/unified-store";
import { COLLECTIONS, genericService } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// EXPENSE HUB — Expense analytics, trends, policy limits
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
const POLICY_LIMITS: Record<string, number> = {
  Travel: 50000, Meals: 5000, "Office Supplies": 10000, Software: 25000,
  Training: 30000, Equipment: 50000, Communication: 3000, Miscellaneous: 5000,
};

export default function ExpenseHubPage() {
  const store = useExpenseStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("analytics");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    employeeName: "", department: "", category: "",
    amount: "", date: "", description: "", receipt: false,
  });

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.expenses, store); }, [initialized, store]);

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

  // Monthly spend trend
  const monthlyTrend = useMemo(() => {
    const byMonth: Record<string, number> = {};
    items.forEach(e => {
      if (!e.date) return;
      const d = new Date(e.date);
      const key = d.toLocaleString("default", { month: "short", year: "2-digit" });
      byMonth[key] = (byMonth[key] || 0) + (e.amount || 0);
    });
    return Object.entries(byMonth).map(([name, value]) => ({ name, value }));
  }, [items]);

  // Policy usage
  const policyUsage = useMemo(() => {
    const used: Record<string, number> = {};
    items.filter(e => e.status === "approved" || e.status === "reimbursed").forEach(e => {
      used[e.category || "Other"] = (used[e.category || "Other"] || 0) + (e.amount || 0);
    });
    return CATEGORIES.map(c => ({
      name: c, used: used[c] || 0, limit: POLICY_LIMITS[c] || 10000,
      percent: Math.round(((used[c] || 0) / (POLICY_LIMITS[c] || 10000)) * 100),
    }));
  }, [items]);

  // Top spenders
  const topSpenders = useMemo(() => {
    const byEmployee: Record<string, number> = {};
    items.forEach(e => {
      byEmployee[e.employeeName || "Unknown"] = (byEmployee[e.employeeName || "Unknown"] || 0) + (e.amount || 0);
    });
    return Object.entries(byEmployee)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, total]) => ({ name, total }));
  }, [items]);

  // Approval queue
  const pendingApprovals = useMemo(() =>
    items.filter(e => e.status === "submitted" || e.status === "pending"),
  [items]);

  // Budget utilization
  const budgetTotal = Object.values(POLICY_LIMITS).reduce((s, v) => s + v, 0);
  const budgetUsed = approvedTotal + reimbursedTotal;
  const budgetPercent = budgetTotal > 0 ? Math.round((budgetUsed / budgetTotal) * 100) : 0;

  const handleCreate = async () => {
    if (!form.employeeName || !form.category || !form.amount) {
      toast.error("Please fill required fields"); return;
    }
    try {
      await genericService(COLLECTIONS.expenses).create({
        ...form, amount: Number(form.amount),
        status: "submitted", receipt: form.receipt,
      });
      toast.success("Expense claim submitted!");
      setCreateOpen(false);
      setForm({ employeeName: "", department: "", category: "", amount: "", date: "", description: "", receipt: false });
    } catch { toast.error("Failed to submit expense"); }
  };

  const handleAction = async (id: string, action: string) => {
    try {
      await genericService(COLLECTIONS.expenses).update(id, { status: action });
      toast.success(`Expense ${action}`);
    } catch { toast.error("Failed to update expense"); }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && items.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.expenses} onAction={() => setCreateOpen(true)} />;
  }

  const kpis = [
    { label: "Total Submitted", value: `₹${submittedTotal.toLocaleString()}`, icon: Receipt, gradient: "from-violet-500 to-purple-600" },
    { label: "Approved", value: `₹${approvedTotal.toLocaleString()}`, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "Reimbursed", value: `₹${reimbursedTotal.toLocaleString()}`, icon: Wallet, gradient: "from-blue-500 to-cyan-500" },
    { label: "Pending", value: `₹${pendingTotal.toLocaleString()}`, icon: Clock, gradient: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Expense Hub</h1>
          <p className="text-muted-foreground mt-1">Expense analytics, policy limits &amp; budget tracking</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Quick Claim
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(kpi => (
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="approvals">Approval Queue ({pendingApprovals.length})</TabsTrigger>
          <TabsTrigger value="policy">Policy Limits</TabsTrigger>
        </TabsList>

        {/* Analytics */}
        <TabsContent value="analytics" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Category Breakdown</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
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
              <CardHeader><CardTitle className="text-base">Monthly Spend Trend</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={monthlyTrend}>
                    <defs>
                      <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Area type="monotone" dataKey="value" name="Spend" stroke="#8b5cf6" fill="url(#expGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Top Spenders & Budget */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Top Spenders</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {topSpenders.map((sp, i) => (
                  <div key={sp.name} className="flex items-center gap-3">
                    <span className="text-sm font-bold text-muted-foreground w-5">{i + 1}</span>
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-xs">
                        {sp.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{sp.name}</p>
                    </div>
                    <p className="font-semibold text-sm">₹{sp.total.toLocaleString()}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Budget Utilization</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center">
                  <div className="relative inline-block">
                    <svg className="h-32 w-32 -rotate-90" viewBox="0 0 36 36">
                      <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none" stroke="currentColor" className="text-muted/20" strokeWidth="3" />
                      <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none" stroke="#8b5cf6" strokeWidth="3"
                        strokeDasharray={`${budgetPercent}, 100`} strokeLinecap="round" />
                    </svg>
                    <span className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold">{budgetPercent}%</span>
                      <span className="text-xs text-muted-foreground">utilized</span>
                    </span>
                  </div>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Used: ₹{budgetUsed.toLocaleString()}</span>
                  <span className="text-muted-foreground">Total: ₹{budgetTotal.toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Approval Queue */}
        <TabsContent value="approvals" className="space-y-3 mt-4">
          {pendingApprovals.length === 0 ? (
            <DataEmptyState icon={CheckCircle2} title="All caught up!" description="No pending expense approvals." compact />
          ) : pendingApprovals.map(exp => (
            <Card key={exp.id} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-gradient-to-br from-amber-500 to-orange-500 text-white text-xs">
                        {exp.employeeName?.split(" ").map(n => n[0]).join("").slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-sm">{exp.employeeName}</p>
                      <p className="text-xs text-muted-foreground">{exp.category} &middot; {exp.date}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="font-bold">₹{(exp.amount || 0).toLocaleString()}</p>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600" onClick={() => handleAction(exp.id, "approved")}>
                      <ThumbsUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => handleAction(exp.id, "rejected")}>
                      <ThumbsDown className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Policy Limits */}
        <TabsContent value="policy" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Category Policy Limits</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {policyUsage.map(p => (
                  <div key={p.name} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground">₹{p.used.toLocaleString()} / ₹{p.limit.toLocaleString()}</span>
                    </div>
                    <Progress value={Math.min(p.percent, 100)} className={cn("h-2.5",
                      p.percent > 90 ? "[&>div]:bg-red-500" : p.percent > 70 ? "[&>div]:bg-amber-500" : "")} />
                    {p.percent > 90 && (
                      <p className="text-xs text-red-500 flex items-center gap-1"><ArrowUpRight className="h-3 w-3" /> Approaching limit</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Quick Claim Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Quick Expense Claim</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Employee Name *</Label>
                <Input value={form.employeeName} onChange={e => setForm(f => ({ ...f, employeeName: e.target.value }))} placeholder="Your name" />
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Department" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category *</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount (₹) *</Label>
                <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the expense..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" /> Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
