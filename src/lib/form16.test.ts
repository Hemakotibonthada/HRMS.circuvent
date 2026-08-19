// Form 16 Part B, and whether it agrees with the payslips it came from.
//
// The tests are written against the statutory structure rather than against
// convenient totals: a Form 16 whose bottom line is right and whose section 16
// and Chapter VI-A lines are swapped is still wrong, and only an assessing
// officer would ever find out.

import { describe, expect, it } from "vitest";
import {
  buildForm16PartB,
  financialQuarterOf,
  quarterly24Q,
  reconcile,
  type PayrollMonth,
} from "@/lib/form16";

/** A month on ₹1,00,000 gross: ₹50,000 basic, ₹20,000 HRA, ₹30,000 special. */
function month(overrides: Partial<PayrollMonth> & { month: number }): PayrollMonth {
  return {
    year: 2025,
    basicMinor: 50_000_00n,
    hraMinor: 20_000_00n,
    conveyanceMinor: 0n,
    medicalMinor: 0n,
    ltaMinor: 0n,
    specialAllowanceMinor: 30_000_00n,
    otherEarningsMinor: 0n,
    overtimeMinor: 0n,
    bonusMinor: 0n,
    arrearsMinor: 0n,
    grossMinor: 1_00_000_00n,
    professionalTaxMinor: 200_00n,
    incomeTaxMinor: 0n,
    ...overrides,
  };
}

/** A full April-to-March year. */
function fullYear(overrides: Partial<PayrollMonth> = {}): PayrollMonth[] {
  const order = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
  return order.map((m) => month({ month: m, year: m >= 4 ? 2025 : 2026, ...overrides }));
}

/**
 * A year that actually attracts tax.
 *
 * At ₹12,00,000 the new regime's rebate reaches the whole liability, so a
 * reconciliation test built on it compares zero with zero and passes without
 * proving anything. ₹30,00,000 is comfortably past both the rebate and the
 * first surcharge band.
 */
function taxableYear(overrides: Partial<PayrollMonth> = {}): PayrollMonth[] {
  return fullYear({
    basicMinor: 1_25_000_00n,
    hraMinor: 50_000_00n,
    specialAllowanceMinor: 75_000_00n,
    grossMinor: 2_50_000_00n,
    ...overrides,
  });
}

describe("gross salary", () => {
  it("adds every earning line, HRA included", () => {
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "old",
      months: fullYear(),
      declarations: [],
    });
    expect(form.salaryUnder17_1Minor).toBe(12_00_000_00n);
    expect(form.grossSalaryMinor).toBe(12_00_000_00n);
  });

  it("keeps HRA in salary and removes it again as an exemption", () => {
    // Netting HRA off early gives the right total and the wrong form.
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "old",
      months: fullYear(),
      declarations: [],
      rentPaidMinor: 3_60_000_00n,
      metroCity: true,
    });
    expect(form.salaryUnder17_1Minor).toBe(12_00_000_00n);
    expect(form.hraExemptUnder10_13AMinor).toBeGreaterThan(0n);
    expect(form.netSalaryMinor).toBe(form.grossSalaryMinor - form.hraExemptUnder10_13AMinor);
  });

  it("carries perquisites and profits in lieu as their own lines", () => {
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "old",
      months: fullYear(),
      declarations: [],
      perquisitesMinor: 1_00_000_00n,
      profitsInLieuMinor: 50_000_00n,
    });
    expect(form.perquisitesUnder17_2Minor).toBe(1_00_000_00n);
    expect(form.profitsInLieuUnder17_3Minor).toBe(50_000_00n);
    expect(form.grossSalaryMinor).toBe(13_50_000_00n);
  });

  it("does not annualise a part year", () => {
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "old",
      months: fullYear().slice(0, 6),
      declarations: [],
    });
    expect(form.salaryUnder17_1Minor).toBe(6_00_000_00n);
  });
});

describe("section 16, which is not Chapter VI-A", () => {
  it("puts professional tax under 16(iii), not with 80C", () => {
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "old",
      months: fullYear(),
      declarations: [{ section: "80C", declaredMinor: 1_50_000_00n }],
    });
    expect(form.professionalTaxUnder16_iiiMinor).toBe(2_400_00n);
    expect(form.aggregateDeductibleMinor).toBe(1_50_000_00n);
    expect(form.chapterVIA.map((l) => l.section)).not.toContain("professional_tax");
  });

  it("adds the standard deduction and professional tax into one section 16 total", () => {
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "old",
      months: fullYear(),
      declarations: [],
    });
    expect(form.totalSection16DeductionsMinor).toBe(
      form.standardDeductionUnder16_iaMinor + form.professionalTaxUnder16_iiiMinor
    );
  });

  it("refuses professional tax under the new regime", () => {
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "new",
      months: fullYear(),
      declarations: [],
    });
    expect(form.professionalTaxUnder16_iiiMinor).toBe(0n);
    expect(form.standardDeductionUnder16_iaMinor).toBe(75_000_00n);
  });

  it("gives the larger standard deduction under the new regime", () => {
    const oldForm = buildForm16PartB({
      financialYear: 2025,
      regime: "old",
      months: fullYear(),
      declarations: [],
    });
    expect(oldForm.standardDeductionUnder16_iaMinor).toBe(50_000_00n);
  });
});

describe("Chapter VI-A", () => {
  it("shows what was claimed beside what was allowed", () => {
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "old",
      months: fullYear(),
      declarations: [{ section: "80C", declaredMinor: 1_50_000_00n }],
    });
    const line = form.chapterVIA.find((l) => l.section === "80C");
    expect(line?.grossAmountMinor).toBe(1_50_000_00n);
    expect(line?.deductibleAmountMinor).toBe(1_50_000_00n);
  });

  it("shows a capped claim at its gross and its allowed figure, which differ", () => {
    // The form asks for both columns precisely so an over-claim is visible.
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "old",
      months: fullYear(),
      declarations: [{ section: "80D", declaredMinor: 90_000_00n }],
    });
    const line = form.chapterVIA.find((l) => l.section === "80D");
    expect(line?.grossAmountMinor).toBe(90_000_00n);
    expect(line?.deductibleAmountMinor).toBe(50_000_00n);
  });

  it("drops nothing to zero silently under the new regime — it lists it as nil", () => {
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "new",
      months: fullYear(),
      declarations: [{ section: "80C", declaredMinor: 1_50_000_00n }],
    });
    const line = form.chapterVIA.find((l) => l.section === "80C");
    expect(line?.grossAmountMinor).toBe(1_50_000_00n);
    expect(line?.deductibleAmountMinor).toBe(0n);
    expect(form.aggregateDeductibleMinor).toBe(0n);
  });

  it("withdraws an unproven claim once the window has shut", () => {
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "old",
      months: fullYear(),
      declarations: [{ section: "80C", declaredMinor: 1_50_000_00n, proofStatus: "awaiting" }],
      proofWindowClosed: true,
    });
    expect(form.aggregateDeductibleMinor).toBe(0n);
  });
});

describe("the arithmetic holds together", () => {
  const form = buildForm16PartB({
    financialYear: 2025,
    regime: "old",
    months: fullYear(),
    declarations: [{ section: "80C", declaredMinor: 1_50_000_00n }],
    rentPaidMinor: 3_60_000_00n,
    metroCity: true,
  });

  it("takes income chargeable as net salary less section 16", () => {
    expect(form.incomeChargeableUnderSalariesMinor).toBe(
      form.netSalaryMinor - form.totalSection16DeductionsMinor
    );
  });

  it("takes gross total income as income chargeable plus other income", () => {
    expect(form.grossTotalIncomeMinor).toBe(
      form.incomeChargeableUnderSalariesMinor + form.otherIncomeMinor
    );
  });

  it("takes taxable income as gross total less Chapter VI-A", () => {
    expect(form.totalTaxableIncomeMinor).toBe(
      form.grossTotalIncomeMinor - form.aggregateDeductibleMinor
    );
  });

  it("builds tax payable from slab tax, rebate, surcharge and cess", () => {
    expect(form.taxPayableMinor).toBe(
      form.taxOnTotalIncomeMinor - form.rebateUnder87AMinor + form.surchargeMinor + form.cessMinor
    );
  });

  it("never reports a negative taxable income", () => {
    const tiny = buildForm16PartB({
      financialYear: 2025,
      regime: "old",
      months: fullYear().slice(0, 1),
      declarations: [{ section: "80C", declaredMinor: 1_50_000_00n }],
    });
    expect(tiny.totalTaxableIncomeMinor).toBe(0n);
  });

  it("names the assessment year as the one after the financial year", () => {
    expect(form.assessmentYear).toBe("2026-27");
  });
});

describe("reconciling against the payslips", () => {
  it("is balanced when deductions match the liability", () => {
    const months = taxableYear();
    const dry = buildForm16PartB({
      financialYear: 2025,
      regime: "new",
      months,
      declarations: [],
    });
    const perMonth = dry.netTaxPayableMinor / 12n;
    const withTds = months.map((m) => ({ ...m, incomeTaxMinor: perMonth }));

    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "new",
      months: withTds,
      declarations: [],
    });
    expect(reconcile(form, 50_00n).balanced).toBe(true);
  });

  it("reports a shortfall rather than absorbing it", () => {
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "new",
      months: taxableYear(),
      declarations: [],
    });
    const result = reconcile(form);
    expect(result.balanced).toBe(false);
    expect(result.differenceMinor).toBeGreaterThan(0n);
    expect(result.message).toMatch(/more tax is due than was deducted/);
    expect(form.balancePayableMinor).toBe(result.differenceMinor);
  });

  it("reports an over-deduction as a refund the employee claims", () => {
    const months = fullYear({ incomeTaxMinor: 50_000_00n });
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "new",
      months,
      declarations: [],
    });
    const result = reconcile(form);
    expect(result.differenceMinor).toBeLessThan(0n);
    expect(result.message).toMatch(/refund/);
    expect(form.refundDueMinor).toBeGreaterThan(0n);
    expect(form.balancePayableMinor).toBe(0n);
  });

  it("tolerates a few rupees of monthly rounding", () => {
    const months = taxableYear();
    const dry = buildForm16PartB({
      financialYear: 2025,
      regime: "new",
      months,
      declarations: [],
    });
    const perMonth = dry.netTaxPayableMinor / 12n;
    const withTds = months.map((m, i) => ({
      ...m,
      incomeTaxMinor: i === 0 ? perMonth + 3_00n : perMonth,
    }));
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "new",
      months: withTds,
      declarations: [],
    });
    expect(reconcile(form, 10_00n).balanced).toBe(true);
  });

  it("does not report both a balance payable and a refund", () => {
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "new",
      months: fullYear({ incomeTaxMinor: 5_000_00n }),
      declarations: [],
    });
    expect(form.balancePayableMinor > 0n && form.refundDueMinor > 0n).toBe(false);
  });
});

describe("relief under section 89", () => {
  it("reduces the net tax payable", () => {
    const base = buildForm16PartB({
      financialYear: 2025,
      regime: "new",
      months: taxableYear(),
      declarations: [],
    });
    const relieved = buildForm16PartB({
      financialYear: 2025,
      regime: "new",
      months: taxableYear(),
      declarations: [],
      reliefUnder89Minor: 10_000_00n,
    });
    expect(base.netTaxPayableMinor).toBeGreaterThan(10_000_00n);
    expect(relieved.netTaxPayableMinor).toBe(base.netTaxPayableMinor - 10_000_00n);
  });

  it("cannot push the net tax below zero", () => {
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "new",
      months: taxableYear(),
      declarations: [],
      reliefUnder89Minor: 99_00_000_00n,
    });
    expect(form.netTaxPayableMinor).toBe(0n);
  });
});

describe("Form 24Q quarters", () => {
  it("starts the year in April, not January", () => {
    expect(financialQuarterOf(4)).toBe(1);
    expect(financialQuarterOf(6)).toBe(1);
    expect(financialQuarterOf(7)).toBe(2);
    expect(financialQuarterOf(10)).toBe(3);
    expect(financialQuarterOf(1)).toBe(4);
    expect(financialQuarterOf(3)).toBe(4);
  });

  it("splits a year into four quarters of three months", () => {
    const quarters = quarterly24Q(fullYear());
    expect(quarters).toHaveLength(4);
    for (const q of quarters) expect(q.months).toHaveLength(3);
    expect(quarters[0].months).toEqual([4, 5, 6]);
    expect(quarters[3].months).toEqual([1, 2, 3]);
  });

  it("totals pay and tax within each quarter", () => {
    const quarters = quarterly24Q(fullYear({ incomeTaxMinor: 5_000_00n }));
    expect(quarters[0].amountPaidMinor).toBe(3_00_000_00n);
    expect(quarters[0].taxDeductedMinor).toBe(15_000_00n);
  });

  it("returns an empty quarter as zeroes rather than omitting it", () => {
    // A nil return still has to be filed; a missing quarter reads as one that
    // was not.
    const quarters = quarterly24Q(fullYear().slice(0, 3));
    expect(quarters).toHaveLength(4);
    expect(quarters[1].months).toEqual([]);
    expect(quarters[1].taxDeductedMinor).toBe(0n);
  });

  it("adds up to the year's total tax deducted", () => {
    const months = fullYear({ incomeTaxMinor: 5_000_00n });
    const quarters = quarterly24Q(months);
    const total = quarters.reduce((a, q) => a + q.taxDeductedMinor, 0n);
    const form = buildForm16PartB({
      financialYear: 2025,
      regime: "new",
      months,
      declarations: [],
    });
    expect(total).toBe(form.taxDeductedAtSourceMinor);
  });
});
