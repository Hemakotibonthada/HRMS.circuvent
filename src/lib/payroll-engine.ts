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

  // Deductions
  const pfEmployee = Math.min(Math.round(basic * 0.12), 1800);
  const pfEmployer = Math.min(Math.round(basic * 0.12), 1800);
  
  const monthlyGross = basic + hra + specialAllowance + conveyanceAllowance + medicalAllowance + lta + otherAllowances;
  const esiEmployee = monthlyGross <= 21000 ? Math.round(monthlyGross * 0.0075) : 0;
  const esiEmployer = monthlyGross <= 21000 ? Math.round(monthlyGross * 0.0325) : 0;
  
  const professionalTax = calculateProfessionalTax(monthlyGross);
  
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

// ─── Professional Tax Calculator (Karnataka) ─────────────────

export function calculateProfessionalTax(monthlySalary: number, state: string = "karnataka"): number {
  // Karnataka slabs (most common for Bangalore-based companies)
  if (state === "karnataka") {
    if (monthlySalary <= 15000) return 0;
    if (monthlySalary <= 25000) return 200;
    return 200; // Max ₹2,400 per year (₹200/month)
  }
  
  // Maharashtra
  if (state === "maharashtra") {
    if (monthlySalary <= 7500) return 0;
    if (monthlySalary <= 10000) return 175;
    return 200; // Simplified (actual: ₹300 for Feb, ₹200 for others)
  }

  // Default
  return monthlySalary > 15000 ? 200 : 0;
}

// ─── Income Tax Calculator (New Regime FY 2025-26) ───────────

export function calculateNewRegimeIncomeTax(annualIncome: number): number {
  const standardDeduction = 75000;
  const taxableIncome = Math.max(0, annualIncome - standardDeduction);
  
  // Section 87A rebate
  if (taxableIncome <= 700000) return 0;

  const slabs = [
    { upto: 400000, rate: 0 },
    { upto: 800000, rate: 5 },
    { upto: 1200000, rate: 10 },
    { upto: 1600000, rate: 15 },
    { upto: 2000000, rate: 20 },
    { upto: 2400000, rate: 25 },
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

  // 4% Health & Education Cess
  tax = Math.round(tax * 1.04);
  return tax;
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

export function getNewRegimeSlabs(): Array<{ range: string; rate: string }> {
  return [
    { range: "Up to ₹4,00,000", rate: "Nil" },
    { range: "₹4,00,001 - ₹8,00,000", rate: "5%" },
    { range: "₹8,00,001 - ₹12,00,000", rate: "10%" },
    { range: "₹12,00,001 - ₹16,00,000", rate: "15%" },
    { range: "₹16,00,001 - ₹20,00,000", rate: "20%" },
    { range: "₹20,00,001 - ₹24,00,000", rate: "25%" },
    { range: "Above ₹24,00,000", rate: "30%" },
  ];
}

export function getOldRegimeSlabs(): Array<{ range: string; rate: string }> {
  return [
    { range: "Up to ₹2,50,000", rate: "Nil" },
    { range: "₹2,50,001 - ₹5,00,000", rate: "5%" },
    { range: "₹5,00,001 - ₹10,00,000", rate: "20%" },
    { range: "Above ₹10,00,000", rate: "30%" },
  ];
}
