// ═══════════════════════════════════════════════════════════════
// FORM 16 — the annual TDS certificate, Part B
// ═══════════════════════════════════════════════════════════════
//
// What an employer must hand every employee it deducted tax from, and what
// that employee files their return with. It is a legal document under Rule
// 31(1)(a) of the Income Tax Rules, not a summary screen, so it is built to
// the shape of the statutory annexure rather than to whatever was convenient.
//
// The two parts differ in origin and only one of them is ours:
//
//   * **Part A** — TAN, PAN, quarterly tax deposited, challan references — is
//     downloaded from TRACES after the quarterly returns are filed. An
//     employer generating its own Part A is producing a document the
//     department has not seen; this module prepares the figures that go *into*
//     the return, and does not pretend to issue Part A.
//   * **Part B** — the salary annexure — is the employer's own, and is what
//     this builds.
//
// ─── The thing that actually goes wrong ───
//
// A Form 16 that does not reconcile to the payslips. Twelve months of TDS were
// deducted, the annexure recomputes the year's liability from scratch, and the
// two disagree — usually because a mid-year salary revision, a declaration
// that arrived in November, or a proof that was never produced moved the
// liability after the deductions had already been made. The gap is real and
// the employee owes or is owed it, so it is reported as a line rather than
// quietly absorbed. `reconcile` is the function that matters here.
//
// ─── Two classifications people get wrong ───
//
//   * **Professional tax is a section 16(iii) deduction**, not a Chapter VI-A
//     one. Putting it with 80C overstates Chapter VI-A and understates the
//     deduction from salary — the total lands in the same place, so it is
//     never noticed until an assessing officer reads it.
//   * **HRA is an exemption under section 10(13A)**, taken off before the
//     income from salary is arrived at. It is not a deduction and does not
//     belong in Chapter VI-A either.
//
// Under the new regime neither professional tax nor HRA survives; only the
// standard deduction and the employer's NPS contribution do.

import {
  calculateIncomeTax,
  NEW_REGIME_SLABS_FY2526,
  OLD_REGIME_SLABS,
  SURCHARGE_NEW,
  type Minor,
} from "./statutory-india";
import {
  STANDARD_DEDUCTION,
  allowedDeductions,
  hraExemption,
  type DeclarationItem,
  type Regime,
} from "./income-tax-declaration";

/** One month of an employee's pay, as payroll recorded it. */
export interface PayrollMonth {
  /** Calendar month, 1-12. */
  month: number;
  year: number;
  basicMinor: Minor;
  hraMinor: Minor;
  conveyanceMinor: Minor;
  medicalMinor: Minor;
  ltaMinor: Minor;
  specialAllowanceMinor: Minor;
  otherEarningsMinor: Minor;
  overtimeMinor: Minor;
  bonusMinor: Minor;
  arrearsMinor: Minor;
  grossMinor: Minor;
  professionalTaxMinor: Minor;
  /** Tax actually deducted and paid over in that month. */
  incomeTaxMinor: Minor;
}

export interface Form16Input {
  financialYear: number;
  regime: Regime;
  months: readonly PayrollMonth[];
  declarations: readonly DeclarationItem[];
  /** Set once the proof window has shut; unproven claims then stop counting. */
  proofWindowClosed?: boolean;
  selfOrFamilyIsSenior?: boolean;
  parentsAreSenior?: boolean;
  /** HRA inputs. Rent is the year's total. */
  rentPaidMinor?: Minor;
  metroCity?: boolean;
  /** Perquisites under 17(2) and profits in lieu under 17(3), if any. */
  perquisitesMinor?: Minor;
  profitsInLieuMinor?: Minor;
  /** Other income the employee reported to the employer, e.g. bank interest. */
  otherIncomeMinor?: Minor;
  /** Relief under section 89 for arrears spanning earlier years. */
  reliefUnder89Minor?: Minor;
}

/** A Chapter VI-A line, showing both what was claimed and what was allowed. */
export interface ChapterVIALine {
  section: string;
  grossAmountMinor: Minor;
  deductibleAmountMinor: Minor;
}

/**
 * Part B, in the order and with the numbering of the statutory annexure.
 *
 * The field names carry their section references because that is how the form
 * is read and audited; renaming them to something friendlier would make this
 * easier to use and impossible to check.
 */
export interface Form16PartB {
  financialYear: number;
  /** The assessment year, which is always the one after. */
  assessmentYear: string;
  regime: Regime;

  // 1 — Gross salary
  salaryUnder17_1Minor: Minor;
  perquisitesUnder17_2Minor: Minor;
  profitsInLieuUnder17_3Minor: Minor;
  grossSalaryMinor: Minor;

  // 2 — Allowances exempt under section 10
  hraExemptUnder10_13AMinor: Minor;
  totalExemptAllowancesMinor: Minor;

  // 3
  netSalaryMinor: Minor;

  // 4 and 5 — Deductions under section 16
  standardDeductionUnder16_iaMinor: Minor;
  professionalTaxUnder16_iiiMinor: Minor;
  totalSection16DeductionsMinor: Minor;

  // 6, 7, 8
  incomeChargeableUnderSalariesMinor: Minor;
  otherIncomeMinor: Minor;
  grossTotalIncomeMinor: Minor;

  // 9 and 10 — Chapter VI-A
  chapterVIA: ChapterVIALine[];
  aggregateDeductibleMinor: Minor;

  // 11
  totalTaxableIncomeMinor: Minor;

  // 12 to 16
  taxOnTotalIncomeMinor: Minor;
  rebateUnder87AMinor: Minor;
  surchargeMinor: Minor;
  cessMinor: Minor;
  taxPayableMinor: Minor;

  // 17, 18
  reliefUnder89Minor: Minor;
  netTaxPayableMinor: Minor;

  // 19, 20
  taxDeductedAtSourceMinor: Minor;
  balancePayableMinor: Minor;
  refundDueMinor: Minor;
}

const sum = (values: readonly Minor[]): Minor => values.reduce((a, b) => a + b, 0n);
const atLeastZero = (v: Minor): Minor => (v > 0n ? v : 0n);

/**
 * Salary under section 17(1).
 *
 * Everything paid as salary, including arrears and bonus. HRA is included here
 * and taken out again at step 2 as an exemption — netting it off early would
 * produce the right total and the wrong form, and the form is the point.
 */
function salaryUnder17_1(months: readonly PayrollMonth[]): Minor {
  return sum(
    months.map(
      (m) =>
        m.basicMinor +
        m.hraMinor +
        m.conveyanceMinor +
        m.medicalMinor +
        m.ltaMinor +
        m.specialAllowanceMinor +
        m.otherEarningsMinor +
        m.overtimeMinor +
        m.bonusMinor +
        m.arrearsMinor
    )
  );
}

/**
 * Builds Part B for one employee's year.
 *
 * Every figure is derived from the months supplied; nothing is estimated or
 * annualised. A part-year employee gets a Part B for the part of the year they
 * were paid for, which is correct — annualising it would inflate their income
 * and their tax.
 */
export function buildForm16PartB(input: Form16Input): Form16PartB {
  const { regime, months } = input;

  const salary17_1 = salaryUnder17_1(months);
  const perquisites = input.perquisitesMinor ?? 0n;
  const profitsInLieu = input.profitsInLieuMinor ?? 0n;
  const grossSalary = salary17_1 + perquisites + profitsInLieu;

  const basicPlusDa = sum(months.map((m) => m.basicMinor));
  const hraReceived = sum(months.map((m) => m.hraMinor));

  const hraExempt =
    input.rentPaidMinor && input.rentPaidMinor > 0n
      ? hraExemption({
          regime,
          basicPlusDaMinor: basicPlusDa,
          hraReceivedMinor: hraReceived,
          rentPaidMinor: input.rentPaidMinor,
          metroCity: input.metroCity ?? false,
        })
      : 0n;

  const totalExempt = hraExempt;
  const netSalary = atLeastZero(grossSalary - totalExempt);

  const standardDeduction = STANDARD_DEDUCTION[regime];
  // Professional tax is deductible under the old regime only. Deducting it
  // under the new one understates tax by a few thousand rupees a head, which
  // is small enough to survive review and large enough to matter at scale.
  const professionalTax =
    regime === "old" ? sum(months.map((m) => m.professionalTaxMinor)) : 0n;
  const section16Total = standardDeduction + professionalTax;

  const incomeChargeable = atLeastZero(netSalary - section16Total);
  const otherIncome = input.otherIncomeMinor ?? 0n;
  const grossTotalIncome = incomeChargeable + otherIncome;

  const summary = allowedDeductions(input.declarations, {
    regime,
    proofWindowClosed: input.proofWindowClosed,
    selfOrFamilyIsSenior: input.selfOrFamilyIsSenior,
    parentsAreSenior: input.parentsAreSenior,
  });

  const chapterVIA: ChapterVIALine[] = summary.items
    .filter((i) => i.declaredMinor > 0n)
    .map((i) => ({
      section: i.section,
      grossAmountMinor: i.declaredMinor,
      deductibleAmountMinor: i.allowedMinor,
    }));

  const aggregateDeductible = summary.totalAllowedMinor;
  const totalTaxableIncome = atLeastZero(grossTotalIncome - aggregateDeductible);

  const tax = calculateIncomeTax(totalTaxableIncome, {
    slabs: regime === "new" ? NEW_REGIME_SLABS_FY2526 : OLD_REGIME_SLABS,
    rebateThresholdMinor: regime === "new" ? 12_00_000_00n : 5_00_000_00n,
    rebateCapMinor: regime === "new" ? 60_000_00n : 12_500_00n,
    surchargeBands: SURCHARGE_NEW,
  });

  const reliefUnder89 = input.reliefUnder89Minor ?? 0n;
  const netTaxPayable = atLeastZero(tax.totalTaxMinor - reliefUnder89);
  const tds = sum(months.map((m) => m.incomeTaxMinor));

  const difference = netTaxPayable - tds;

  return {
    financialYear: input.financialYear,
    assessmentYear: `${input.financialYear + 1}-${String((input.financialYear + 2) % 100).padStart(2, "0")}`,
    regime,

    salaryUnder17_1Minor: salary17_1,
    perquisitesUnder17_2Minor: perquisites,
    profitsInLieuUnder17_3Minor: profitsInLieu,
    grossSalaryMinor: grossSalary,

    hraExemptUnder10_13AMinor: hraExempt,
    totalExemptAllowancesMinor: totalExempt,

    netSalaryMinor: netSalary,

    standardDeductionUnder16_iaMinor: standardDeduction,
    professionalTaxUnder16_iiiMinor: professionalTax,
    totalSection16DeductionsMinor: section16Total,

    incomeChargeableUnderSalariesMinor: incomeChargeable,
    otherIncomeMinor: otherIncome,
    grossTotalIncomeMinor: grossTotalIncome,

    chapterVIA,
    aggregateDeductibleMinor: aggregateDeductible,

    totalTaxableIncomeMinor: totalTaxableIncome,

    taxOnTotalIncomeMinor: tax.slabTaxMinor,
    rebateUnder87AMinor: tax.rebateMinor,
    surchargeMinor: tax.surchargeMinor,
    cessMinor: tax.cessMinor,
    taxPayableMinor: tax.totalTaxMinor,

    reliefUnder89Minor: reliefUnder89,
    netTaxPayableMinor: netTaxPayable,

    taxDeductedAtSourceMinor: tds,
    balancePayableMinor: atLeastZero(difference),
    refundDueMinor: atLeastZero(-difference),
  };
}

export interface Reconciliation {
  netTaxPayableMinor: Minor;
  taxDeductedMinor: Minor;
  /** Positive when too little was deducted, negative when too much. */
  differenceMinor: Minor;
  balanced: boolean;
  message: string;
}

/**
 * Whether the year's deductions match the year's liability.
 *
 * A shortfall is not an error in this module — it is a fact about the year,
 * usually caused by a declaration that arrived late, a proof that never did, or
 * a revision backdated after tax had already been deducted. What matters is
 * that it is stated. A Form 16 issued with an unexplained gap sends the
 * employee to file a return that does not agree with the department's own
 * records, and they find out by demand notice.
 *
 * `tolerance` exists because TDS is deducted in whole rupees each month while
 * the annual computation is exact; a few rupees of rounding across twelve
 * months is not a discrepancy worth alarming anyone about.
 */
export function reconcile(form: Form16PartB, toleranceMinor: Minor = 10_00n): Reconciliation {
  const difference = form.netTaxPayableMinor - form.taxDeductedAtSourceMinor;
  const magnitude = difference < 0n ? -difference : difference;
  const balanced = magnitude <= toleranceMinor;

  let message: string;
  if (balanced) {
    message = "Tax deducted matches the liability for the year.";
  } else if (difference > 0n) {
    message =
      `₹${difference / 100n} more tax is due than was deducted. This is usually a ` +
      `declaration that arrived after deductions had begun, or a proof that was ` +
      `never produced.`;
  } else {
    message =
      `₹${magnitude / 100n} more tax was deducted than is due. The employee claims ` +
      `it as a refund when filing.`;
  }

  return {
    netTaxPayableMinor: form.netTaxPayableMinor,
    taxDeductedMinor: form.taxDeductedAtSourceMinor,
    differenceMinor: difference,
    balanced,
    message,
  };
}

/** One quarter of Form 24Q, which is what the department is actually filed. */
export interface Quarter24Q {
  /** Q1 is April to June, because the year starts in April. */
  quarter: 1 | 2 | 3 | 4;
  months: number[];
  amountPaidMinor: Minor;
  taxDeductedMinor: Minor;
}

/**
 * The Indian financial quarter a calendar month falls in.
 *
 * April is Q1. Using calendar quarters here puts January to March in the wrong
 * return and the wrong year, which the department notices before you do.
 */
export function financialQuarterOf(month: number): 1 | 2 | 3 | 4 {
  if (month >= 4 && month <= 6) return 1;
  if (month >= 7 && month <= 9) return 2;
  if (month >= 10 && month <= 12) return 3;
  return 4;
}

/**
 * Groups a year's pay into the four quarterly returns.
 *
 * Form 24Q Annexure I is filed every quarter with what was paid and deducted;
 * Annexure II, the salary detail, goes with the fourth. This produces the
 * Annexure I figures. Quarters with no payroll are returned as zeroes rather
 * than omitted — a missing quarter reads as an unfiled return, and a nil
 * return still has to be filed.
 */
export function quarterly24Q(months: readonly PayrollMonth[]): Quarter24Q[] {
  const quarters: Quarter24Q[] = [1, 2, 3, 4].map((q) => ({
    quarter: q as 1 | 2 | 3 | 4,
    months: [],
    amountPaidMinor: 0n,
    taxDeductedMinor: 0n,
  }));

  for (const m of months) {
    const q = quarters[financialQuarterOf(m.month) - 1];
    q.months.push(m.month);
    q.amountPaidMinor += m.grossMinor;
    q.taxDeductedMinor += m.incomeTaxMinor;
  }

  for (const q of quarters) q.months.sort((a, b) => a - b);
  return quarters;
}
