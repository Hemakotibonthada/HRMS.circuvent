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
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  DollarSign, Plus, Search, Users, Building2, FileText, Download,
  TrendingUp, CheckCircle2, AlertTriangle, Clock, CreditCard,
  Receipt, ArrowUpRight, ArrowDownRight, Eye, Printer, Filter,
  Calendar, Banknote, ShieldCheck, Percent, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRBAC } from "@/hooks/use-rbac";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
  Tooltip as RTooltip,
} from "recharts";
import { useEmployeeStore, startSync, type PayrollDoc } from "@/stores/unified-store";
import { COLLECTIONS } from "@/lib/collection-service";
import {
  actOnRun,
  generatePayroll,
  getRun,
  listRuns,
  monthNumberFrom,
  periodLabel,
} from "@/lib/payroll-client";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// PAYROLL — Monthly payroll processing, payslip details, earnings
// & deductions, compliance tracker, and salary analytics
// ═══════════════════════════════════════════════════════════════

const COLORS = ["#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#ef4444","#6366f1","#14b8a6"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const STATUS_CONF: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  processing: { label: "Processing", className: "status-pending" },
  processed: { label: "Processed", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  paid: { label: "Paid", className: "status-active" },
};
const COMPLIANCE_ITEMS = [
  { name: "PF Remittance", dueDate: "15th of month", icon: ShieldCheck },
  { name: "TDS Filing", dueDate: "7th of month", icon: Percent },
  { name: "ESI Contribution", dueDate: "21st of month", icon: ShieldCheck },
  { name: "Professional Tax", dueDate: "End of month", icon: Receipt },
];

/**
 * A payslip row, carrying the run it belongs to.
 *
 * The lifecycle acts on the *run*, not the individual payslip: processing,
 * approval and payment are decisions about a whole period. The table renders
 * one row per person, so each row has to know which run it came from — passing
 * the payslip id to `/api/payroll/runs/[id]` finds no run.
 */
type PayslipRow = PayrollDoc & { runId: string };

export default function PayrollPage() {
  const rbac = useRBAC();
  const empStore = useEmployeeStore();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [tab, setTab] = useState("paysheet");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedPayslip, setSelectedPayslip] = useState<PayslipRow | null>(null);
  const [runPayrollOpen, setRunPayrollOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMonth, setRunMonth] = useState(MONTHS[new Date().getMonth()]);
  const [runYear, setRunYear] = useState(String(new Date().getFullYear()));

  /**
   * Payroll comes from `/api/payroll/*`, not the document store.
   *
   * This page used `genericService(COLLECTIONS.payroll)`, which resolves to
   * `/api/collections/payroll` for anything without an entity route — and the
   * document store deliberately refuses `payroll`, because it has a real table.
   * Every read and write returned 404, so the KPIs showed ₹0.0L and Run Payroll
   * failed. See `src/lib/payroll-client.ts`.
   */
  const [items, setItems] = useState<PayslipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const allRuns = await listRuns();

      // The table below renders one row per payslip, so the records for each
      // run are flattened into the shape it already expects.
      const detailed = await Promise.all(allRuns.map((run) => getRun(run.id).catch(() => null)));

      const rows: PayslipRow[] = [];
      for (const detail of detailed) {
        if (!detail) continue;
        for (const record of detail.records) {
          rows.push({
            id: record.id,
            // The run, not the payslip, is what the lifecycle acts on. Carried
            // on every row because the table's buttons act per row.
            runId: detail.run.id,
            employeeId: record.employeeId,
            employeeName: record.employeeName ?? "—",
            department: "",
            month: MONTHS[detail.run.periodMonth - 1] ?? "",
            year: detail.run.periodYear,
            basicPay: 0,
            hra: 0,
            specialAllowance: 0,
            grossEarnings: record.gross,
            totalDeductions: record.totalDeductions,
            netPay: record.netPay,
            status: detail.run.status,
          } as PayslipRow);
        }
      }

      setItems(rows);
      setLoadError(null);
    } catch (error) {
      // Said out loud. The previous version swallowed this and left the page
      // looking merely empty, which is why a total failure read as "no data".
      setLoadError(error instanceof Error ? error.message : "Payroll could not be loaded");
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore); }, [empStore.initialized, empStore]);

  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p =>
        p.employeeName?.toLowerCase().includes(q) ||
        p.department?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") result = result.filter(p => p.status === statusFilter);
    if (monthFilter !== "all") result = result.filter(p => p.month === monthFilter);
    return result;
  }, [items, search, statusFilter, monthFilter]);

  // KPIs
  const grossPayroll = useMemo(() => items.reduce((s, p) => s + (p.grossEarnings || 0), 0), [items]);
  const netPayroll = useMemo(() => items.reduce((s, p) => s + (p.netPay || 0), 0), [items]);
  const totalDeductions = useMemo(() => items.reduce((s, p) => s + (p.totalDeductions || 0), 0), [items]);
  const processedCount = items.filter(p => p.status === "paid" || p.status === "processed").length;

  // Chart data
  const monthlyData = useMemo(() => {
    const byMonth: Record<string, { gross: number; net: number; deductions: number }> = {};
    items.forEach(p => {
      const key = p.month || "Unknown";
      if (!byMonth[key]) byMonth[key] = { gross: 0, net: 0, deductions: 0 };
      byMonth[key].gross += p.grossEarnings || 0;
      byMonth[key].net += p.netPay || 0;
      byMonth[key].deductions += p.totalDeductions || 0;
    });
    return Object.entries(byMonth).map(([name, v]) => ({ name, ...v }));
  }, [items]);

  const deptPayroll = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(p => {
      counts[p.department || "Other"] = (counts[p.department || "Other"] || 0) + (p.netPay || 0);
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [items]);

  const formatCurrency = (val: number) => `₹${(val / 100000).toFixed(1)}L`;

  const handleRunPayroll = async () => {
    const periodMonth = monthNumberFrom(runMonth);
    if (periodMonth === null) {
      toast.error(`"${runMonth}" is not a month`);
      return;
    }

    const periodYear = Number(runYear);
    if (!Number.isInteger(periodYear) || periodYear < 2000 || periodYear > 2100) {
      toast.error("Enter a four-digit year");
      return;
    }

    setRunning(true);
    try {
      // Creates the run and processes it. Processing is what reads attendance
      // and applies PF, ESI, professional tax and TDS — the page used to do
      // `basic * 0.4` for HRA and call it payroll.
      const run = await generatePayroll(periodMonth, periodYear);
      await reload();
      toast.success(
        `${periodLabel(run)} payroll processed for ${run.employeeCount} employee${
          run.employeeCount === 1 ? "" : "s"
        }.`
      );
      setRunPayrollOpen(false);
    } catch (error) {
      // The server's own message. "Failed to generate payroll" told the person
      // nothing — the real reason was a 404 from a route that does not serve
      // payroll, and nobody could have guessed that from the toast.
      toast.error(error instanceof Error ? error.message : "Failed to generate payroll");
    } finally {
      setRunning(false);
    }
  };

  const handleStatusUpdate = async (runId: string, status: string) => {
    // Mapped explicitly, with no default. The lifecycle is
    // processed → approved → paid, and "pay" releases money — a fallback that
    // reached it for any unrecognised status would be the worst possible
    // default in this file.
    const action =
      status === "processing" || status === "processed"
        ? "process"
        : status === "approved"
          ? "approve"
          : status === "paid"
            ? "pay"
            : null;

    if (!action) {
      toast.error(`Cannot move payroll to "${status}"`);
      return;
    }

    try {
      await actOnRun(runId, action);
      await reload();
      toast.success(`Payroll ${action === "pay" ? "released for payment" : `${action}d`}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update status");
    }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && items.length === 0) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Payroll</h1>
            <p className="text-muted-foreground mt-1">Manage salaries, payslips, and compliance</p>
          </div>
          {rbac.can("payroll.process") && (
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setRunPayrollOpen(true)}>
              <Banknote className="h-4 w-4" /> Run Payroll
            </Button>
          )}
        </div>
        {/* A failed load is not an empty payroll. Conflating the two is what
            let a 404 on every request look like "no data yet" — the page
            showed ₹0.0L and an invitation to run payroll, with no hint that
            nothing had been read at all. */}
        {loadError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">Payroll could not be loaded</p>
            <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
          </div>
        ) : (
          <DataEmptyState {...EMPTY_STATES.payroll} onAction={() => setRunPayrollOpen(true)} />
        )}
        {/* Run Payroll Dialog for empty state */}
        <Dialog open={runPayrollOpen} onOpenChange={setRunPayrollOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Run Payroll</DialogTitle></DialogHeader>
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label>Month</Label>
                <Select value={runMonth} onValueChange={setRunMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Year</Label>
                <Input type="number" value={runYear} onChange={(e) => setRunYear(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRunPayrollOpen(false)}>Cancel</Button>
              <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" disabled={running} onClick={handleRunPayroll}>{running ? "Processing…" : "Generate Payroll"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const kpis = [
    { label: "Gross Payroll", value: formatCurrency(grossPayroll), icon: DollarSign, gradient: "from-violet-500 to-purple-600" },
    { label: "Net Payroll", value: formatCurrency(netPayroll), icon: Banknote, gradient: "from-blue-500 to-cyan-500" },
    { label: "Total Deductions", value: formatCurrency(totalDeductions), icon: Receipt, gradient: "from-amber-500 to-orange-500" },
    { label: "Processed", value: processedCount, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Payroll</h1>
          <p className="text-muted-foreground mt-1">Manage salaries, payslips, and compliance</p>
        </div>
        {rbac.can("payroll.process") && (
          <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setRunPayrollOpen(true)}>
            <Banknote className="h-4 w-4" /> Run Payroll
          </Button>
        )}
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
          <Input placeholder="Search employees..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select value={monthFilter} onValueChange={setMonthFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Month" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Months</SelectItem>
            {MONTHS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="processed">Processed</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="paysheet">Pay Sheet</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
        </TabsList>

        {/* Pay Sheet Tab */}
        <TabsContent value="paysheet" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left p-3 font-medium">Employee</th>
                      <th className="text-left p-3 font-medium">Department</th>
                      <th className="text-right p-3 font-medium">Basic</th>
                      <th className="text-right p-3 font-medium">HRA</th>
                      <th className="text-right p-3 font-medium">Gross</th>
                      <th className="text-right p-3 font-medium">Deductions</th>
                      <th className="text-right p-3 font-medium">Net Pay</th>
                      <th className="text-center p-3 font-medium">Status</th>
                      <th className="text-center p-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No payroll records found</td></tr>
                    ) : (
                      filtered.map((p) => {
                        const st = STATUS_CONF[p.status] || STATUS_CONF.draft;
                        return (
                          <tr key={p.id} className="border-b hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setSelectedPayslip(p)}>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <Avatar className="h-8 w-8">
                                  <AvatarFallback className="text-xs bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                                    {p.employeeName?.split(" ").map(n => n[0]).join("").slice(0, 2)}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="font-medium">{p.employeeName}</span>
                              </div>
                            </td>
                            <td className="p-3 text-muted-foreground">{p.department}</td>
                            <td className="p-3 text-right">₹{(p.basicPay || 0).toLocaleString()}</td>
                            <td className="p-3 text-right">₹{(p.hra || 0).toLocaleString()}</td>
                            <td className="p-3 text-right font-medium">₹{(p.grossEarnings || 0).toLocaleString()}</td>
                            <td className="p-3 text-right text-red-600 dark:text-red-400">-₹{(p.totalDeductions || 0).toLocaleString()}</td>
                            <td className="p-3 text-right font-bold text-emerald-600 dark:text-emerald-400">₹{(p.netPay || 0).toLocaleString()}</td>
                            <td className="p-3 text-center"><Badge className={st.className}>{st.label}</Badge></td>
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setSelectedPayslip(p); }}>
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                                {p.status === "draft" && (
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleStatusUpdate(p.runId, "processing"); }}>
                                    <ArrowUpRight className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Monthly Payroll Trend</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Legend />
                    <Bar dataKey="gross" name="Gross" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="net" name="Net" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="deductions" name="Deductions" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base">Payroll by Department</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={deptPayroll} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                      {deptPayroll.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Compliance Tab */}
        <TabsContent value="compliance" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {COMPLIANCE_ITEMS.map((item) => (
              <Card key={item.name} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
                        <item.icon className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="font-semibold">{item.name}</p>
                        <p className="text-sm text-muted-foreground">Due: {item.dueDate}</p>
                      </div>
                    </div>
                    <Badge className="status-active">Compliant</Badge>
                  </div>
                  <Progress value={100} className="mt-3 h-2" />
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Statutory Deductions Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { name: "Provident Fund (12%)", amount: Math.round(grossPayroll * 0.12) },
                  { name: "TDS / Income Tax", amount: Math.round(grossPayroll * 0.1) },
                  { name: "ESI (0.75%)", amount: Math.round(grossPayroll * 0.0075) },
                  { name: "Professional Tax", amount: items.length * 200 },
                ].map((d) => (
                  <div key={d.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                    <span className="text-sm font-medium">{d.name}</span>
                    <span className="text-sm font-bold">₹{d.amount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Payslip Detail Dialog */}
      <Dialog open={!!selectedPayslip} onOpenChange={(v) => { if (!v) setSelectedPayslip(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {selectedPayslip && (
            <>
              <DialogHeader>
                <DialogTitle>Payslip — {selectedPayslip.employeeName}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Period</p>
                    <p className="font-medium">{selectedPayslip.month} {selectedPayslip.year}</p>
                  </div>
                  <Badge className={(STATUS_CONF[selectedPayslip.status] || STATUS_CONF.draft).className}>
                    {(STATUS_CONF[selectedPayslip.status] || STATUS_CONF.draft).label}
                  </Badge>
                </div>
                <Separator />
                <div>
                  <h4 className="font-semibold text-sm mb-2 text-emerald-600">Earnings</h4>
                  <div className="space-y-2">
                    {[
                      { label: "Basic Salary", amount: selectedPayslip.basicPay },
                      { label: "House Rent Allowance", amount: selectedPayslip.hra },
                      { label: "Special Allowance", amount: selectedPayslip.specialAllowance },
                    ].map((e) => (
                      <div key={e.label} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{e.label}</span>
                        <span>₹{(e.amount || 0).toLocaleString()}</span>
                      </div>
                    ))}
                    <Separator />
                    <div className="flex justify-between font-semibold text-sm">
                      <span>Gross Earnings</span>
                      <span className="text-emerald-600">₹{(selectedPayslip.grossEarnings || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold text-sm mb-2 text-red-600">Deductions</h4>
                  <div className="space-y-2">
                    {[
                      { label: "Provident Fund", amount: Math.round((selectedPayslip.basicPay || 0) * 0.12) },
                      { label: "Income Tax", amount: Math.round((selectedPayslip.grossEarnings || 0) * 0.1) },
                      { label: "Professional Tax", amount: 200 },
                    ].map((d) => (
                      <div key={d.label} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{d.label}</span>
                        <span className="text-red-600">-₹{d.amount.toLocaleString()}</span>
                      </div>
                    ))}
                    <Separator />
                    <div className="flex justify-between font-semibold text-sm">
                      <span>Total Deductions</span>
                      <span className="text-red-600">-₹{(selectedPayslip.totalDeductions || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                <Separator />
                <div className="flex justify-between items-center p-3 rounded-lg bg-gradient-to-r from-violet-500/10 to-purple-500/10">
                  <span className="font-bold text-lg">Net Pay</span>
                  <span className="font-bold text-xl text-emerald-600">₹{(selectedPayslip.netPay || 0).toLocaleString()}</span>
                </div>
              </div>
              <DialogFooter className="gap-2">
                {selectedPayslip.status === "draft" && (
                  <Button variant="outline" onClick={() => { handleStatusUpdate(selectedPayslip.runId, "processing"); setSelectedPayslip(null); }}>
                    Process
                  </Button>
                )}
                {selectedPayslip.status === "processed" && (
                  <Button variant="outline" onClick={() => { handleStatusUpdate(selectedPayslip.runId, "paid"); setSelectedPayslip(null); }}>
                    Mark Paid
                  </Button>
                )}
                <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2">
                  <Printer className="h-4 w-4" /> Print Payslip
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Run Payroll Dialog */}
      <Dialog open={runPayrollOpen} onOpenChange={setRunPayrollOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Run Payroll</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Month</Label>
              <Select value={runMonth} onValueChange={setRunMonth}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MONTHS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Year</Label>
              <Input type="number" value={runYear} onChange={(e) => setRunYear(e.target.value)} />
            </div>
            <div className="p-3 rounded-lg bg-muted/30 text-sm">
              <p className="font-medium">This will generate payroll entries for {empStore.items.filter(e => e.status === "active").length} active employees.</p>
              <p className="text-muted-foreground mt-1">Salary components will be calculated based on employee records.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunPayrollOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" disabled={running} onClick={handleRunPayroll}>
              <Banknote className="h-4 w-4 mr-2" /> {running ? "Processing…" : "Generate Payroll"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
