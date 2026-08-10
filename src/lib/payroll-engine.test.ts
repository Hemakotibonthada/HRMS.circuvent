// Payroll is the highest-consequence logic in the product: a silent arithmetic
// error underpays real people and creates statutory liability. These tests
// pin the behaviour that must not drift.

import { describe, expect, it } from "vitest";
import {
  calculateNewRegimeIncomeTax,
  calculateProfessionalTax,
  calculateSalaryStructure,
  generatePayslip,
} from "@/lib/payroll-engine";

const CTC_12L = 1_200_000;

describe("calculateSalaryStructure", () => {
  const s = calculateSalaryStructure(CTC_12L);

  it("sets basic to 40% of CTC and HRA to 50% of basic", () => {
    expect(s.basic).toBe(480_000);
    expect(s.hra).toBe(240_000);
  });

  it("caps conveyance and medical allowance at the statutory annual limits", () => {
    // 2% of 12L is 24,000 but conveyance is capped at 19,200/year.
    expect(s.conveyanceAllowance).toBe(19_200);
    // 1% of 12L is 12,000, below the 15,000 medical cap, so it is not clamped.
    expect(s.medicalAllowance).toBe(12_000);
  });

  it("caps employer PF at the ₹21,600 annual ceiling for high salaries", () => {
    // 12% of a 480k basic is 57,600, well over the ceiling.
    expect(s.employerPF).toBe(21_600);
    expect(calculateSalaryStructure(100_000).employerPF).toBe(4_800);
  });

  it("applies employer ESI only at or below the ₹21k/month wage threshold", () => {
    expect(s.employerESI).toBe(0);

    const lowPaid = calculateSalaryStructure(21_000 * 12);
    expect(lowPaid.employerESI).toBeGreaterThan(0);

    // One rupee over the annual threshold and ESI stops applying.
    expect(calculateSalaryStructure(21_000 * 12 + 1).employerESI).toBe(0);
  });

  it("never emits a negative allowance when deductions exceed CTC", () => {
    // A very low CTC makes the residual "other allowances" arithmetic go
    // negative; the structure must clamp rather than emit a negative component.
    const tiny = calculateSalaryStructure(50_000);
    expect(tiny.otherAllowances).toBeGreaterThanOrEqual(0);
    expect(tiny.grossSalary).toBeGreaterThan(0);
  });

  it("keeps gross salary within CTC", () => {
    // Gross is employee-facing pay and excludes employer contributions, so it
    // can never exceed the total cost to company.
    expect(s.grossSalary).toBeLessThanOrEqual(s.ctc);
  });
});

describe("calculateProfessionalTax", () => {
  it("exempts Karnataka salaries below ₹25,000/month", () => {
    // The threshold has been ₹25,000 since 1 April 2023. This test previously
    // asserted ₹15,000, the pre-2023 figure, so it was pinning a bug that
    // deducted ₹200 a month from everyone in between who did not owe it.
    //
    // Karnataka's notification reads "not less than ₹25,000", so ₹25,000
    // exactly is taxable — unlike Maharashtra, which exempts up to ₹7,500.
    expect(calculateProfessionalTax(24_999)).toBe(0);
    expect(calculateProfessionalTax(25_000)).toBe(200);
    expect(calculateProfessionalTax(20_000)).toBe(0);
  });

  it("caps Karnataka professional tax at ₹200/month", () => {
    expect(calculateProfessionalTax(500_000)).toBe(200);
  });

  it("uses the Maharashtra slabs when that state is given", () => {
    expect(calculateProfessionalTax(7_500, "maharashtra")).toBe(0);
    expect(calculateProfessionalTax(9_000, "maharashtra")).toBe(175);
    expect(calculateProfessionalTax(50_000, "maharashtra", 3)).toBe(200);
  });

  it("charges Maharashtra's higher February rate", () => {
    // ₹300 in February brings the annual total to the ₹2,500 statutory
    // maximum. This was previously commented as "simplified" and skipped,
    // under-deducting ₹100 a year for every employee in the state.
    expect(calculateProfessionalTax(50_000, "maharashtra", 2)).toBe(300);
  });
});

describe("calculateNewRegimeIncomeTax", () => {
  it("charges no tax when income after standard deduction is within the 87A rebate", () => {
    // 7,00,000 taxable is the rebate ceiling; 75,000 standard deduction means
    // gross income up to 7,75,000 attracts no tax.
    expect(calculateNewRegimeIncomeTax(775_000)).toBe(0);
  });

  it("charges tax once income passes the rebate ceiling", () => {
    // The section 87A rebate covers taxable income up to ₹12,00,000 under the
    // Finance Act 2025. This previously asserted tax at ₹9,00,000 gross, which
    // pinned the FY 2023-24 threshold of ₹7,00,000 — so everyone between the
    // two was taxed on income carrying no liability at all.
    expect(calculateNewRegimeIncomeTax(900_000)).toBe(0);
    expect(calculateNewRegimeIncomeTax(1_400_000)).toBeGreaterThan(0);
  });

  it("is monotonically non-decreasing across the slab boundaries", () => {
    // Earning more must never reduce take-home tax liability.
    let previous = -1;
    for (let income = 0; income <= 5_000_000; income += 25_000) {
      const tax = calculateNewRegimeIncomeTax(income);
      expect(tax).toBeGreaterThanOrEqual(previous);
      previous = tax;
    }
  });

  it("never taxes more than the income itself", () => {
    for (const income of [800_000, 1_500_000, 3_000_000, 10_000_000]) {
      expect(calculateNewRegimeIncomeTax(income)).toBeLessThan(income);
    }
  });

  it("includes the 4% health and education cess", () => {
    // ₹20,00,000 gross leaves ₹19,25,000 taxable, above the rebate ceiling.
    // Slabs: nil on 4L, 5% on 4L = 20,000, 10% on 4L = 40,000,
    // 15% on 4L = 60,000, 20% on 3,25,000 = 65,000. Total 1,85,000.
    const income = 2_000_000;
    const beforeCess = 20_000 + 40_000 + 60_000 + 65_000;

    expect(calculateNewRegimeIncomeTax(income)).toBe(Math.round(beforeCess * 1.04));
  });

  it("applies the rebate up to ₹12,00,000 taxable", () => {
    // ₹12,75,000 gross less the ₹75,000 standard deduction is exactly at the
    // ceiling, so nothing is due; a rupee more and the whole slab tax bites.
    expect(calculateNewRegimeIncomeTax(1_275_000)).toBe(0);
    expect(calculateNewRegimeIncomeTax(1_300_000)).toBeGreaterThan(0);
  });
});

describe("generatePayslip", () => {
  const structure = calculateSalaryStructure(CTC_12L);

  const base = {
    structure,
    employeeId: "emp-1",
    employeeName: "Test Employee",
    department: "Engineering",
    designation: "Engineer",
    month: "April",
    year: 2026,
    workingDays: 22,
    presentDays: 22,
  };

  it("produces no loss-of-pay deduction for a full month", () => {
    const slip = generatePayslip(base);
    expect(slip.lopDays).toBe(0);
    expect(slip.lopDeduction).toBe(0);
  });

  it("prorates earnings and applies a deduction for unpaid days", () => {
    const full = generatePayslip(base);
    const partial = generatePayslip({ ...base, presentDays: 11 });

    expect(partial.lopDays).toBe(11);
    expect(partial.basic).toBeLessThan(full.basic);
    expect(partial.lopDeduction).toBeGreaterThan(0);
    expect(partial.netPay).toBeLessThan(full.netPay);
  });

  it("caps the employee PF contribution at ₹1,800/month", () => {
    const slip = generatePayslip(base);
    expect(slip.pfEmployee).toBe(1_800);
    expect(slip.pfEmployer).toBe(1_800);
  });

  it("balances earnings, deductions and net pay", () => {
    const slip = generatePayslip({
      ...base,
      presentDays: 20,
      bonus: 5_000,
      arrears: 1_000,
      loanRecovery: 2_000,
      otherDeductions: 500,
    });

    const deductions =
      slip.pfEmployee +
      slip.esiEmployee +
      slip.professionalTax +
      slip.incomeTax +
      slip.loanRecovery +
      slip.otherDeductions +
      slip.lopDeduction;

    expect(slip.totalDeductions).toBe(deductions);
    expect(slip.netPay).toBe(Math.max(0, slip.totalEarnings - slip.totalDeductions));
  });

  it("includes overtime only when both hours and rate are supplied", () => {
    expect(generatePayslip({ ...base, overtimeHours: 10 }).overtime).toBe(0);
    expect(generatePayslip({ ...base, overtimeRate: 500 }).overtime).toBe(0);
    expect(
      generatePayslip({ ...base, overtimeHours: 10, overtimeRate: 500 }).overtime
    ).toBe(5_000);
  });

  it("never returns a negative net pay", () => {
    // Recoveries larger than the month's earnings must floor at zero rather
    // than producing a negative payment instruction to the bank.
    const slip = generatePayslip({ ...base, loanRecovery: 10_000_000 });
    expect(slip.netPay).toBe(0);
  });

  it("does not divide by zero when a month has no working days", () => {
    const slip = generatePayslip({ ...base, workingDays: 0, presentDays: 0 });
    expect(Number.isFinite(slip.netPay)).toBe(true);
    expect(Number.isNaN(slip.totalEarnings)).toBe(false);
  });

  it("applies ESI to low earners and not to high earners", () => {
    const highPaid = generatePayslip(base);
    expect(highPaid.esiEmployee).toBe(0);

    const lowPaid = generatePayslip({
      ...base,
      structure: calculateSalaryStructure(200_000),
    });
    expect(lowPaid.esiEmployee).toBeGreaterThan(0);
    expect(lowPaid.esiEmployer).toBeGreaterThan(lowPaid.esiEmployee);
  });
});
