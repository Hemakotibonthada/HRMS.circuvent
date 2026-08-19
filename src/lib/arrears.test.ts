// Backdated revisions, and the relief that stops arrears being taxed twice
// as hard as they should be.

import { describe, expect, it } from "vitest";
import {
  arrearsFor,
  financialYearOf,
  section89Relief,
  taxableIncomeForEarlierYear,
  type SalaryRevision,
} from "@/lib/arrears";

/** Effective April, paid from September: five months of arrears. */
function revision(overrides: Partial<SalaryRevision> = {}): SalaryRevision {
  return {
    effectiveMonth: 4,
    effectiveYear: 2025,
    paidFromMonth: 9,
    paidFromYear: 2025,
    oldMonthlyGrossMinor: 1_00_000_00n,
    newMonthlyGrossMinor: 1_20_000_00n,
    ...overrides,
  };
}

describe("which months are owed", () => {
  it("covers the effective month up to the month payroll caught up", () => {
    const result = arrearsFor(revision());
    expect(result.months.map((m) => m.month)).toEqual([4, 5, 6, 7, 8]);
  });

  it("pays the difference for each of them", () => {
    const result = arrearsFor(revision());
    expect(result.totalMinor).toBe(1_00_000_00n);
  });

  it("owes nothing when the revision was paid from the month it took effect", () => {
    // The case that must not produce a spurious month: it would pay twice.
    const result = arrearsFor(revision({ paidFromMonth: 4, paidFromYear: 2025 }));
    expect(result.months).toHaveLength(0);
    expect(result.totalMinor).toBe(0n);
  });

  it("owes nothing when payroll is somehow ahead of the effective date", () => {
    const result = arrearsFor(revision({ effectiveMonth: 9, paidFromMonth: 4 }));
    expect(result.months).toHaveLength(0);
  });

  it("rolls across a calendar year boundary", () => {
    const result = arrearsFor(
      revision({ effectiveMonth: 11, effectiveYear: 2025, paidFromMonth: 2, paidFromYear: 2026 })
    );
    expect(result.months.map((m) => `${m.year}-${m.month}`)).toEqual([
      "2025-11",
      "2025-12",
      "2026-1",
    ]);
  });
});

describe("which financial year each month belongs to", () => {
  it("puts April into the year that begins then", () => {
    expect(financialYearOf(4, 2025)).toBe(2025);
    expect(financialYearOf(12, 2025)).toBe(2025);
  });

  it("puts January to March into the year before", () => {
    expect(financialYearOf(1, 2026)).toBe(2025);
    expect(financialYearOf(3, 2026)).toBe(2025);
  });

  it("splits arrears spanning a year end across both years", () => {
    const result = arrearsFor(
      revision({ effectiveMonth: 2, effectiveYear: 2025, paidFromMonth: 6, paidFromYear: 2025 })
    );
    expect(result.byFinancialYear).toEqual([
      { financialYear: 2024, amountMinor: 40_000_00n },
      { financialYear: 2025, amountMinor: 40_000_00n },
    ]);
  });

  it("adds up to the total across every year", () => {
    const result = arrearsFor(
      revision({ effectiveMonth: 1, effectiveYear: 2025, paidFromMonth: 8, paidFromYear: 2025 })
    );
    const summed = result.byFinancialYear.reduce((a, y) => a + y.amountMinor, 0n);
    expect(summed).toBe(result.totalMinor);
  });
});

describe("relief under section 89", () => {
  it("arises when the arrears are taxed harder now than they would have been", () => {
    // Earning far more now than in the year the arrears relate to.
    const result = section89Relief({
      currentFinancialYear: 2025,
      currentTaxableIncomeMinor: 30_00_000_00n,
      currentRegime: "new",
      earlierYears: [
        {
          financialYear: 2022,
          taxableIncomeMinor: 6_00_000_00n,
          arrearMinor: 3_00_000_00n,
          regime: "old",
        },
      ],
    });
    expect(result.reliefMinor).toBeGreaterThan(0n);
    expect(result.requiresForm10E).toBe(true);
  });

  it("says Form 10E is required, because the department disallows it otherwise", () => {
    const result = section89Relief({
      currentFinancialYear: 2025,
      currentTaxableIncomeMinor: 30_00_000_00n,
      currentRegime: "new",
      earlierYears: [
        { financialYear: 2022, taxableIncomeMinor: 6_00_000_00n, arrearMinor: 3_00_000_00n, regime: "old" },
      ],
    });
    expect(result.note).toMatch(/Form 10E must be filed/);
  });

  it("is nil when the earlier year would have taxed the arrears just as hard", () => {
    const result = section89Relief({
      currentFinancialYear: 2025,
      currentTaxableIncomeMinor: 12_00_000_00n,
      currentRegime: "old",
      earlierYears: [
        {
          financialYear: 2024,
          taxableIncomeMinor: 12_00_000_00n,
          arrearMinor: 1_00_000_00n,
          regime: "old",
        },
      ],
    });
    expect(result.reliefMinor).toBe(0n);
    expect(result.requiresForm10E).toBe(false);
  });

  it("never returns a negative relief, which would increase the refund", () => {
    // Earning much less now than then: the arrears are better taxed today.
    const result = section89Relief({
      currentFinancialYear: 2025,
      currentTaxableIncomeMinor: 5_00_000_00n,
      currentRegime: "old",
      earlierYears: [
        {
          financialYear: 2022,
          taxableIncomeMinor: 40_00_000_00n,
          arrearMinor: 2_00_000_00n,
          regime: "old",
        },
      ],
    });
    expect(result.reliefMinor).toBe(0n);
    expect(result.note).toMatch(/No relief arises/);
  });

  it("removes the arrears from the current year rather than being told twice", () => {
    const result = section89Relief({
      currentFinancialYear: 2025,
      currentTaxableIncomeMinor: 30_00_000_00n,
      currentRegime: "new",
      earlierYears: [
        { financialYear: 2022, taxableIncomeMinor: 6_00_000_00n, arrearMinor: 3_00_000_00n, regime: "old" },
      ],
    });
    expect(result.taxThisYearWithoutArrearsMinor).toBeLessThan(result.taxThisYearWithArrearsMinor);
    expect(result.extraTaxThisYearMinor).toBe(
      result.taxThisYearWithArrearsMinor - result.taxThisYearWithoutArrearsMinor
    );
  });

  it("spreads across several earlier years", () => {
    const result = section89Relief({
      currentFinancialYear: 2025,
      currentTaxableIncomeMinor: 35_00_000_00n,
      currentRegime: "new",
      earlierYears: [
        { financialYear: 2022, taxableIncomeMinor: 5_00_000_00n, arrearMinor: 2_00_000_00n, regime: "old" },
        { financialYear: 2023, taxableIncomeMinor: 6_00_000_00n, arrearMinor: 2_00_000_00n, regime: "old" },
      ],
    });
    expect(result.reliefMinor).toBeGreaterThan(0n);
    expect(result.extraTaxInEarlierYearsMinor).toBe(
      result.taxInEarlierYearsWithArrearsMinor - result.taxInEarlierYearsWithoutArrearsMinor
    );
  });

  it("gives no relief when there are no earlier years to spread into", () => {
    const result = section89Relief({
      currentFinancialYear: 2025,
      currentTaxableIncomeMinor: 30_00_000_00n,
      currentRegime: "new",
      earlierYears: [],
    });
    expect(result.reliefMinor).toBe(0n);
  });
});

describe("recomputing an earlier year", () => {
  it("applies the standard deduction for that year's regime", () => {
    expect(taxableIncomeForEarlierYear(10_00_000_00n, "old")).toBe(9_50_000_00n);
    expect(taxableIncomeForEarlierYear(10_00_000_00n, "new")).toBe(9_25_000_00n);
  });

  it("takes further deductions off as well", () => {
    expect(taxableIncomeForEarlierYear(10_00_000_00n, "old", 1_50_000_00n)).toBe(8_00_000_00n);
  });

  it("never goes below zero", () => {
    expect(taxableIncomeForEarlierYear(20_000_00n, "new")).toBe(0n);
  });
});
