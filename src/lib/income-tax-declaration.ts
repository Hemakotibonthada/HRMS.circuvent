// ═══════════════════════════════════════════════════════════════
// INCOME TAX DECLARATIONS — Chapter VI-A deductions and regime choice
// ═══════════════════════════════════════════════════════════════
//
// What an employee declares at the start of a financial year so that TDS is
// deducted against their actual savings rather than their gross pay, and what
// payroll is allowed to believe before the proof arrives.
//
// This module decides **how much of a declaration counts**. It does not
// compute tax: the slabs, rebate, surcharge and cess live in
// `statutory-india.ts` and are called from here. There were three
// implementations of the Indian slabs in this codebase — payroll's old regime,
// the tax page's own inline copy, and the real one — and three copies of a
// slab table is three different answers to "what is my tax", of which at most
// one is right.
//
// Two ideas do the work:
//
//   * A **declaration** is a claim. It is what the employee says they will
//     invest, and payroll may act on it from April.
//   * A **proof** is evidence. Until it is verified, a declared amount is
//     provisional, and if the window closes without it the deduction is
//     withdrawn and the tax recomputed for the rest of the year.
//
// Conflating the two is the classic Indian payroll failure: an employee
// declares ₹1,50,000 of 80C in April, never submits proof, and discovers in
// February that eleven months of under-deducted tax is coming out of one
// payslip.
//
// ─── On the figures ───
//
// The caps below are statutory and change with each Finance Act. They are
// written as data, dated, and never inferred: a limit that is quietly wrong
// deducts the wrong tax from a real person's salary every month until somebody
// files a return and finds out.

import {
  calculateIncomeTax,
  NEW_REGIME_SLABS_FY2526,
  OLD_REGIME_SLABS,
  SURCHARGE_NEW,
  type Minor,
  type TaxResult,
} from "./statutory-india";

/** The two regimes a salaried employee may choose between. */
export type Regime = "old" | "new";

/** Where a declaration is in its life. */
export type DeclarationStatus =
  | "draft"
  | "submitted"
  | "proof_pending"
  | "verified"
  | "rejected"
  | "locked";

/** Where one piece of evidence is in its life. */
export type ProofStatus = "not_required" | "awaiting" | "submitted" | "accepted" | "rejected";

export interface DeductionSection {
  /** The section as an employee and an auditor both know it. */
  code: string;
  label: string;
  /**
   * Statutory ceiling in minor units, or null where the section has none.
   *
   * Null is not "unlimited in practice" — 80E is uncapped in amount but only
   * runs for eight assessment years — it means this module does not cap it and
   * the proof stage decides.
   */
  capMinor: Minor | null;
  /**
   * Sections that share one ceiling with this one.
   *
   * 80C, 80CCC and 80CCD(1) are three sections and a single ₹1,50,000. Capping
   * them separately is how an employee ends up claiming ₹4,50,000 of it.
   */
  sharedCapGroup?: string;
  /** Whether the new regime permits it. Almost nothing does. */
  allowedInNewRegime: boolean;
  /** Whether payroll must see evidence before the year closes. */
  requiresProof: boolean;
  note: string;
}

/**
 * Chapter VI-A deductions, FY 2025-26 (AY 2026-27).
 *
 * The new-regime column is the important one and it is nearly all `false`.
 * Under section 115BAC a salaried employee keeps the standard deduction and
 * the employer's NPS contribution under 80CCD(2), and gives up the rest. An
 * HRMS that lets someone declare ₹1,50,000 of 80C against the new regime and
 * shows them the tax saving is lying to them in a way they will not discover
 * until they file.
 */
export const DEDUCTION_SECTIONS: readonly DeductionSection[] = [
  {
    code: "80C",
    label: "Life insurance, PPF, ELSS, EPF, tuition fees, home loan principal",
    capMinor: 1_50_000_00n,
    sharedCapGroup: "80C_GROUP",
    allowedInNewRegime: false,
    requiresProof: true,
    note: "Shares one ₹1,50,000 ceiling with 80CCC and 80CCD(1).",
  },
  {
    code: "80CCC",
    label: "Pension fund premium",
    capMinor: 1_50_000_00n,
    sharedCapGroup: "80C_GROUP",
    allowedInNewRegime: false,
    requiresProof: true,
    note: "Inside the 80C ceiling, not additional to it.",
  },
  {
    code: "80CCD(1)",
    label: "NPS — employee's own contribution",
    capMinor: 1_50_000_00n,
    sharedCapGroup: "80C_GROUP",
    allowedInNewRegime: false,
    requiresProof: true,
    note: "Inside the 80C ceiling. The extra ₹50,000 is 80CCD(1B).",
  },
  {
    code: "80CCD(1B)",
    label: "NPS — additional contribution",
    capMinor: 50_000_00n,
    allowedInNewRegime: false,
    requiresProof: true,
    note: "Over and above the 80C ceiling, not inside it.",
  },
  {
    code: "80CCD(2)",
    label: "NPS — employer's contribution",
    capMinor: null,
    allowedInNewRegime: true,
    requiresProof: false,
    note:
      "Capped as a proportion of salary rather than a figure, and one of the " +
      "very few deductions the new regime keeps. No proof: the employer is the " +
      "one paying it.",
  },
  {
    code: "80D",
    label: "Health insurance premium",
    capMinor: 1_00_000_00n,
    allowedInNewRegime: false,
    requiresProof: true,
    note:
      "₹25,000 for self and family, ₹25,000 more for parents, each rising to " +
      "₹50,000 where the insured is a senior citizen. The ₹1,00,000 here is " +
      "the ceiling of both at their highest; `capFor80D` computes the real one.",
  },
  {
    code: "80DD",
    label: "Maintenance of a dependant with disability",
    capMinor: 1_25_000_00n,
    allowedInNewRegime: false,
    requiresProof: true,
    note: "₹75,000, or ₹1,25,000 where the disability is severe.",
  },
  {
    code: "80DDB",
    label: "Treatment of specified illness",
    capMinor: 1_00_000_00n,
    allowedInNewRegime: false,
    requiresProof: true,
    note: "₹40,000, or ₹1,00,000 for a senior citizen.",
  },
  {
    code: "80E",
    label: "Interest on an education loan",
    capMinor: null,
    allowedInNewRegime: false,
    requiresProof: true,
    note: "No ceiling on the amount, but only for eight assessment years.",
  },
  {
    code: "80EEB",
    label: "Interest on an electric vehicle loan",
    capMinor: 1_50_000_00n,
    allowedInNewRegime: false,
    requiresProof: true,
    note: "Loan must have been sanctioned within the qualifying window.",
  },
  {
    code: "80G",
    label: "Donations",
    capMinor: null,
    allowedInNewRegime: false,
    requiresProof: true,
    note:
      "Some donations qualify at 100% and some at 50%, and some are subject to " +
      "a further ceiling of 10% of adjusted gross total income. The eligible " +
      "figure is entered here; this module does not apply the ratio.",
  },
  {
    code: "80TTA",
    label: "Interest on a savings account",
    capMinor: 10_000_00n,
    allowedInNewRegime: false,
    requiresProof: false,
    note: "Not available alongside 80TTB — a senior citizen claims one or the other.",
  },
  {
    code: "80TTB",
    label: "Interest income of a senior citizen",
    capMinor: 50_000_00n,
    allowedInNewRegime: false,
    requiresProof: false,
    note: "Senior citizens only, and replaces 80TTA rather than adding to it.",
  },
  {
    code: "80U",
    label: "Employee with a disability",
    capMinor: 1_25_000_00n,
    allowedInNewRegime: false,
    requiresProof: true,
    note: "₹75,000, or ₹1,25,000 where the disability is severe.",
  },
  {
    code: "24B",
    label: "Interest on a home loan (self-occupied)",
    capMinor: 2_00_000_00n,
    allowedInNewRegime: false,
    requiresProof: true,
    note:
      "Section 24(b) rather than Chapter VI-A, but it is declared in the same " +
      "form and an employee does not care about the distinction.",
  },
] as const;

/** Standard deduction, which both regimes allow and which differ. */
export const STANDARD_DEDUCTION: Record<Regime, Minor> = {
  old: 50_000_00n,
  new: 75_000_00n,
};

/** Mutually exclusive pairs — claiming both is an error, not a sum. */
const EXCLUSIVE_PAIRS: readonly (readonly [string, string])[] = [["80TTA", "80TTB"]];

export interface DeclarationItem {
  section: string;
  declaredMinor: Minor;
  /** Evidence state. Only `accepted` survives the proof deadline. */
  proofStatus?: ProofStatus;
}

export interface DeclarationContext {
  regime: Regime;
  /** True once the proof window has shut and unproven claims fall away. */
  proofWindowClosed?: boolean;
  /** Raises the 80D ceiling. */
  selfOrFamilyIsSenior?: boolean;
  parentsAreSenior?: boolean;
}

export function sectionFor(code: string): DeductionSection | undefined {
  return DEDUCTION_SECTIONS.find((s) => s.code === code);
}

/**
 * The 80D ceiling for one person's circumstances.
 *
 * A single figure cannot express it: the section is two allowances side by
 * side, each of which rises with the age of whoever is insured.
 */
export function capFor80D(ctx: Pick<DeclarationContext, "selfOrFamilyIsSenior" | "parentsAreSenior">): Minor {
  const self = ctx.selfOrFamilyIsSenior ? 50_000_00n : 25_000_00n;
  const parents = ctx.parentsAreSenior ? 50_000_00n : 25_000_00n;
  return self + parents;
}

export interface AllowedDeduction {
  section: string;
  declaredMinor: Minor;
  allowedMinor: Minor;
  /** Why the allowed figure is below the declared one, when it is. */
  reason?: "not_allowed_in_new_regime" | "over_section_cap" | "over_shared_cap" | "proof_missing" | "excluded_by_other_section";
}

export interface DeductionSummary {
  items: AllowedDeduction[];
  totalAllowedMinor: Minor;
  standardDeductionMinor: Minor;
  /** Everything that reduces taxable income, standard deduction included. */
  totalReliefMinor: Minor;
}

/**
 * Works out how much of what was declared actually counts.
 *
 * Order matters and is deliberate: regime first, because under the new regime
 * almost nothing survives and the rest of the arithmetic is moot; then the
 * per-section ceiling; then the group ceiling, which can only be applied once
 * the individual ones have been; then proof, last, because a claim that was
 * never allowable should not be reported as "missing evidence" — that sends an
 * employee hunting for a receipt that would not have helped.
 */
export function allowedDeductions(
  items: readonly DeclarationItem[],
  ctx: DeclarationContext
): DeductionSummary {
  const out: AllowedDeduction[] = [];

  const claimed = new Set(items.filter((i) => i.declaredMinor > 0n).map((i) => i.section));
  const excluded = new Set<string>();
  for (const [a, b] of EXCLUSIVE_PAIRS) {
    // Keep the larger claim and drop the other, rather than refusing both and
    // leaving the employee with neither.
    if (claimed.has(a) && claimed.has(b)) {
      const amountA = items.find((i) => i.section === a)?.declaredMinor ?? 0n;
      const amountB = items.find((i) => i.section === b)?.declaredMinor ?? 0n;
      excluded.add(amountA >= amountB ? b : a);
    }
  }

  const groupUsed = new Map<string, Minor>();

  for (const item of items) {
    const section = sectionFor(item.section);
    const declared = item.declaredMinor > 0n ? item.declaredMinor : 0n;

    if (!section) {
      out.push({ section: item.section, declaredMinor: declared, allowedMinor: 0n });
      continue;
    }

    if (ctx.regime === "new" && !section.allowedInNewRegime) {
      out.push({
        section: item.section,
        declaredMinor: declared,
        allowedMinor: 0n,
        reason: "not_allowed_in_new_regime",
      });
      continue;
    }

    if (excluded.has(item.section)) {
      out.push({
        section: item.section,
        declaredMinor: declared,
        allowedMinor: 0n,
        reason: "excluded_by_other_section",
      });
      continue;
    }

    const cap = item.section === "80D" ? capFor80D(ctx) : section.capMinor;
    let allowed = cap === null ? declared : declared > cap ? cap : declared;
    let reason: AllowedDeduction["reason"] | undefined =
      cap !== null && declared > cap ? "over_section_cap" : undefined;

    if (section.sharedCapGroup && section.capMinor !== null) {
      const used = groupUsed.get(section.sharedCapGroup) ?? 0n;
      const headroom = section.capMinor - used;
      const capped = headroom <= 0n ? 0n : allowed > headroom ? headroom : allowed;
      if (capped < allowed) reason = "over_shared_cap";
      allowed = capped;
      groupUsed.set(section.sharedCapGroup, used + allowed);
    }

    if (ctx.proofWindowClosed && section.requiresProof && item.proofStatus !== "accepted") {
      allowed = 0n;
      reason = "proof_missing";
    }

    out.push({ section: item.section, declaredMinor: declared, allowedMinor: allowed, reason });
  }

  const totalAllowedMinor = out.reduce((sum, i) => sum + i.allowedMinor, 0n);
  const standardDeductionMinor = STANDARD_DEDUCTION[ctx.regime];

  return {
    items: out,
    totalAllowedMinor,
    standardDeductionMinor,
    totalReliefMinor: totalAllowedMinor + standardDeductionMinor,
  };
}

/**
 * House Rent Allowance exemption under section 10(13A).
 *
 * An exemption, not a deduction — it comes off salary before Chapter VI-A
 * rather than after — and the least of three figures, which is why employees
 * consistently over-estimate it. Unavailable under the new regime.
 *
 * `metroCity` moves the third limb from 40% to 50%; for this purpose the
 * metros are Delhi, Mumbai, Kolkata and Chennai, and nowhere else, however
 * large.
 */
export function hraExemption(input: {
  regime: Regime;
  basicPlusDaMinor: Minor;
  hraReceivedMinor: Minor;
  rentPaidMinor: Minor;
  metroCity: boolean;
}): Minor {
  if (input.regime === "new") return 0n;

  const tenPercentOfBasic = input.basicPlusDaMinor / 10n;
  const rentOverTenPercent = input.rentPaidMinor - tenPercentOfBasic;
  const cityLimit = input.metroCity
    ? input.basicPlusDaMinor / 2n
    : (input.basicPlusDaMinor * 2n) / 5n;

  const candidates = [input.hraReceivedMinor, rentOverTenPercent, cityLimit];
  const least = candidates.reduce((a, b) => (b < a ? b : a));
  return least > 0n ? least : 0n;
}

export interface RegimeOutcome {
  regime: Regime;
  grossIncomeMinor: Minor;
  exemptionsMinor: Minor;
  deductionsMinor: Minor;
  taxableIncomeMinor: Minor;
  tax: TaxResult;
}

export interface RegimeComparison {
  old: RegimeOutcome;
  new: RegimeOutcome;
  /** The cheaper one. Ties go to the new regime, which is the statutory default. */
  better: Regime;
  savingMinor: Minor;
}

function outcomeFor(
  regime: Regime,
  input: {
    grossIncomeMinor: Minor;
    items: readonly DeclarationItem[];
    hra?: Omit<Parameters<typeof hraExemption>[0], "regime">;
    ctx?: Omit<DeclarationContext, "regime">;
  }
): RegimeOutcome {
  const summary = allowedDeductions(input.items, { ...input.ctx, regime });
  const exemptions = input.hra ? hraExemption({ ...input.hra, regime }) : 0n;

  const taxableRaw = input.grossIncomeMinor - exemptions - summary.totalReliefMinor;
  const taxableIncomeMinor = taxableRaw > 0n ? taxableRaw : 0n;

  const tax = calculateIncomeTax(taxableIncomeMinor, {
    slabs: regime === "new" ? NEW_REGIME_SLABS_FY2526 : OLD_REGIME_SLABS,
    // Section 87A. Under the new regime the Finance Act 2025 rebate runs to
    // ₹12,00,000; the old regime's has stood at ₹5,00,000 for years.
    rebateThresholdMinor: regime === "new" ? 12_00_000_00n : 5_00_000_00n,
    rebateCapMinor: regime === "new" ? 60_000_00n : 12_500_00n,
    surchargeBands: SURCHARGE_NEW,
  });

  return {
    regime,
    grossIncomeMinor: input.grossIncomeMinor,
    exemptionsMinor: exemptions,
    deductionsMinor: summary.totalReliefMinor,
    taxableIncomeMinor,
    tax,
  };
}

/**
 * Runs the year both ways so the employee can choose with a number in front of
 * them.
 *
 * This is the screen that matters: the regime is a once-a-year, hard-to-undo
 * decision, and "the new one has lower rates" is not enough to make it on. The
 * same declared investments are put through both sets of rules — under the new
 * regime nearly all of them simply stop counting, which is exactly the point
 * being illustrated.
 */
export function compareRegimes(input: {
  grossIncomeMinor: Minor;
  items: readonly DeclarationItem[];
  hra?: Omit<Parameters<typeof hraExemption>[0], "regime">;
  ctx?: Omit<DeclarationContext, "regime">;
}): RegimeComparison {
  const oldOutcome = outcomeFor("old", input);
  const newOutcome = outcomeFor("new", input);

  const oldTax = oldOutcome.tax.totalTaxMinor;
  const newTax = newOutcome.tax.totalTaxMinor;

  const better: Regime = newTax <= oldTax ? "new" : "old";
  const saving = better === "new" ? oldTax - newTax : newTax - oldTax;

  return { old: oldOutcome, new: newOutcome, better, savingMinor: saving };
}

export interface DeclarationProblem {
  section?: string;
  message: string;
}

/**
 * What is wrong with a declaration, in words an employee can act on.
 *
 * Returned as a list rather than thrown one at a time, so somebody filling in
 * eight sections is told everything at once instead of discovering the next
 * problem after each save.
 */
export function validateDeclaration(
  items: readonly DeclarationItem[],
  ctx: DeclarationContext
): DeclarationProblem[] {
  const problems: DeclarationProblem[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const section = sectionFor(item.section);

    if (!section) {
      problems.push({ section: item.section, message: `${item.section} is not a section this form knows.` });
      continue;
    }

    if (seen.has(item.section)) {
      problems.push({ section: item.section, message: `${item.section} is claimed more than once.` });
    }
    seen.add(item.section);

    if (item.declaredMinor < 0n) {
      problems.push({ section: item.section, message: `${item.section} cannot be a negative amount.` });
    }

    const cap = item.section === "80D" ? capFor80D(ctx) : section.capMinor;
    if (cap !== null && item.declaredMinor > cap) {
      problems.push({
        section: item.section,
        message: `${item.section} is limited to ${formatRupees(cap)}; ${formatRupees(item.declaredMinor)} was declared.`,
      });
    }

    if (ctx.regime === "new" && !section.allowedInNewRegime && item.declaredMinor > 0n) {
      problems.push({
        section: item.section,
        message: `${item.section} does not reduce tax under the new regime.`,
      });
    }
  }

  const claimed = new Set(items.filter((i) => i.declaredMinor > 0n).map((i) => i.section));
  for (const [a, b] of EXCLUSIVE_PAIRS) {
    if (claimed.has(a) && claimed.has(b)) {
      problems.push({ message: `${a} and ${b} cannot both be claimed; only the larger will be counted.` });
    }
  }

  const groupTotals = new Map<string, Minor>();
  for (const item of items) {
    const section = sectionFor(item.section);
    if (!section?.sharedCapGroup || section.capMinor === null) continue;
    groupTotals.set(
      section.sharedCapGroup,
      (groupTotals.get(section.sharedCapGroup) ?? 0n) + (item.declaredMinor > 0n ? item.declaredMinor : 0n)
    );
  }
  for (const [group, total] of groupTotals) {
    const cap = DEDUCTION_SECTIONS.find((s) => s.sharedCapGroup === group)?.capMinor;
    if (cap != null && total > cap) {
      const members = DEDUCTION_SECTIONS.filter((s) => s.sharedCapGroup === group).map((s) => s.code);
      problems.push({
        message: `${members.join(", ")} share one limit of ${formatRupees(cap)}; ${formatRupees(total)} was declared across them.`,
      });
    }
  }

  return problems;
}

/** Indian digit grouping, because ₹1,50,000 is not ₹150,000 to the reader. */
export function formatRupees(minor: Minor): string {
  const rupees = minor / 100n;
  const s = rupees.toString();
  if (s.length <= 3) return `₹${s}`;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return `₹${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}

/** Sections an employee may still be asked for evidence on. */
export function outstandingProofs(items: readonly DeclarationItem[]): string[] {
  return items
    .filter((i) => i.declaredMinor > 0n)
    .filter((i) => sectionFor(i.section)?.requiresProof)
    .filter((i) => i.proofStatus !== "accepted")
    .map((i) => i.section);
}
