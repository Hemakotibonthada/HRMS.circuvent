// ═══════════════════════════════════════════════════════════════
// SALARY REVISION ARREARS, AND RELIEF UNDER SECTION 89
// ═══════════════════════════════════════════════════════════════
//
// An increment agreed in September and effective from April leaves five months
// of underpayment to make good. That is arrears, and it is simple arithmetic.
//
// The part that is not simple is what it does to the employee's tax. Arrears
// are taxed in the year they are *received*, not the year they were earned, so
// a backdated revision can push somebody into a higher slab for income that
// belonged to a year when they were not in it. Section 89(1) exists to undo
// that, and Form 10E is how it is claimed.
//
// Most Indian HRMS products compute the arrears and stop. The employee then
// pays tax at their new marginal rate on money they earned at an older, lower
// one — often several thousand rupees — and only finds out if their accountant
// happens to file Form 10E for them.
//
// ─── How the relief works ───
//
// Twice, and then subtract:
//
//   1. Tax on this year **with** the arrears, less tax on this year **without**.
//      That is the extra tax the arrears caused now.
//   2. For each earlier year, tax **with** that year's share of the arrears,
//      less tax **without**. That is the tax that would have been paid had the
//      money arrived on time.
//
// Relief is (1) − (2), and only when it is positive. If the employee's income
// was higher in the earlier year the arrears are better taxed now, and no
// relief arises — returning a negative would reduce their tax, which is not
// what the section does.

import {
  calculateIncomeTax,
  NEW_REGIME_SLABS_FY2526,
  OLD_REGIME_SLABS,
  SURCHARGE_NEW,
  type Minor,
} from "./statutory-india";
import { STANDARD_DEDUCTION, type Regime } from "./income-tax-declaration";

export interface SalaryRevision {
  /** First month the new salary applies, 1-12, with its year. */
  effectiveMonth: number;
  effectiveYear: number;
  /** The month payroll first paid at the new rate. */
  paidFromMonth: number;
  paidFromYear: number;
  oldMonthlyGrossMinor: Minor;
  newMonthlyGrossMinor: Minor;
}

export interface ArrearMonth {
  month: number;
  year: number;
  oldMinor: Minor;
  newMinor: Minor;
  differenceMinor: Minor;
}

export interface ArrearsResult {
  months: ArrearMonth[];
  totalMinor: Minor;
  /** Financial year each month belongs to, and how much fell in it. */
  byFinancialYear: { financialYear: number; amountMinor: Minor }[];
}

/** The Indian financial year a calendar month belongs to. */
export function financialYearOf(month: number, year: number): number {
  return month >= 4 ? year : year - 1;
}

/**
 * The months a backdated revision left underpaid.
 *
 * Runs from the effective date up to, but not including, the month payroll
 * started paying the new rate. A revision paid from the month it takes effect
 * produces no arrears, which is the case worth getting right — returning a
 * single spurious month here would pay somebody twice.
 */
export function arrearsFor(revision: SalaryRevision): ArrearsResult {
  const months: ArrearMonth[] = [];
  const difference = revision.newMonthlyGrossMinor - revision.oldMonthlyGrossMinor;

  let month = revision.effectiveMonth;
  let year = revision.effectiveYear;

  // Bounded rather than while(true): a malformed revision where the paid-from
  // date precedes the effective date would otherwise loop for ever.
  for (let guard = 0; guard < 120; guard++) {
    if (year > revision.paidFromYear) break;
    if (year === revision.paidFromYear && month >= revision.paidFromMonth) break;

    months.push({
      month,
      year,
      oldMinor: revision.oldMonthlyGrossMinor,
      newMinor: revision.newMonthlyGrossMinor,
      differenceMinor: difference,
    });

    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  const totalMinor = months.reduce((a, m) => a + m.differenceMinor, 0n);

  const grouped = new Map<number, Minor>();
  for (const m of months) {
    const fy = financialYearOf(m.month, m.year);
    grouped.set(fy, (grouped.get(fy) ?? 0n) + m.differenceMinor);
  }

  return {
    months,
    totalMinor,
    byFinancialYear: [...grouped.entries()]
      .map(([financialYear, amountMinor]) => ({ financialYear, amountMinor }))
      .sort((a, b) => a.financialYear - b.financialYear),
  };
}

function taxOn(taxableMinor: Minor, regime: Regime): Minor {
  const clamped = taxableMinor > 0n ? taxableMinor : 0n;
  return calculateIncomeTax(clamped, {
    slabs: regime === "new" ? NEW_REGIME_SLABS_FY2526 : OLD_REGIME_SLABS,
    rebateThresholdMinor: regime === "new" ? 12_00_000_00n : 5_00_000_00n,
    rebateCapMinor: regime === "new" ? 60_000_00n : 12_500_00n,
    surchargeBands: SURCHARGE_NEW,
  }).totalTaxMinor;
}

export interface EarlierYear {
  financialYear: number;
  /** Taxable income as originally assessed, before this arrear. */
  taxableIncomeMinor: Minor;
  /** Arrears attributable to that year. */
  arrearMinor: Minor;
  regime: Regime;
}

export interface Section89Result {
  taxThisYearWithArrearsMinor: Minor;
  taxThisYearWithoutArrearsMinor: Minor;
  extraTaxThisYearMinor: Minor;
  taxInEarlierYearsWithArrearsMinor: Minor;
  taxInEarlierYearsWithoutArrearsMinor: Minor;
  extraTaxInEarlierYearsMinor: Minor;
  reliefMinor: Minor;
  /** Form 10E must be filed before the relief may be claimed. */
  requiresForm10E: boolean;
  note: string;
}

/**
 * Relief under section 89(1), as Form 10E computes it.
 *
 * `currentTaxableIncomeMinor` must already include the arrears, because that is
 * what the employee's income for the year actually is; the function removes
 * them to get the comparison figure rather than asking for it twice and
 * risking the two disagreeing.
 */
export function section89Relief(input: {
  currentFinancialYear: number;
  currentTaxableIncomeMinor: Minor;
  currentRegime: Regime;
  earlierYears: readonly EarlierYear[];
}): Section89Result {
  const totalArrears = input.earlierYears.reduce((a, y) => a + y.arrearMinor, 0n);

  const withArrears = taxOn(input.currentTaxableIncomeMinor, input.currentRegime);
  const withoutArrears = taxOn(
    input.currentTaxableIncomeMinor - totalArrears,
    input.currentRegime
  );
  const extraNow = withArrears - withoutArrears;

  let earlierWith = 0n;
  let earlierWithout = 0n;
  for (const year of input.earlierYears) {
    earlierWithout += taxOn(year.taxableIncomeMinor, year.regime);
    earlierWith += taxOn(year.taxableIncomeMinor + year.arrearMinor, year.regime);
  }
  const extraThen = earlierWith - earlierWithout;

  const raw = extraNow - extraThen;
  const reliefMinor = raw > 0n ? raw : 0n;

  return {
    taxThisYearWithArrearsMinor: withArrears,
    taxThisYearWithoutArrearsMinor: withoutArrears,
    extraTaxThisYearMinor: extraNow,
    taxInEarlierYearsWithArrearsMinor: earlierWith,
    taxInEarlierYearsWithoutArrearsMinor: earlierWithout,
    extraTaxInEarlierYearsMinor: extraThen,
    reliefMinor,
    requiresForm10E: reliefMinor > 0n,
    note:
      reliefMinor > 0n
        ? "Form 10E must be filed before this relief is claimed; the department " +
          "disallows section 89 relief where it has not been."
        : "No relief arises: the arrears attract no more tax now than they would " +
          "have in the years they relate to.",
  };
}

/**
 * The standard deduction is not given twice.
 *
 * A recomputation of an earlier year for section 89 uses that year's taxable
 * income as already assessed — the deduction was taken then. Adding it again
 * here is the most common way a relief figure comes out too large, so the
 * helper that would tempt somebody into it says what it is for.
 */
export function taxableIncomeForEarlierYear(
  grossMinor: Minor,
  regime: Regime,
  deductionsMinor: Minor = 0n
): Minor {
  const relief = STANDARD_DEDUCTION[regime] + deductionsMinor;
  const taxable = grossMinor - relief;
  return taxable > 0n ? taxable : 0n;
}
