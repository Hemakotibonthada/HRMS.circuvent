"use client";

import { useState, useMemo, useEffect } from "react";
import { listMyPayslips, type MyPayslip } from "@/lib/payroll-client";
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
import { Switch } from "@/components/ui/switch";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, AreaChart, Area } from "recharts";
import { IndianRupee, FileText, Calculator, Upload, History, TrendingDown, TrendingUp, Plus, AlertTriangle, CheckCircle2, Lightbulb, Download, PiggyBank } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ═══════════════════════════════════════════════════════════════
// TAX DECLARATION & COMPUTATION — Investment proofs, regime comparison
// ═══════════════════════════════════════════════════════════════

interface Declaration {
  id: string; section: string; category: string; description: string; amount: number; limit: number; proofUploaded: boolean; status: "declared" | "verified" | "rejected";
}

const STANDARD_DEDUCTION = 75000;

/**
 * Statutory ceilings for FY 2025-26. A fact about Indian tax law, not about
 * any employee, so it belongs in the source.
 */
const SECTION_LIMITS: Record<string, number> = { "80C": 150000, "80D": 75000, "80E": 0, "80G": 0, "HRA": 300000, "LTA": 40000, "80TTA": 10000 };

/**
 * Generic guidance. Deliberately impersonal — the previous version said
 * "you have room for an additional ₹2,400" and "Parents health insurance
 * proof pending", both computed from investments the employee never made.
 */
const TAX_TIPS = [
  "Section 80C covers PPF, ELSS, life insurance premiums and your own EPF contribution.",
  "NPS Tier-I allows a further deduction under 80CCD(1B), over and above 80C.",
  "Proofs for the financial year are usually due before 31 March — check with your HR team.",
  "The new regime has lower rates but almost no deductions. Which is better depends on what you actually claim.",
];

export default function TaxPage() {
  const [regime, setRegime] = useState<"old" | "new">("old");
  const [showDialog, setShowDialog] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["80C", "80D"]));

  /**
   * Real figures, from released payslips.
   *
   * This page previously ran on constants: `GROSS_INCOME = 1800000`, twelve
   * hardcoded TDS rows, three prior years of tax paid, and twelve invented
   * 80C declarations with amounts — ₹72,000 of PPF, ₹50,000 of ELSS, a life
   * insurance premium. It rendered them under an employee's own name on a
   * page they file taxes from.
   *
   * Declarations have no storage anywhere in the product, so they are shown
   * as empty rather than invented. Gross income and TDS do exist — they are on
   * every payslip — and are summed here from the real ones.
   */
  const [payslips, setPayslips] = useState<MyPayslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mine = await listMyPayslips();
        if (!cancelled) setPayslips(mine);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Your payslips could not be read");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Year to date, from what has actually been released. Zero when no payslip
  // exists yet, which is the honest answer for a new joiner.
  const GROSS_INCOME = useMemo(
    () => payslips.reduce((sum, slip) => sum + (slip.gross ?? 0), 0),
    [payslips]
  );

  const TDS_MONTHLY = useMemo(() => {
    const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let cumulative = 0;
    return [...payslips]
      .sort((a, b) =>
        (a.periodYear ?? 0) - (b.periodYear ?? 0) || (a.periodMonth ?? 0) - (b.periodMonth ?? 0)
      )
      .map((slip) => {
        // Total deductions, not income tax alone: the payslip DTO does not
        // break TDS out separately, and labelling the whole figure "TDS" would
        // be the same kind of confident wrongness this page is being cured of.
        const deducted = slip.totalDeductions ?? 0;
        cumulative += deducted;
        return {
          month: MONTH_LABELS[(slip.periodMonth ?? 1) - 1] ?? "",
          tds: deducted,
          cumulative,
        };
      });
  }, [payslips]);

  /** No storage exists for declarations, so there are none to show. */
  const DECLARATIONS: Declaration[] = useMemo(() => [], []);

  /** Nor for prior years. */
  const PREV_DECLARATIONS: { year: string; totalDeductions: number; taxPaid: number; regime: string }[] =
    useMemo(() => [], []);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section); else next.add(section);
      return next;
    });
  };

  const sectionTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    DECLARATIONS.forEach(d => { totals[d.section] = (totals[d.section] || 0) + d.amount; });
    return totals;
  }, []);

  const totalDeductions = useMemo(() => Object.values(sectionTotals).reduce((a, b) => a + b, 0), [sectionTotals]);

  const computeOldRegime = () => {
    const taxableIncome = Math.max(0, GROSS_INCOME - STANDARD_DEDUCTION - totalDeductions);
    let tax = 0;
    if (taxableIncome > 1000000) tax += (taxableIncome - 1000000) * 0.3;
    if (taxableIncome > 500000) tax += Math.min(taxableIncome - 500000, 500000) * 0.2;
    if (taxableIncome > 250000) tax += Math.min(taxableIncome - 250000, 250000) * 0.05;
    const cess = tax * 0.04;
    return { taxableIncome, tax, cess, total: tax + cess };
  };

  const computeNewRegime = () => {
    const taxableIncome = Math.max(0, GROSS_INCOME - STANDARD_DEDUCTION);
    let tax = 0;
    const slabs = [[300000, 0], [400000, 0.05], [500000, 0.1], [600000, 0.15], [700000, 0.2], [Infinity, 0.3]];
    let remaining = taxableIncome;
    let prev = 0;
    for (const [limit, rate] of slabs) {
      const slabAmount = Math.min(remaining, (limit as number) - prev);
      if (slabAmount > 0) tax += slabAmount * (rate as number);
      remaining -= slabAmount;
      prev = limit as number;
      if (remaining <= 0) break;
    }
    const cess = tax * 0.04;
    return { taxableIncome, tax, cess, total: tax + cess };
  };

  const oldTax = computeOldRegime();
  const newTax = computeNewRegime();
  const selectedTax = regime === "old" ? oldTax : newTax;
  const savings = Math.abs(oldTax.total - newTax.total);

  const kpis = {
    grossIncome: GROSS_INCOME,
    totalDeductions,
    taxLiability: selectedTax.total,
    proofsPending: DECLARATIONS.filter(d => !d.proofUploaded).length,
  };

  const grouped = useMemo(() => {
    const groups: Record<string, Declaration[]> = {};
    DECLARATIONS.forEach(d => { if (!groups[d.section]) groups[d.section] = []; groups[d.section].push(d); });
    return groups;
  }, []);

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-emerald-500 bg-clip-text text-transparent">Income Tax</h1>
          <p className="text-muted-foreground mt-1">FY 2025-26 Tax Declaration and Computation</p>
        </div>
        <Button className="bg-gradient-to-r from-green-600 to-emerald-500 text-white" onClick={() => setShowDialog(true)}>
          <Plus className="h-4 w-4 mr-2" /> Add Declaration
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        <Card className="border-l-4 border-l-blue-500"><CardContent className="pt-4"><div className="flex justify-between"><div><p className="text-sm text-muted-foreground">Gross Income</p><p className="text-3xl font-bold">&#8377;{(kpis.grossIncome / 100000).toFixed(1)}L</p></div><IndianRupee className="h-8 w-8 text-blue-500" /></div></CardContent></Card>
        <Card className="border-l-4 border-l-green-500"><CardContent className="pt-4"><div className="flex justify-between"><div><p className="text-sm text-muted-foreground">Total Deductions</p><p className="text-3xl font-bold text-green-600">&#8377;{(kpis.totalDeductions / 100000).toFixed(2)}L</p></div><PiggyBank className="h-8 w-8 text-green-500" /></div></CardContent></Card>
        <Card className="border-l-4 border-l-red-500"><CardContent className="pt-4"><div className="flex justify-between"><div><p className="text-sm text-muted-foreground">Tax Liability ({regime})</p><p className="text-3xl font-bold text-red-600">&#8377;{(kpis.taxLiability / 1000).toFixed(1)}K</p></div><Calculator className="h-8 w-8 text-red-500" /></div></CardContent></Card>
        <Card className="border-l-4 border-l-amber-500"><CardContent className="pt-4"><div className="flex justify-between"><div><p className="text-sm text-muted-foreground">Proofs Pending</p><p className="text-3xl font-bold text-amber-600">{kpis.proofsPending}</p></div><Upload className="h-8 w-8 text-amber-500" /></div></CardContent></Card>
      </div>

      <Tabs defaultValue="declaration" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="declaration">Declaration</TabsTrigger>
          <TabsTrigger value="computation">Computation</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* Declaration Tab */}
        <TabsContent value="declaration" className="space-y-4">
          {Object.entries(grouped).map(([section, items]) => {
            const sectionLimit = SECTION_LIMITS[section] || 0;
            const sectionTotal = sectionTotals[section] || 0;
            const usage = sectionLimit > 0 ? Math.min((sectionTotal / sectionLimit) * 100, 100) : 0;
            return (
              <Card key={section}>
                <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection(section)}>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span className="flex items-center gap-2">Section {section} <Badge variant="outline">{items.length} items</Badge></span>
                    <span className="text-sm font-normal text-muted-foreground">&#8377;{sectionTotal.toLocaleString("en-IN")} {sectionLimit > 0 ? `/ ₹${sectionLimit.toLocaleString("en-IN")}` : ""}</span>
                  </CardTitle>
                  {sectionLimit > 0 && <Progress value={usage} className="h-1.5 mt-1" />}
                </CardHeader>
                {expandedSections.has(section) && (
                  <CardContent>
                    <div className="space-y-2">
                      {items.map(d => (
                        <div key={d.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50">
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className="text-xs w-14 justify-center">{d.category}</Badge>
                            <div><p className="text-sm font-medium">{d.description}</p><p className="text-xs text-muted-foreground">{d.proofUploaded ? "Proof uploaded" : "Proof pending"}</p></div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-sm">&#8377;{d.amount.toLocaleString("en-IN")}</span>
                            <Badge className={cn(d.status === "verified" ? "status-active" : d.status === "rejected" ? "status-rejected" : "status-pending")}>{d.status}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}

          {/* Tax Saving Tips */}
          <Card className="border-amber-200 bg-amber-50/30 dark:bg-amber-950/10">
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Lightbulb className="h-5 w-5 text-amber-500" />Tax Saving Recommendations</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {TAX_TIPS.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm"><TrendingDown className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />{tip}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Computation Tab */}
        <TabsContent value="computation" className="space-y-4">
          <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
            <Label className="font-medium">Tax Regime:</Label>
            <div className="flex items-center gap-2">
              <span className={cn("text-sm", regime === "old" && "font-bold text-green-600")}>Old Regime</span>
              <Switch checked={regime === "new"} onCheckedChange={v => setRegime(v ? "new" : "old")} />
              <span className={cn("text-sm", regime === "new" && "font-bold text-blue-600")}>New Regime</span>
            </div>
            <Badge variant="outline" className="ml-auto">{oldTax.total < newTax.total ? "Old regime saves" : "New regime saves"} &#8377;{savings.toLocaleString("en-IN")}</Badge>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Old Regime */}
            <Card className={cn(regime === "old" && "ring-2 ring-green-500")}>
              <CardHeader><CardTitle className="text-base flex items-center gap-2">Old Regime {regime === "old" && <Badge className="status-active">Selected</Badge>}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span>Gross Income</span><span>&#8377;{GROSS_INCOME.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between text-green-600"><span>(-) Standard Deduction</span><span>&#8377;{STANDARD_DEDUCTION.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between text-green-600"><span>(-) Total Deductions</span><span>&#8377;{totalDeductions.toLocaleString("en-IN")}</span></div>
                <Separator />
                <div className="flex justify-between font-medium"><span>Taxable Income</span><span>&#8377;{oldTax.taxableIncome.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between"><span>Income Tax</span><span>&#8377;{Math.round(oldTax.tax).toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between"><span>Health & Education Cess (4%)</span><span>&#8377;{Math.round(oldTax.cess).toLocaleString("en-IN")}</span></div>
                <Separator />
                <div className="flex justify-between font-bold text-lg"><span>Total Tax</span><span className="text-red-600">&#8377;{Math.round(oldTax.total).toLocaleString("en-IN")}</span></div>
              </CardContent>
            </Card>

            {/* New Regime */}
            <Card className={cn(regime === "new" && "ring-2 ring-blue-500")}>
              <CardHeader><CardTitle className="text-base flex items-center gap-2">New Regime {regime === "new" && <Badge className="bg-blue-500 text-white">Selected</Badge>}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span>Gross Income</span><span>&#8377;{GROSS_INCOME.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between text-green-600"><span>(-) Standard Deduction</span><span>&#8377;{STANDARD_DEDUCTION.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>(-) Deductions</span><span>Not applicable</span></div>
                <Separator />
                <div className="flex justify-between font-medium"><span>Taxable Income</span><span>&#8377;{newTax.taxableIncome.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between"><span>Income Tax</span><span>&#8377;{Math.round(newTax.tax).toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between"><span>Health & Education Cess (4%)</span><span>&#8377;{Math.round(newTax.cess).toLocaleString("en-IN")}</span></div>
                <Separator />
                <div className="flex justify-between font-bold text-lg"><span>Total Tax</span><span className="text-red-600">&#8377;{Math.round(newTax.total).toLocaleString("en-IN")}</span></div>
              </CardContent>
            </Card>
          </div>

          <Card><CardHeader><CardTitle className="text-base">Monthly TDS Deduction</CardTitle></CardHeader><CardContent>
            <div className="h-[280px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={TDS_MONTHLY}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><RTooltip /><Legend /><Area type="monotone" dataKey="tds" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} name="Monthly TDS" /><Area type="monotone" dataKey="cumulative" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} name="Cumulative" /></AreaChart></ResponsiveContainer></div>
          </CardContent></Card>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="space-y-4">
          <div className="grid gap-3">
            {DECLARATIONS.map(d => (
              <Card key={d.id} className={cn(!d.proofUploaded && "border-amber-300 bg-amber-50/20")}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{d.description}</p>
                      <p className="text-xs text-muted-foreground">Section {d.section} &middot; &#8377;{d.amount.toLocaleString("en-IN")}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {d.proofUploaded ? (
                        <Badge className="status-active"><CheckCircle2 className="h-3 w-3 mr-1" />Uploaded</Badge>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => toast.success(`Upload proof for ${d.description}`)}><Upload className="h-3 w-3 mr-1" />Upload</Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-4">
          <div className="grid gap-3">
            {PREV_DECLARATIONS.map(p => (
              <Card key={p.year}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{p.year}</p>
                      <p className="text-sm text-muted-foreground">Total Deductions: &#8377;{p.totalDeductions.toLocaleString("en-IN")} &middot; Regime: {p.regime}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-red-600">&#8377;{p.taxPaid.toLocaleString("en-IN")}</p>
                      <Button size="sm" variant="ghost"><Download className="h-3 w-3 mr-1" />Form 16</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card><CardHeader><CardTitle className="text-base">Tax Paid Trend</CardTitle></CardHeader><CardContent>
            <div className="h-[220px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={PREV_DECLARATIONS.map(p => ({ year: p.year.replace("FY ", ""), tax: p.taxPaid }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis /><RTooltip /><Bar dataKey="tax" fill="#ef4444" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* Add Declaration Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Investment Declaration</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div><Label>Section</Label><Select><SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger><SelectContent>{Object.keys(SECTION_LIMITS).map(s => <SelectItem key={s} value={s}>Section {s}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Investment Type</Label><Input placeholder="e.g., PPF, ELSS, LIC" /></div>
            <div><Label>Description</Label><Input placeholder="Investment description" /></div>
            <div><Label>Amount (INR)</Label><Input type="number" placeholder="Enter amount" /></div>
            <div className="flex items-center gap-2"><Switch /><Label>Upload proof now</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-green-600 to-emerald-500 text-white" onClick={() => { setShowDialog(false); toast.success("Declaration added!"); }}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
