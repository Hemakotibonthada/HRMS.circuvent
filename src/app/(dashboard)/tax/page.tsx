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
import { ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, AreaChart, Area } from "recharts";
import { IndianRupee, FileText, Calculator, Upload, History, TrendingDown, Plus, AlertTriangle, CheckCircle2, Lightbulb, PiggyBank } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DataEmptyState, DataLoadingSkeleton } from "@/components/data-empty-state";
import { STANDARD_DEDUCTION as REGIME_STANDARD_DEDUCTION_MINOR } from "@/lib/income-tax-declaration";

// ═══════════════════════════════════════════════════════════════
// TAX DECLARATION & COMPUTATION — Investment proofs, regime comparison
// ═══════════════════════════════════════════════════════════════

/**
 * A claimed section, as `GET /api/tax/declaration` returns it — a real row
 * from `it_declaration_items`, not one of the twelve invented 80C/ELSS/LIC
 * entries this page used to render under an employee's own name.
 */
interface DeclarationApiItem {
  section: string;
  declaredMinor: string;
  proofStatus: "not_required" | "awaiting" | "submitted" | "accepted" | "rejected";
}

/** The declaration header row: regime, financial year, and the HRA inputs. */
interface DeclarationApiRecord {
  id: string;
  regime: "old" | "new";
  financialYear: number;
  status: string;
  selfOrFamilyIsSenior: boolean;
  parentsAreSenior: boolean;
  rentPaidMinor: string;
  metroCity: boolean;
  landlordPan: string | null;
}

interface DeclarationSummaryItem {
  section: string;
  reason: string | null;
  declaredMinor: string;
  allowedMinor: string;
}

/** What the server actually allows, after regime, caps and proof are applied. */
interface DeclarationSummary {
  totalAllowedMinor: string;
  standardDeductionMinor: string;
  totalReliefMinor: string;
  items: DeclarationSummaryItem[];
}

/** Section metadata — labels and statutory caps — as the server knows them. */
interface DeclarationSection {
  code: string;
  label: string;
  capMinor: string | null;
  allowedInNewRegime: boolean;
  requiresProof: boolean;
}

/** Why an allowed amount is below what was declared, in words a non-accountant reads. */
function reasonLabel(reason: string): string {
  switch (reason) {
    case "not_allowed_in_new_regime": return "Not allowed under the new regime";
    case "over_section_cap": return "Reduced to the section's cap";
    case "over_shared_cap": return "Reduced — shares a cap with another claimed section";
    case "proof_missing": return "Reduced to zero — proof window closed without evidence";
    case "excluded_by_other_section": return "Not counted — mutually exclusive with another claimed section";
    default: return reason;
  }
}

/** `FY 2025-26` from the year the financial year starts in. */
function formatFinancialYear(fy: number): string {
  return `FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
}

/** Mirrors the `call()` helper in payroll-client.ts: same error shape, one endpoint. */
async function declarationRequest<T>(init?: RequestInit): Promise<T> {
  const res = await fetch("/api/tax/declaration", {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

/**
 * Regime-specific standard deduction, from the same source payroll and the
 * declaration API use. The previous flat ₹75,000 applied the new regime's
 * figure to the old regime too, overstating old-regime relief by ₹25,000
 * every time the two were compared here.
 */
const STANDARD_DEDUCTION: Record<"old" | "new", number> = {
  old: Number(REGIME_STANDARD_DEDUCTION_MINOR.old) / 100,
  new: Number(REGIME_STANDARD_DEDUCTION_MINOR.new) / 100,
};

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
  const [newSection, setNewSection] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [savingDeclaration, setSavingDeclaration] = useState(false);

  /**
   * Real figures, from released payslips.
   *
   * This page previously ran on constants: `GROSS_INCOME = 1800000`, twelve
   * hardcoded TDS rows, three prior years of tax paid, and twelve invented
   * 80C declarations with amounts — ₹72,000 of PPF, ₹50,000 of ELSS, a life
   * insurance premium. It rendered them under an employee's own name on a
   * page they file taxes from.
   *
   * Gross income and TDS are summed from the real payslips below. Declared
   * sections come from `/api/tax/declaration`, which is real and persisted —
   * see the block after this one.
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

  /**
   * The declaration itself. `/api/tax/declaration` auto-creates an empty row
   * on first read instead of 404ing, so "not yet loaded" and "loaded, nothing
   * declared" are the only two states this page has to handle.
   */
  const [declaration, setDeclaration] = useState<DeclarationApiRecord | null>(null);
  const [declarationItems, setDeclarationItems] = useState<DeclarationApiItem[]>([]);
  const [summary, setSummary] = useState<DeclarationSummary | null>(null);
  const [sections, setSections] = useState<DeclarationSection[]>([]);
  const [declLoading, setDeclLoading] = useState(true);
  const [declError, setDeclError] = useState<string | null>(null);
  const [declVersion, setDeclVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setDeclLoading(true);
      try {
        const body = await declarationRequest<{
          declaration: DeclarationApiRecord | null;
          items: DeclarationApiItem[];
          summary: DeclarationSummary | null;
          sections: DeclarationSection[];
        }>();
        if (cancelled) return;
        setDeclaration(body.declaration);
        setDeclarationItems(body.items ?? []);
        setSummary(body.summary ?? null);
        setSections(body.sections ?? []);
        if (body.declaration) setRegime(body.declaration.regime);
      } catch (error) {
        if (!cancelled) setDeclError(error instanceof Error ? error.message : "The declaration could not be read");
      } finally {
        if (!cancelled) setDeclLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [declVersion]);

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

  // Sum of what was actually declared, regardless of regime. The regime-aware
  // allowed amount (after caps and proof rules) comes from `summary` and is
  // shown per-section in the Declaration tab, not folded into this total —
  // the live regime toggle below previews both regimes and a cap total for
  // one regime would be silently wrong when previewing the other.
  const totalDeductions = useMemo(
    () => declarationItems.reduce((sum, item) => sum + Number(item.declaredMinor) / 100, 0),
    [declarationItems]
  );

  const computeOldRegime = () => {
    const taxableIncome = Math.max(0, GROSS_INCOME - STANDARD_DEDUCTION.old - totalDeductions);
    let tax = 0;
    if (taxableIncome > 1000000) tax += (taxableIncome - 1000000) * 0.3;
    if (taxableIncome > 500000) tax += Math.min(taxableIncome - 500000, 500000) * 0.2;
    if (taxableIncome > 250000) tax += Math.min(taxableIncome - 250000, 250000) * 0.05;
    const cess = tax * 0.04;
    return { taxableIncome, tax, cess, total: tax + cess };
  };

  const computeNewRegime = () => {
    const taxableIncome = Math.max(0, GROSS_INCOME - STANDARD_DEDUCTION.new);
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
    proofsPending: declarationItems.filter(item => item.proofStatus === "awaiting").length,
  };

  /**
   * Adds or updates one section on the real declaration. The dialog used to
   * accept an amount, a free-text "investment type" and description, and a
   * proof-upload toggle, then just closed itself and toasted success — none
   * of it reached storage. `it_declaration_items` has no description column,
   * so that field is gone rather than wired to nowhere; everything else here
   * is a real PUT.
   */
  const handleAddDeclaration = async () => {
    if (!newSection) {
      toast.error("Choose a section");
      return;
    }
    const rupees = Number(newAmount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      toast.error("Enter an amount greater than zero");
      return;
    }
    setSavingDeclaration(true);
    try {
      const nextItems = declarationItems.filter(item => item.section !== newSection);
      nextItems.push({ section: newSection, declaredMinor: String(Math.round(rupees * 100)), proofStatus: "awaiting" });
      const body = await declarationRequest<{ saved: boolean; warnings: { section?: string; message: string }[] }>({
        method: "PUT",
        body: JSON.stringify({
          regime,
          selfOrFamilyIsSenior: declaration?.selfOrFamilyIsSenior ?? false,
          parentsAreSenior: declaration?.parentsAreSenior ?? false,
          rentPaidMinor: declaration?.rentPaidMinor ?? "0",
          metroCity: declaration?.metroCity ?? false,
          landlordPan: declaration?.landlordPan ?? null,
          items: nextItems.map(item => ({ section: item.section, declaredMinor: item.declaredMinor })),
        }),
      });
      toast.success(body.warnings.length > 0 ? body.warnings[0].message : "Declaration saved");
      setNewSection("");
      setNewAmount("");
      setShowDialog(false);
      setDeclVersion(v => v + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The declaration could not be saved");
    } finally {
      setSavingDeclaration(false);
    }
  };

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-emerald-500 bg-clip-text text-transparent">Income Tax</h1>
          <p className="text-muted-foreground mt-1">{declaration ? formatFinancialYear(declaration.financialYear) : "FY"} Tax Declaration and Computation</p>
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
          {declLoading ? (
            <DataLoadingSkeleton rows={3} />
          ) : declError ? (
            <DataEmptyState icon={AlertTriangle} title="Declaration could not be loaded" description={declError} />
          ) : declarationItems.length === 0 ? (
            <DataEmptyState
              icon={FileText}
              title="No sections declared yet"
              description="Add a section below once you know what you're claiming this year — nothing is pre-filled or assumed."
              actionLabel="Add Declaration"
              onAction={() => setShowDialog(true)}
            />
          ) : (
            declarationItems.map(item => {
              const meta = sections.find(s => s.code === item.section);
              const summaryLine = summary?.items.find(s => s.section === item.section);
              const declaredRupees = Number(item.declaredMinor) / 100;
              const capRupees = meta?.capMinor ? Number(meta.capMinor) / 100 : null;
              const usage = capRupees && capRupees > 0 ? Math.min((declaredRupees / capRupees) * 100, 100) : 0;
              return (
                <Card key={item.section}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center justify-between">
                      <span className="flex items-center gap-2">{meta?.label ?? `Section ${item.section}`} <Badge variant="outline">{item.section}</Badge></span>
                      <span className="text-sm font-normal text-muted-foreground">&#8377;{declaredRupees.toLocaleString("en-IN")} {capRupees ? `/ ₹${capRupees.toLocaleString("en-IN")}` : ""}</span>
                    </CardTitle>
                    {capRupees ? <Progress value={usage} className="h-1.5 mt-1" /> : null}
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {item.proofStatus === "accepted" ? "Proof accepted" : item.proofStatus === "rejected" ? "Proof rejected" : item.proofStatus === "not_required" ? "No proof required" : "Proof pending"}
                      </span>
                      {summaryLine && summaryLine.reason ? (
                        <span className="flex items-center gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" />{reasonLabel(summaryLine.reason)}</span>
                      ) : (
                        <Badge className={cn(item.proofStatus === "accepted" ? "status-active" : item.proofStatus === "rejected" ? "status-rejected" : "status-pending")}>{item.proofStatus}</Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}

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
                <div className="flex justify-between text-green-600"><span>(-) Standard Deduction</span><span>&#8377;{STANDARD_DEDUCTION.old.toLocaleString("en-IN")}</span></div>
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
                <div className="flex justify-between text-green-600"><span>(-) Standard Deduction</span><span>&#8377;{STANDARD_DEDUCTION.new.toLocaleString("en-IN")}</span></div>
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
          {declLoading ? (
            <DataLoadingSkeleton rows={3} />
          ) : declarationItems.length === 0 ? (
            <DataEmptyState icon={Upload} title="No proofs to track yet" description="Proof status appears here once a section has been declared." />
          ) : (
            <div className="grid gap-3">
              {declarationItems.map(item => {
                const meta = sections.find(s => s.code === item.section);
                return (
                  <Card key={item.section} className={cn(item.proofStatus === "rejected" && "border-red-300 bg-red-50/20", item.proofStatus === "awaiting" && meta?.requiresProof && "border-amber-300 bg-amber-50/20")}>
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{meta?.label ?? `Section ${item.section}`}</p>
                          <p className="text-xs text-muted-foreground">Section {item.section} &middot; &#8377;{(Number(item.declaredMinor) / 100).toLocaleString("en-IN")}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {item.proofStatus === "accepted" ? (
                            <Badge className="status-active"><CheckCircle2 className="h-3 w-3 mr-1" />Accepted</Badge>
                          ) : item.proofStatus === "rejected" ? (
                            <Badge className="status-rejected"><AlertTriangle className="h-3 w-3 mr-1" />Rejected</Badge>
                          ) : item.proofStatus === "not_required" ? (
                            <Badge variant="outline">No proof required</Badge>
                          ) : (
                            // No upload endpoint exists yet. The old button called
                            // toast.success on click and never touched storage —
                            // disabled and labelled honestly beats a button that lies.
                            <Button size="sm" variant="outline" disabled title="Proof upload isn't available yet"><Upload className="h-3 w-3 mr-1" />Not available yet</Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-4">
          {/*
           * There is no year-over-year store: each financial year is one row,
           * and this page only reads the current one. The old UI invented three
           * prior years — deduction totals, tax paid, a bar chart, a "Form 16"
           * button that opened nothing — none of which existed. An honest empty
           * state is what's left until multi-year history is a real feature.
           */}
          <DataEmptyState
            icon={History}
            title="No prior year history yet"
            description="Past financial years will appear here once this product stores more than the current one."
          />
        </TabsContent>
      </Tabs>

      {/* Add Declaration Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => { setShowDialog(open); if (!open) { setNewSection(""); setNewAmount(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Investment Declaration</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            {/*
             * "Investment Type" and "Description" used to be free text here,
             * and "Upload proof now" a switch — none of the three had anywhere
             * to go: it_declaration_items stores a section code, an amount and
             * a proof status, nothing else. Removed rather than kept as inputs
             * that silently discarded whatever was typed into them.
             */}
            <div>
              <Label>Section</Label>
              <Select value={newSection} onValueChange={setNewSection}>
                <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
                <SelectContent>{sections.map(s => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Amount (INR)</Label><Input type="number" min="0" value={newAmount} onChange={e => setNewAmount(e.target.value)} placeholder="Enter amount" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={savingDeclaration}>Cancel</Button>
            <Button className="bg-gradient-to-r from-green-600 to-emerald-500 text-white" onClick={handleAddDeclaration} disabled={savingDeclaration}>{savingDeclaration ? "Saving..." : "Submit"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
