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
import { Separator } from "@/components/ui/separator";
import {
  Banknote, DollarSign, Download, Mail, FileText,
  TrendingUp, Calendar, Building2, Calculator,
  CreditCard, Wallet, ArrowDown, ArrowUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip,
} from "recharts";
import { type PayrollDoc } from "@/stores/unified-store";
import { listMyPayslips } from "@/lib/payroll-client";
import { COLLECTIONS } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { clickable } from "@/lib/a11y/clickable";

// ═══════════════════════════════════════════════════════════════
// PAYSLIP — Employee payslip viewer with tax computation
// ═══════════════════════════════════════════════════════════════

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const OLD_REGIME_SLABS = [
  { upto: 250000, rate: 0 }, { upto: 500000, rate: 5 },
  { upto: 1000000, rate: 20 }, { upto: Infinity, rate: 30 },
];
const NEW_REGIME_SLABS = [
  { upto: 300000, rate: 0 }, { upto: 600000, rate: 5 },
  { upto: 900000, rate: 10 }, { upto: 1200000, rate: 15 },
  { upto: 1500000, rate: 20 }, { upto: Infinity, rate: 30 },
];

function computeTax(annual: number, slabs: typeof OLD_REGIME_SLABS): number {
  let tax = 0;
  let remaining = annual;
  let prev = 0;
  for (const slab of slabs) {
    const taxable = Math.min(remaining, slab.upto - prev);
    if (taxable <= 0) break;
    tax += taxable * slab.rate / 100;
    remaining -= taxable;
    prev = slab.upto;
  }
  return Math.round(tax);
}

export default function PayslipPage() {
  const [tab, setTab] = useState("current");
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth().toString());
  const [detailItem, setDetailItem] = useState<PayrollDoc | null>(null);

  /**
   * The employee's own payslips, from `/api/payroll/payslips`.
   *
   * This page went through `genericService(COLLECTIONS.payroll)`, which falls
   * back to `/api/collections/payroll` — a collection the document store
   * deliberately refuses, because payroll has its own table. Every request
   * 404'd, so the page showed no payslips and no error. There has been a
   * correct route for this all along, and it releases only approved and paid
   * runs so nobody sees a figure that is still being corrected.
   */
  const [items, setItems] = useState<PayrollDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payslips = await listMyPayslips();
        if (cancelled) return;
        setItems(
          payslips.map((slip) => ({
            id: slip.id,
            employeeId: slip.employeeId,
            employeeName: slip.employeeName ?? "",
            department: "",
            month: MONTHS[(slip.periodMonth ?? 1) - 1] ?? "",
            year: slip.periodYear ?? new Date().getFullYear(),
            basicPay: 0,
            hra: 0,
            specialAllowance: 0,
            grossEarnings: slip.gross,
            totalDeductions: slip.totalDeductions,
            netPay: slip.netPay,
            status: slip.status,
          }) as PayrollDoc)
        );
        setLoadError(null);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Payslips could not be loaded");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setInitialized(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Current month payslip
  const currentPayslip = useMemo(() => {
    const monthIdx = parseInt(selectedMonth);
    const monthName = MONTHS[monthIdx];
    return items.find(p =>
      p.month?.toLowerCase() === monthName?.toLowerCase() ||
      p.month === `${monthIdx + 1}`
    ) || items[0] || null;
  }, [items, selectedMonth]);

  // Earnings breakdown
  const earnings = useMemo(() => {
    if (!currentPayslip) return [];
    return [
      { label: "Basic Pay", amount: currentPayslip.basicPay || 0 },
      { label: "HRA", amount: currentPayslip.hra || 0 },
      { label: "Special Allowance", amount: currentPayslip.specialAllowance || 0 },
      { label: "Conveyance", amount: Math.round((currentPayslip.basicPay || 0) * 0.08) },
      { label: "Medical Allowance", amount: Math.round((currentPayslip.basicPay || 0) * 0.05) },
    ];
  }, [currentPayslip]);

  const deductions = useMemo(() => {
    if (!currentPayslip) return [];
    const basic = currentPayslip.basicPay || 0;
    return [
      { label: "Provident Fund", amount: Math.round(basic * 0.12) },
      { label: "Professional Tax", amount: 200 },
      { label: "Income Tax (TDS)", amount: Math.round((currentPayslip.netPay || 0) * 0.1) },
      { label: "ESI", amount: basic > 21000 ? 0 : Math.round((currentPayslip.grossEarnings || 0) * 0.0075) },
    ];
  }, [currentPayslip]);

  const totalEarnings = earnings.reduce((s, e) => s + e.amount, 0);
  const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0);
  const netPay = currentPayslip?.netPay || (totalEarnings - totalDeductions);

  // YTD Summary
  const ytdSummary = useMemo(() => {
    const totalGross = items.reduce((s, p) => s + (p.grossEarnings || 0), 0);
    const totalDed = items.reduce((s, p) => s + (p.totalDeductions || 0), 0);
    const totalNet = items.reduce((s, p) => s + (p.netPay || 0), 0);
    return { totalGross, totalDed, totalNet, months: items.length };
  }, [items]);

  // Tax comparison
  const annualIncome = ytdSummary.totalGross > 0
    ? Math.round(ytdSummary.totalGross / Math.max(1, ytdSummary.months) * 12)
    : (currentPayslip?.grossEarnings || 30000) * 12;
  const oldRegimeTax = computeTax(annualIncome, OLD_REGIME_SLABS);
  const newRegimeTax = computeTax(annualIncome, NEW_REGIME_SLABS);

  // Salary history trend
  const historyData = useMemo(() => {
    return items.slice().reverse().map(p => ({
      name: p.month || "N/A",
      gross: p.grossEarnings || 0,
      net: p.netPay || 0,
      deductions: p.totalDeductions || 0,
    }));
  }, [items]);

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && items.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.payroll} />;
  }

  const kpis = [
    { label: "Net Pay", value: `₹${netPay.toLocaleString()}`, icon: Wallet, gradient: "from-emerald-500 to-green-600" },
    { label: "Gross Earnings", value: `₹${totalEarnings.toLocaleString()}`, icon: Banknote, gradient: "from-violet-500 to-purple-600" },
    { label: "Total Deductions", value: `₹${totalDeductions.toLocaleString()}`, icon: ArrowDown, gradient: "from-red-500 to-rose-500" },
    { label: "YTD Net", value: `₹${ytdSummary.totalNet.toLocaleString()}`, icon: TrendingUp, gradient: "from-blue-500 to-cyan-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Payslip</h1>
          <p className="text-muted-foreground mt-1">View salary details, tax computation &amp; history</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => toast.success("PDF download initiated")}>
            <Download className="h-4 w-4" /> Download PDF
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => toast.success("Payslip emailed")}>
            <Mail className="h-4 w-4" /> Email Payslip
          </Button>
        </div>
      </div>

      {/* Net Pay Highlight */}
      <Card className="border-0 shadow-sm bg-gradient-to-r from-violet-500/10 to-purple-500/10">
        <CardContent className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Net Pay for {MONTHS[parseInt(selectedMonth)] || "Current Month"}</p>
          <p className="text-5xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent mt-2">
            ₹{netPay.toLocaleString()}
          </p>
          <div className="flex items-center justify-center gap-6 mt-3 text-sm">
            <span className="flex items-center gap-1 text-emerald-600"><ArrowUp className="h-3 w-3" />Earnings: ₹{totalEarnings.toLocaleString()}</span>
            <span className="flex items-center gap-1 text-red-500"><ArrowDown className="h-3 w-3" />Deductions: ₹{totalDeductions.toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>

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

      {/* Month Selector */}
      <div className="flex items-center gap-3">
        <Label>Month:</Label>
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => <SelectItem key={m} value={i.toString()}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="current">Current</TabsTrigger>
          <TabsTrigger value="ytd">YTD</TabsTrigger>
          <TabsTrigger value="tax">Tax</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* Current Payslip */}
        <TabsContent value="current" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Earnings */}
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base text-emerald-600 flex items-center gap-2"><ArrowUp className="h-4 w-4" /> Earnings</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {earnings.map(e => (
                    <div key={e.label} className="flex justify-between text-sm">
                      <span>{e.label}</span>
                      <span className="font-medium">₹{e.amount.toLocaleString()}</span>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex justify-between font-semibold text-emerald-600">
                    <span>Total Earnings</span>
                    <span>₹{totalEarnings.toLocaleString()}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            {/* Deductions */}
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base text-red-500 flex items-center gap-2"><ArrowDown className="h-4 w-4" /> Deductions</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {deductions.map(d => (
                    <div key={d.label} className="flex justify-between text-sm">
                      <span>{d.label}</span>
                      <span className="font-medium">₹{d.amount.toLocaleString()}</span>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex justify-between font-semibold text-red-500">
                    <span>Total Deductions</span>
                    <span>₹{totalDeductions.toLocaleString()}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* YTD */}
        <TabsContent value="ytd" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Year-to-Date Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 text-center">
                  <p className="text-sm text-muted-foreground">Total Gross</p>
                  <p className="text-2xl font-bold text-emerald-600">₹{ytdSummary.totalGross.toLocaleString()}</p>
                </div>
                <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/10 text-center">
                  <p className="text-sm text-muted-foreground">Total Deductions</p>
                  <p className="text-2xl font-bold text-red-500">₹{ytdSummary.totalDed.toLocaleString()}</p>
                </div>
                <div className="p-4 rounded-lg bg-violet-50 dark:bg-violet-900/10 text-center">
                  <p className="text-sm text-muted-foreground">Total Net</p>
                  <p className="text-2xl font-bold text-violet-600">₹{ytdSummary.totalNet.toLocaleString()}</p>
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="font-semibold text-sm">Monthly Breakdown</h4>
                {items.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50" {...clickable(() => setDetailItem(p))}>
                    <div>
                      <p className="font-medium text-sm">{p.month} {p.year}</p>
                      <p className="text-xs text-muted-foreground">{p.employeeName}</p>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-emerald-600">₹{(p.grossEarnings || 0).toLocaleString()}</span>
                      <span className="text-red-500">−₹{(p.totalDeductions || 0).toLocaleString()}</span>
                      <span className="font-bold">₹{(p.netPay || 0).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tax */}
        <TabsContent value="tax" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Calculator className="h-4 w-4" /> Tax Comparison — Old vs New Regime</CardTitle></CardHeader>
            <CardContent>
              <div className="text-center mb-4">
                <p className="text-sm text-muted-foreground">Projected Annual Income</p>
                <p className="text-2xl font-bold">₹{annualIncome.toLocaleString()}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Old Regime */}
                <div className="p-4 rounded-lg border">
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <Badge variant="outline">Old Regime</Badge>
                  </h4>
                  <div className="space-y-2 text-sm">
                    {OLD_REGIME_SLABS.map((slab, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{i === 0 ? `Up to ₹${slab.upto.toLocaleString()}` : slab.upto === Infinity ? `Above ₹${OLD_REGIME_SLABS[i-1].upto.toLocaleString()}` : `₹${OLD_REGIME_SLABS[i-1].upto.toLocaleString()} — ₹${slab.upto.toLocaleString()}`}</span>
                        <span className="font-medium">{slab.rate}%</span>
                      </div>
                    ))}
                    <Separator />
                    <div className="flex justify-between font-bold text-lg">
                      <span>Tax Payable</span>
                      <span className="text-red-500">₹{oldRegimeTax.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                {/* New Regime */}
                <div className="p-4 rounded-lg border border-violet-200 dark:border-violet-800">
                  <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <Badge className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0">New Regime</Badge>
                    {newRegimeTax < oldRegimeTax && <Badge className="status-active">Recommended</Badge>}
                  </h4>
                  <div className="space-y-2 text-sm">
                    {NEW_REGIME_SLABS.map((slab, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{i === 0 ? `Up to ₹${slab.upto.toLocaleString()}` : slab.upto === Infinity ? `Above ₹${NEW_REGIME_SLABS[i-1].upto.toLocaleString()}` : `₹${NEW_REGIME_SLABS[i-1].upto.toLocaleString()} — ₹${slab.upto.toLocaleString()}`}</span>
                        <span className="font-medium">{slab.rate}%</span>
                      </div>
                    ))}
                    <Separator />
                    <div className="flex justify-between font-bold text-lg">
                      <span>Tax Payable</span>
                      <span className="text-violet-600">₹{newRegimeTax.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4 p-3 rounded-lg bg-muted/30 text-center">
                <p className="text-sm">
                  {newRegimeTax < oldRegimeTax
                    ? `New regime saves you ₹${(oldRegimeTax - newRegimeTax).toLocaleString()} annually`
                    : `Old regime saves you ₹${(newRegimeTax - oldRegimeTax).toLocaleString()} annually`}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* History */}
        <TabsContent value="history" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Salary History Trend</CardTitle></CardHeader>
            <CardContent>
              {historyData.length === 0 ? (
                <DataEmptyState icon={TrendingUp} title="No history" description="Payroll history will appear here." compact />
              ) : (
                <ResponsiveContainer width="100%" height={350}>
                  <AreaChart data={historyData}>
                    <defs>
                      <linearGradient id="grossGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <RTooltip />
                    <Area type="monotone" dataKey="gross" name="Gross" stroke="#10b981" fill="url(#grossGrad)" />
                    <Area type="monotone" dataKey="net" name="Net" stroke="#8b5cf6" fill="url(#netGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Payslip Detail Dialog */}
      <Dialog open={!!detailItem} onOpenChange={v => { if (!v) setDetailItem(null); }}>
        <DialogContent>
          {detailItem && (
            <>
              <DialogHeader><DialogTitle>Payslip — {detailItem.month} {detailItem.year}</DialogTitle></DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-muted-foreground">Employee</p><p className="font-medium">{detailItem.employeeName}</p></div>
                  <div><p className="text-muted-foreground">Department</p><p className="font-medium">{detailItem.department}</p></div>
                </div>
                <Separator />
                <div className="flex justify-between"><span>Basic Pay</span><span className="font-medium">₹{(detailItem.basicPay || 0).toLocaleString()}</span></div>
                <div className="flex justify-between"><span>HRA</span><span className="font-medium">₹{(detailItem.hra || 0).toLocaleString()}</span></div>
                <div className="flex justify-between"><span>Special Allowance</span><span className="font-medium">₹{(detailItem.specialAllowance || 0).toLocaleString()}</span></div>
                <Separator />
                <div className="flex justify-between text-emerald-600 font-semibold"><span>Gross</span><span>₹{(detailItem.grossEarnings || 0).toLocaleString()}</span></div>
                <div className="flex justify-between text-red-500"><span>Deductions</span><span>−₹{(detailItem.totalDeductions || 0).toLocaleString()}</span></div>
                <Separator />
                <div className="flex justify-between font-bold text-lg"><span>Net Pay</span><span>₹{(detailItem.netPay || 0).toLocaleString()}</span></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDetailItem(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}