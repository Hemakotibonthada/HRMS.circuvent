import {
  calculateEsi,
  calculatePf,
  calculateIncomeTax as calculateStatutoryTax,
  calculateProfessionalTax as calculateStatutoryPt,
  NEW_REGIME_SLABS_FY2526,
  OLD_REGIME_SLABS,
  type TaxSlab,
  type Minor,
} from "@/lib/statutory-india";
// ═══════════════════════════════════════════════════════════════
// INDIAN PAYROLL COMPUTATION ENGINE
// Complete salary structure, statutory deductions, tax computation,
// payslip generation, and compliance calculations for Indian payroll
// ═══════════════════════════════════════════════════════════════

// ─── Types ───────────────────────────────────────────────────

export interface SalaryStructure {
  ctc: number;
  basic: number;
  hra: number;
  specialAllowance: number;
  conveyanceAllowance: number;
  medicalAllowance: number;
  lta: number;
  otherAllowances: number;
  grossSalary: number;
  employerPF: number;
  employerESI: number;
  gratuity: number;
  insurance: number;
}

export interface MonthlyPayslip {
  employeeId: string;
  employeeName: string;
  department: string;
  designation: string;
  month: string;
  year: number;
  workingDays: number;
  presentDays: number;
  lopDays: number;
  
  // Earnings
  basic: number;
  hra: number;
  specialAllowance: number;
  conveyanceAllowance: number;
  medicalAllowance: number;
  lta: number;
  otherAllowances: number;
  overtime: number;
  bonus: number;
  arrears: number;
  totalEarnings: number;

  // Deductions
  pfEmployee: number;
  esiEmployee: number;
  professionalTax: number;
  incomeTax: number;
  loanRecovery: number;
  otherDeductions: number;
  lopDeduction: number;
  totalDeductions: number;

  // Net
  netPay: number;

  // Employer contributions (shown for info)
  pfEmployer: number;
  esiEmployer: number;
  
  // Bank Details
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  paymentMode: "bank_transfer" | "cheque" | "cash";
  transactionRef?: string;
  paidDate?: string;
}

export interface TaxDeclaration {
  section80C: {
    ppf: number;
    elss: number;
    lifeInsurance: number;
    homeLoanPrincipal: number;
    childrenTuition: number;
    nps80CCD1: number;
    otherInvestments: number;
    total: number;
    maxLimit: number;
  };
  section80D: {
    selfInsurance: number;
    parentsInsurance: number;
    preventiveHealthCheck: number;
    total: number;
    maxLimit: number;
  };
  section80E: {
    educationLoanInterest: number;
  };
  section80G: {
    donations: number;
  };
  section24: {
    homeLoanInterest: number;
    maxLimit: number;
  };
  hraExemption: {
    actualHRA: number;
    rentPaid: number;
    basicSalary: number;
    isMetroCity: boolean;
    exemptAmount: number;
  };
  section80CCD2: {
    npsEmployer: number;
    maxLimit: number;
  };
  standardDeduction: number;
  totalDeductions: number;
  taxableIncome: number;
}

export interface PayrollSummary {
  month: string;
  year: number;
  totalEmployees: number;
  totalGross: number;
  totalNet: number;
  totalPFEmployee: number;
  totalPFEmployer: number;
  totalESIEmployee: number;
  totalESIEmployer: number;
  totalPT: number;
  totalTDS: number;
  totalLoanRecovery: number;
  processedCount: number;
  pendingCount: number;
  onHoldCount: number;
  status: "draft" | "processing" | "processed" | "paid";
}

// ─── Salary Structure Calculator ─────────────────────────────

export function calculateSalaryStructure(annualCTC: number): SalaryStructure {
  // Standard Indian salary breakup
  const basic = Math.round(annualCTC * 0.40);
  const hra = Math.round(basic * 0.50);
  const specialAllowance = Math.round(annualCTC * 0.15);
  const conveyanceAllowance = Math.min(19200, Math.round(annualCTC * 0.02));
  const medicalAllowance = Math.min(15000, Math.round(annualCTC * 0.01));
  const lta = Math.round(annualCTC * 0.03);
  
  // Employer contributions
  const employerPF = Math.min(Math.round(basic * 0.12), 21600);
  const esiThreshold = 21000 * 12; // ESI applicable if salary <= ₹21K/month
  const employerESI = annualCTC <= esiThreshold ? Math.round(annualCTC * 0.0325) : 0;
  const gratuity = Math.round((basic / 12) * 15 / 26 * 12 * 0.0481); // 4.81% of basic
  const insurance = Math.min(Math.round(annualCTC * 0.01), 25000);

  const otherAllowances = annualCTC - basic - hra - specialAllowance - conveyanceAllowance
    - medicalAllowance - lta - employerPF - employerESI - gratuity - insurance;

  const grossSalary = basic + hra + specialAllowance + conveyanceAllowance
    + medicalAllowance + lta + Math.max(0, otherAllowances);

  return {
    ctc: annualCTC,
    basic, hra, specialAllowance, conveyanceAllowance,
    medicalAllowance, lta,
    otherAllowances: Math.max(0, otherAllowances),
    grossSalary,
    employerPF, employerESI, gratuity, insurance,
  };
}

// ─── Monthly Payslip Generator ───────────────────────────────

export function generatePayslip(params: {
  structure: SalaryStructure;
  employeeId: string;
  employeeName: string;
  department: string;
  designation: string;
  month: string;
  year: number;
  workingDays: number;
  presentDays: number;
  overtimeHours?: number;
  overtimeRate?: number;
  bonus?: number;
  arrears?: number;
  loanRecovery?: number;
  otherDeductions?: number;
  annualTaxableIncome?: number;
  /** State code for professional tax, e.g. "KA". Defaults to Karnataka. */
  stateCode?: string;
  /**
   * Calendar month, 1-indexed.
   *
   * Needed because Maharashtra charges a higher professional tax in February.
   * Without it that month is under-deducted.
   */
  monthNumber?: number;
  /**
   * Whether the employee was contributing to ESI at the start of the current
   * contribution period.
   *
   * Someone who crosses the wage ceiling mid-period keeps contributing until
   * the period ends, so cover is not lost partway through a claim.
   */
  wasContributingToEsiAtPeriodStart?: boolean;
}): MonthlyPayslip {
  const { structure, workingDays, presentDays } = params;
  const lopDays = Math.max(0, workingDays - presentDays);
  const lopFactor = workingDays > 0 ? presentDays / workingDays : 1;

  // Monthly earnings (prorated for LOP)
  const basic = Math.round((structure.basic / 12) * lopFactor);
  const hra = Math.round((structure.hra / 12) * lopFactor);
  const specialAllowance = Math.round((structure.specialAllowance / 12) * lopFactor);
  const conveyanceAllowance = Math.round((structure.conveyanceAllowance / 12) * lopFactor);
  const medicalAllowance = Math.round((structure.medicalAllowance / 12) * lopFactor);
  const lta = Math.round((structure.lta / 12) * lopFactor);
  const otherAllowances = Math.round((structure.otherAllowances / 12) * lopFactor);
  
  const overtime = params.overtimeHours && params.overtimeRate
    ? Math.round(params.overtimeHours * params.overtimeRate) : 0;
  const bonus = params.bonus || 0;
  const arrears = params.arrears || 0;
  
  // Guard against a zero-working-day month: dividing by it yields Infinity,
  // and Infinity * 0 lopDays is NaN, which propagates through totalDeductions
  // into netPay and would emit a NaN payment instruction.
  const lopDeduction = workingDays > 0
    ? Math.round(((structure.grossSalary / 12) / workingDays) * lopDays)
    : 0;
  
  const totalEarnings = basic + hra + specialAllowance + conveyanceAllowance
    + medicalAllowance + lta + otherAllowances + overtime + bonus + arrears;

  // ── Statutory deductions ──
  //
  // Delegated to src/lib/statutory-india.ts, which is tested against the
  // actual rules. The inline arithmetic this replaces had two defects:
  //
  //   - The employer's 12% was written as a single figure. It must split:
  //     8.33% of the capped wage to the Pension Scheme and the remainder to
  //     PF, and the split is what the ECR file reports. It also omitted
  //     administrative charges and EDLI, understating employer cost.
  //   - ESI stopped the moment gross crossed ₹21,000. Someone who crosses
  //     mid-period must keep contributing to the end of the contribution
  //     period, or cover is lost partway through a claim.
  const pf = calculatePf(BigInt(Math.round(basic * 100)));
  const pfEmployee = Number(pf.employeeContributionMinor) / 100;
  const pfEmployer = Number(pf.employerPfMinor + pf.employerPensionMinor) / 100;

  const monthlyGross = basic + hra + specialAllowance + conveyanceAllowance + medicalAllowance + lta + otherAllowances;

  const esi = calculateEsi(BigInt(Math.round(monthlyGross * 100)), undefined, {
    wasContributingAtPeriodStart: params.wasContributingToEsiAtPeriodStart,
  });
  const esiEmployee = Number(esi.employeeContributionMinor) / 100;
  const esiEmployer = Number(esi.employerContributionMinor) / 100;

  const professionalTax = calculateProfessionalTax(
    monthlyGross,
    params.stateCode ?? "KA",
    params.monthNumber
  );
  
  // TDS (simplified - divide annual tax by 12)
  const annualTaxable = params.annualTaxableIncome || structure.grossSalary;
  const annualTax = calculateNewRegimeIncomeTax(annualTaxable);
  const incomeTax = Math.round(annualTax / 12);
  
  const loanRecovery = params.loanRecovery || 0;
  const otherDeductions = params.otherDeductions || 0;

  const totalDeductions = pfEmployee + esiEmployee + professionalTax + incomeTax
    + loanRecovery + otherDeductions + lopDeduction;

  const netPay = Math.max(0, totalEarnings - totalDeductions);

  return {
    employeeId: params.employeeId,
    employeeName: params.employeeName,
    department: params.department,
    designation: params.designation,
    month: params.month,
    year: params.year,
    workingDays, presentDays, lopDays,
    basic, hra, specialAllowance, conveyanceAllowance,
    medicalAllowance, lta, otherAllowances,
    overtime, bonus, arrears, totalEarnings,
    pfEmployee, esiEmployee, professionalTax, incomeTax,
    loanRecovery, otherDeductions: otherDeductions,
    lopDeduction, totalDeductions,
    netPay,
    pfEmployer, esiEmployer,
    paymentMode: "bank_transfer",
  };
}

// ─── Professional Tax ────────────────────────────────────────

/**
 * Professional tax for a month.
 *
 * Delegates to src/lib/statutory-india.ts, which holds the per-state slabs and
 * is tested against them. This function previously carried its own inline
 * table with two defects that cost real money:
 *
 *   - Karnataka's exemption threshold was ₹15,000. It has been ₹25,000 since
 *     1 April 2023, so ₹200 a month was being deducted from everyone earning
 *     between ₹15,001 and ₹25,000 who did not owe it.
 *   - Maharashtra's February rate of ₹300 was noted as "simplified" and not
 *     applied, under-deducting ₹100 a year for every employee in the state and
 *     leaving the employer short against the ₹2,500 statutory maximum.
 *
 * `month` is optional only for backwards compatibility with existing callers.
 * Pass it: without it, February in Maharashtra is charged at the wrong rate.
 */
export function calculateProfessionalTax(
  monthlySalary: number,
  state: string = "KA",
  month?: number
): number {
  const stateCode = STATE_CODES[state.trim().toLowerCase()] ?? state;
  const result = calculateStatutoryPt(
    BigInt(Math.round(monthlySalary * 100)),
    stateCode,
    month
  );

  return Number(result.amountMinor) / 100;
}

/** Long-form state names accepted by the previous signature. */
const STATE_CODES: Record<string, string> = {
  karnataka: "KA",
  maharashtra: "MH",
  "tamil nadu": "TN",
  tamilnadu: "TN",
  "west bengal": "WB",
  westbengal: "WB",
  telangana: "TS",
  gujarat: "GJ",
  delhi: "DL",
  haryana: "HR",
  "uttar pradesh": "UP",
};

// ─── Income Tax Calculator (New Regime FY 2025-26) ───────────

/**
 * Income tax under the new regime.
 *
 * Delegates to src/lib/statutory-india.ts. The inline version this replaces
 * applied the section 87A rebate below ₹7,00,000, which was the FY 2023-24
 * threshold. Under the Finance Act 2025 it is ₹12,00,000 — so everyone with a
 * taxable income between those figures was being taxed on income that carries
 * no liability at all. At ₹11,00,000 that was roughly ₹40,000 of tax deducted
 * from someone who owed nothing.
 */
export function calculateNewRegimeIncomeTax(annualIncome: number): number {
  const standardDeduction = 75000;
  const taxableIncome = Math.max(0, annualIncome - standardDeduction);

  const result = calculateStatutoryTax(BigInt(Math.round(taxableIncome * 100)));
  return Math.round(Number(result.totalTaxMinor) / 100);
}


// ─── Income Tax Calculator (Old Regime) ──────────────────────

export function calculateOldRegimeIncomeTax(taxableIncome: number): number {
  // Section 87A rebate
  if (taxableIncome <= 500000) return 0;

  const slabs = [
    { upto: 250000, rate: 0 },
    { upto: 500000, rate: 5 },
    { upto: 1000000, rate: 20 },
    { upto: Infinity, rate: 30 },
  ];

  let tax = 0;
  let remaining = taxableIncome;
  let prevLimit = 0;

  for (const slab of slabs) {
    const taxable = Math.min(remaining, slab.upto - prevLimit);
    if (taxable <= 0) break;
    tax += taxable * slab.rate / 100;
    remaining -= taxable;
    prevLimit = slab.upto;
  }

  tax = Math.round(tax * 1.04);
  return tax;
}

// ─── HRA Exemption Calculator ────────────────────────────────

export function calculateHRAExemption(params: {
  basic: number;
  hra: number;
  rentPaid: number;
  isMetroCity: boolean;
}): number {
  const { basic, hra, rentPaid, isMetroCity } = params;
  
  // Least of:
  // 1. Actual HRA received
  // 2. 50% of basic (metro) or 40% of basic (non-metro)
  // 3. Rent paid - 10% of basic
  
  const option1 = hra;
  const option2 = Math.round(basic * (isMetroCity ? 0.50 : 0.40));
  const option3 = Math.max(0, rentPaid - Math.round(basic * 0.10));
  
  return Math.min(option1, option2, option3);
}

// ─── Gratuity Calculator ─────────────────────────────────────

export function calculateGratuity(lastDrawnBasic: number, yearsOfService: number): number {
  if (yearsOfService < 5) return 0;
  // Gratuity = (15 × last drawn basic × years of service) / 26
  const gratuity = Math.round((15 * lastDrawnBasic * yearsOfService) / 26);
  // Maximum limit: ₹20,00,000
  return Math.min(gratuity, 2000000);
}

// ─── Leave Encashment Calculator ─────────────────────────────

export function calculateLeaveEncashment(basic: number, leaveBalance: number): number {
  const dailyRate = Math.round(basic / 30);
  return dailyRate * leaveBalance;
}

// ─── EMI Calculator ──────────────────────────────────────────

export function calculateEMI(principal: number, annualRate: number, tenureMonths: number): {
  emi: number;
  totalPayment: number;
  totalInterest: number;
  schedule: Array<{ month: number; emi: number; principal: number; interest: number; balance: number }>;
} {
  const monthlyRate = annualRate / 12 / 100;
  
  if (monthlyRate === 0) {
    const emi = Math.round(principal / tenureMonths);
    return {
      emi,
      totalPayment: emi * tenureMonths,
      totalInterest: 0,
      schedule: Array.from({ length: tenureMonths }, (_, i) => ({
        month: i + 1, emi, principal: emi, interest: 0,
        balance: Math.max(0, principal - emi * (i + 1)),
      })),
    };
  }

  const emi = Math.round(
    principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths) /
    (Math.pow(1 + monthlyRate, tenureMonths) - 1)
  );

  const totalPayment = emi * tenureMonths;
  const totalInterest = totalPayment - principal;

  let balance = principal;
  const schedule = Array.from({ length: tenureMonths }, (_, i) => {
    const interest = Math.round(balance * monthlyRate);
    const principalPart = emi - interest;
    balance = Math.max(0, balance - principalPart);
    return {
      month: i + 1, emi, principal: principalPart, interest, balance,
    };
  });

  return { emi, totalPayment, totalInterest, schedule };
}

// ─── Payroll Summary Generator ───────────────────────────────

export function generatePayrollSummary(payslips: MonthlyPayslip[], month: string, year: number): PayrollSummary {
  return {
    month, year,
    totalEmployees: payslips.length,
    totalGross: payslips.reduce((s, p) => s + p.totalEarnings, 0),
    totalNet: payslips.reduce((s, p) => s + p.netPay, 0),
    totalPFEmployee: payslips.reduce((s, p) => s + p.pfEmployee, 0),
    totalPFEmployer: payslips.reduce((s, p) => s + p.pfEmployer, 0),
    totalESIEmployee: payslips.reduce((s, p) => s + p.esiEmployee, 0),
    totalESIEmployer: payslips.reduce((s, p) => s + p.esiEmployer, 0),
    totalPT: payslips.reduce((s, p) => s + p.professionalTax, 0),
    totalTDS: payslips.reduce((s, p) => s + p.incomeTax, 0),
    totalLoanRecovery: payslips.reduce((s, p) => s + p.loanRecovery, 0),
    processedCount: payslips.length,
    pendingCount: 0,
    onHoldCount: 0,
    status: "processed",
  };
}

// ─── Utility: Format Indian Currency ─────────────────────────

export function formatINR(amount: number): string {
  return "₹" + Math.round(amount).toLocaleString("en-IN");
}

export function formatINRShort(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${Math.round(amount)}`;
}

// ─── Utility: Get Working Days in Month ──────────────────────

export function getWorkingDaysInMonth(year: number, month: number): number {
  // month is 0-indexed (0 = January)
  const lastDay = new Date(year, month + 1, 0).getDate();
  let workingDays = 0;
  for (let d = 1; d <= lastDay; d++) {
    const day = new Date(year, month, d).getDay();
    if (day !== 0 && day !== 6) workingDays++;
  }
  return workingDays;
}

// ─── Utility: Tax Slab Display ───────────────────────────────

/**
 * Renders the slab table that payroll actually computes with.
 *
 * These two lists were transcribed by hand from the slab tables in
 * `statutory-india.ts`. They agreed, but only because nobody had changed a
 * rate yet: Indian slabs move with every Finance Act, and the next person to
 * update a rate would have had to know that the number appears twice — once
 * where tax is computed and once where it is shown to the employee whose tax
 * it is. Miss the second and the portal explains a deduction it did not make.
 *
 * Deriving the display removes the choice. There is one slab table; this
 * formats it.
 */
function formatSlabs(slabs: TaxSlab[]): Array<{ range: string; rate: string }> {
  const rupees = (minor: Minor) => Number(minor / 100n).toLocaleString("en-IN");

  return slabs.map((slab, index) => {
    const from = slab.fromMinor;
    const to = slab.toMinor;

    const range =
      index === 0
        ? `Up to ₹${rupees(to ?? from)}`
        : to === null
          ? `Above ₹${rupees(from)}`
          : `₹${rupees(from + 100n)} - ₹${rupees(to)}`;

    return { range, rate: slab.rate === 0 ? "Nil" : `${slab.rate}%` };
  });
}

export function getNewRegimeSlabs(): Array<{ range: string; rate: string }> {
  return formatSlabs(NEW_REGIME_SLABS_FY2526);
}

export function getOldRegimeSlabs(): Array<{ range: string; rate: string }> {
  return formatSlabs(OLD_REGIME_SLABS);
}
