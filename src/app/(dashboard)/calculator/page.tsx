"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Calculator, DollarSign, TrendingUp, TrendingDown, IndianRupee,
  Building2, Calendar, FileText, Download, RefreshCw,
  Percent, PiggyBank, Receipt, Wallet, CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ═══════════════════════════════════════════════════════════════
// SALARY & TAX CALCULATOR
// CTC breakdown, salary structuring, tax computation,
// take-home calculator, comparison mode
// ═══════════════════════════════════════════════════════════════

const TAX_SLABS_OLD = [
  { min: 0, max: 250000, rate: 0 },
  { min: 250001, max: 500000, rate: 5 },
  { min: 500001, max: 1000000, rate: 20 },
  { min: 1000001, max: Infinity, rate: 30 },
];

const TAX_SLABS_NEW = [
  { min: 0, max: 300000, rate: 0 },
  { min: 300001, max: 700000, rate: 5 },
  { min: 700001, max: 1000000, rate: 10 },
  { min: 1000001, max: 1200000, rate: 15 },
  { min: 1200001, max: 1500000, rate: 20 },
  { min: 1500001, max: Infinity, rate: 30 },
];

function calculateTax(income: number, slabs: typeof TAX_SLABS_OLD, rebate: number = 0): number {
  let tax = 0;
  for (const slab of slabs) {
    if (income <= 0) break;
    const taxableInSlab = Math.min(income, slab.max) - slab.min + 1;
    if (taxableInSlab > 0) {
      tax += (Math.min(taxableInSlab, slab.max - slab.min + 1) * slab.rate) / 100;
    }
    if (income <= slab.max) break;
  }
  // Standard rebate u/s 87A
  if (income <= rebate) tax = 0;
  // Health & Education Cess 4%
  tax += tax * 0.04;
  return Math.round(tax);
}

const fmt = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

export default function SalaryCalculatorPage() {
  const [annualCTC, setAnnualCTC] = useState(1800000);
  const [regime, setRegime] = useState<"old" | "new">("new");
  const [includeBonus, setIncludeBonus] = useState(true);
  const [bonusPercent, setBonusPercent] = useState(10);
  const [rent, setRent] = useState(20000);
  const [section80C, setSection80C] = useState(150000);
  const [section80D, setSection80D] = useState(25000);
  const [homeLoan, setHomeLoan] = useState(0);
  const [nps, setNps] = useState(0);

  // CTC Breakdown
  const bonus = includeBonus ? Math.round(annualCTC * bonusPercent / 100) : 0;
  const grossAnnual = annualCTC - bonus;
  const monthly = Math.round(grossAnnual / 12);

  const basic = Math.round(monthly * 0.40);
  const hra = Math.round(basic * 0.50);
  const conveyance = 1600;
  const medical = 1250;
  const special = monthly - basic - hra - conveyance - medical;
  const lta = Math.round(basic * 0.10);

  const grossMonthly = basic + hra + conveyance + medical + special;
  const grossAnnualCalc = grossMonthly * 12;

  // Deductions
  const pfMonthly = Math.min(Math.round(basic * 0.12), 1800);
  const ptMonthly = 200;
  const pfAnnual = pfMonthly * 12;
  const ptAnnual = ptMonthly * 12;
  const employerPF = pfAnnual;
  const gratuity = Math.round((basic * 15 * 12) / (26 * 12));
  const insurance = 12000;

  // Taxable Income
  let taxableIncome = grossAnnualCalc;
  let deductions80C = 0;
  let deductions80D = 0;
  let hraExemption = 0;

  if (regime === "old") {
    // Standard deduction
    taxableIncome -= 50000;
    // 80C deductions
    deductions80C = Math.min(section80C + pfAnnual, 150000);
    taxableIncome -= deductions80C;
    // 80D
    deductions80D = Math.min(section80D, 75000);
    taxableIncome -= deductions80D;
    // HRA exemption
    const hraReceived = hra * 12;
    const rentPaid = rent * 12;
    const exemption1 = hraReceived;
    const exemption2 = rentPaid - (basic * 12 * 0.10);
    const exemption3 = basic * 12 * 0.50;
    hraExemption = Math.max(0, Math.min(exemption1, exemption2, exemption3));
    taxableIncome -= hraExemption;
    // Home loan
    if (homeLoan > 0) taxableIncome -= Math.min(homeLoan, 200000);
    // NPS
    if (nps > 0) taxableIncome -= Math.min(nps, 50000);
  } else {
    // New regime — only standard deduction of 75000
    taxableIncome -= 75000;
  }

  taxableIncome = Math.max(0, taxableIncome);

  const annualTax = regime === "old"
    ? calculateTax(taxableIncome, TAX_SLABS_OLD, 500000)
    : calculateTax(taxableIncome, TAX_SLABS_NEW, 700000);

  const monthlyTax = Math.round(annualTax / 12);
  const totalDeductionsMonthly = pfMonthly + ptMonthly + monthlyTax + Math.round(insurance / 12);
  const takeHomeMonthly = grossMonthly - totalDeductionsMonthly;
  const takeHomeAnnual = takeHomeMonthly * 12;

  // Comparison
  const oldTax = calculateTax(
    Math.max(0, grossAnnualCalc - 50000 - Math.min(section80C + pfAnnual, 150000) - Math.min(section80D, 75000) - hraExemption),
    TAX_SLABS_OLD, 500000
  );
  const newTax = calculateTax(Math.max(0, grossAnnualCalc - 75000), TAX_SLABS_NEW, 700000);
  const betterRegime = oldTax < newTax ? "Old" : "New";
  const savings = Math.abs(oldTax - newTax);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between animate-slide-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Calculator className="h-6 w-6 text-primary" />Salary & Tax Calculator</h1>
          <p className="text-muted-foreground text-sm mt-0.5">CTC breakdown, tax planning & take-home estimation</p>
        </div>
        {/* No PDF generation exists behind this yet — it used to be a plain
            button with no onClick at all, which looks identical to a working
            export until someone clicks it. Disabling it says that up front. */}
        <Button variant="outline" className="gap-1.5" disabled><Download className="h-4 w-4" />Export PDF (not available yet)</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Input Panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Annual CTC</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between"><Label>CTC (Annual)</Label><span className="text-lg font-bold text-primary">{fmt(annualCTC)}</span></div>
                <Slider value={[annualCTC]} onValueChange={([v]) => setAnnualCTC(v)} min={300000} max={10000000} step={50000} />
                <div className="flex justify-between text-[10px] text-muted-foreground"><span>₹3L</span><span>₹1Cr</span></div>
              </div>
              <Separator />
              <div className="flex items-center justify-between"><Label className="text-sm">Include Bonus</Label><Switch checked={includeBonus} onCheckedChange={setIncludeBonus} /></div>
              {includeBonus && (
                <div className="space-y-2">
                  <div className="flex justify-between"><Label className="text-xs">Bonus %</Label><span className="text-xs font-medium">{bonusPercent}%</span></div>
                  <Slider value={[bonusPercent]} onValueChange={([v]) => setBonusPercent(v)} min={0} max={30} step={1} />
                </div>
              )}
              <Separator />
              <div className="space-y-2">
                <Label className="text-sm">Tax Regime</Label>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  <Button variant={regime === "old" ? "default" : "ghost"} size="sm" className={cn("rounded-none flex-1", regime === "old" && "bg-primary text-primary-foreground")} onClick={() => setRegime("old")}>Old Regime</Button>
                  <Button variant={regime === "new" ? "default" : "ghost"} size="sm" className={cn("rounded-none flex-1", regime === "new" && "bg-primary text-primary-foreground")} onClick={() => setRegime("new")}>New Regime</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {regime === "old" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Deductions (Old Regime)</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2"><Label className="text-xs">Monthly Rent (for HRA)</Label><Input type="number" value={rent} onChange={e => setRent(Number(e.target.value))} /></div>
                <div className="space-y-2"><Label className="text-xs">Section 80C Investments</Label><Input type="number" value={section80C} onChange={e => setSection80C(Number(e.target.value))} /><p className="text-[10px] text-muted-foreground">Max ₹1,50,000 (EPF auto-included)</p></div>
                <div className="space-y-2"><Label className="text-xs">Section 80D (Health Insurance)</Label><Input type="number" value={section80D} onChange={e => setSection80D(Number(e.target.value))} /></div>
                <div className="space-y-2"><Label className="text-xs">Home Loan Interest (80EEA)</Label><Input type="number" value={homeLoan} onChange={e => setHomeLoan(Number(e.target.value))} /></div>
                <div className="space-y-2"><Label className="text-xs">NPS (80CCD 1B)</Label><Input type="number" value={nps} onChange={e => setNps(Number(e.target.value))} /><p className="text-[10px] text-muted-foreground">Additional ₹50,000 deduction</p></div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-2 space-y-4">
          {/* Take Home Banner */}
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-500 to-green-600 p-6 text-white">
              <div className="grid grid-cols-3 gap-4">
                <div><p className="text-xs opacity-80">Monthly Take-Home</p><p className="text-3xl font-bold mt-1">{fmt(takeHomeMonthly)}</p></div>
                <div><p className="text-xs opacity-80">Annual Take-Home</p><p className="text-2xl font-bold mt-1">{fmt(takeHomeAnnual)}</p></div>
                <div><p className="text-xs opacity-80">Effective Tax Rate</p><p className="text-2xl font-bold mt-1">{grossAnnualCalc > 0 ? Math.round((annualTax / grossAnnualCalc) * 100) : 0}%</p></div>
              </div>
            </div>
          </Card>

          {/* Regime Comparison */}
          <Card className={cn("border-l-4", betterRegime === "Old" ? "border-l-amber-500" : "border-l-emerald-500")}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">💡 {betterRegime} Tax Regime is better for you!</p>
                <p className="text-xs text-muted-foreground">You save {fmt(savings)} annually with the {betterRegime.toLowerCase()} regime</p>
              </div>
              <div className="flex gap-3 text-center">
                <div className="rounded-lg bg-muted px-3 py-2"><p className="text-[10px] text-muted-foreground">Old Regime</p><p className="text-sm font-bold">{fmt(oldTax)}</p></div>
                <div className="rounded-lg bg-muted px-3 py-2"><p className="text-[10px] text-muted-foreground">New Regime</p><p className="text-sm font-bold">{fmt(newTax)}</p></div>
              </div>
            </CardContent>
          </Card>

          {/* CTC Breakdown */}
          <Card>
            <CardHeader><CardTitle className="text-base">Monthly Salary Breakdown</CardTitle></CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-6">
                {/* Earnings */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><TrendingUp className="h-4 w-4" />Earnings</h3>
                  <div className="space-y-2">
                    {[
                      { label: "Basic Salary", value: basic },
                      { label: "HRA", value: hra },
                      { label: "Conveyance Allowance", value: conveyance },
                      { label: "Medical Allowance", value: medical },
                      { label: "Special Allowance", value: special },
                    ].map(e => (
                      <div key={e.label} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{e.label}</span>
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">{fmt(e.value)}</span>
                      </div>
                    ))}
                    <Separator />
                    <div className="flex justify-between text-sm font-bold"><span>Gross Monthly</span><span className="text-emerald-600 dark:text-emerald-400">{fmt(grossMonthly)}</span></div>
                  </div>
                </div>

                {/* Deductions */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 text-red-600 dark:text-red-400 flex items-center gap-1.5"><TrendingDown className="h-4 w-4" />Deductions</h3>
                  <div className="space-y-2">
                    {[
                      { label: "Provident Fund (PF)", value: pfMonthly },
                      { label: "Professional Tax", value: ptMonthly },
                      { label: "Income Tax (TDS)", value: monthlyTax },
                      { label: "Health Insurance", value: Math.round(insurance / 12) },
                    ].map(d => (
                      <div key={d.label} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{d.label}</span>
                        <span className="font-medium text-red-600 dark:text-red-400">-{fmt(d.value)}</span>
                      </div>
                    ))}
                    <Separator />
                    <div className="flex justify-between text-sm font-bold"><span>Total Deductions</span><span className="text-red-600 dark:text-red-400">-{fmt(totalDeductionsMonthly)}</span></div>
                  </div>
                </div>
              </div>

              {/* Net Pay */}
              <div className="mt-6 rounded-xl bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30 border border-emerald-200 dark:border-emerald-800/30 p-5 text-center">
                <p className="text-xs font-medium text-muted-foreground">NET MONTHLY PAY</p>
                <p className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">{fmt(takeHomeMonthly)}</p>
              </div>
            </CardContent>
          </Card>

          {/* Annual Summary */}
          <Card>
            <CardHeader><CardTitle className="text-base">Annual Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "Annual CTC", value: fmt(annualCTC), icon: Building2, color: "from-violet-500 to-purple-600" },
                  { label: "Gross Annual", value: fmt(grossAnnualCalc), icon: DollarSign, color: "from-blue-500 to-cyan-500" },
                  { label: "Total Tax", value: fmt(annualTax), icon: Receipt, color: "from-red-500 to-rose-500" },
                  { label: "Take Home", value: fmt(takeHomeAnnual), icon: Wallet, color: "from-emerald-500 to-green-600" },
                ].map(s => (
                  <div key={s.label} className="rounded-xl border p-4 text-center">
                    <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${s.color} text-white shadow-sm mb-2`}><s.icon className="h-5 w-5" /></div>
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                    <p className="text-sm font-bold mt-0.5">{s.value}</p>
                  </div>
                ))}
              </div>
              {includeBonus && bonus > 0 && (
                <div className="mt-4 rounded-lg bg-muted/30 p-3 text-center">
                  <p className="text-xs text-muted-foreground">Performance Bonus ({bonusPercent}%)</p>
                  <p className="text-lg font-bold text-primary">{fmt(bonus)}</p>
                </div>
              )}

              {regime === "old" && (
                <div className="mt-4 space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tax Deductions Claimed</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between rounded-lg border p-2"><span className="text-muted-foreground">Standard Deduction</span><span className="font-medium">{fmt(50000)}</span></div>
                    <div className="flex justify-between rounded-lg border p-2"><span className="text-muted-foreground">Section 80C</span><span className="font-medium">{fmt(deductions80C)}</span></div>
                    <div className="flex justify-between rounded-lg border p-2"><span className="text-muted-foreground">Section 80D</span><span className="font-medium">{fmt(deductions80D)}</span></div>
                    <div className="flex justify-between rounded-lg border p-2"><span className="text-muted-foreground">HRA Exemption</span><span className="font-medium">{fmt(hraExemption)}</span></div>
                    {homeLoan > 0 && <div className="flex justify-between rounded-lg border p-2"><span className="text-muted-foreground">Home Loan</span><span className="font-medium">{fmt(Math.min(homeLoan, 200000))}</span></div>}
                    {nps > 0 && <div className="flex justify-between rounded-lg border p-2"><span className="text-muted-foreground">NPS (80CCD)</span><span className="font-medium">{fmt(Math.min(nps, 50000))}</span></div>}
                  </div>
                  <div className="flex justify-between rounded-lg bg-primary/5 border border-primary/20 p-2 text-xs font-bold">
                    <span>Taxable Income</span><span>{fmt(taxableIncome)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-[10px] text-center text-muted-foreground">* This is an estimated calculation. Actual figures may vary based on company policy. Tax calculations are for FY 2025-26.</p>
        </div>
      </div>
    </div>
  );
}
