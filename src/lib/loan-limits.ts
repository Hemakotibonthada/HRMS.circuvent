// ═══════════════════════════════════════════════════════════════
// WHAT SOMEBODY MAY BORROW
// ═══════════════════════════════════════════════════════════════
//
// A limit that only exists in a policy document is not a limit. Until now the
// loan endpoint accepted any positive principal, so an advance of ten years'
// pay was a valid request — approvable by a manager who trusted the form to
// have checked.
//
// ─── The basis is basic pay, not CTC ───
//
// Cost to company includes the employer's own PF contribution, gratuity
// provision and often insurance — money the employee never receives and cannot
// repay from. Lending against it overstates capacity by a third or more.
// Monthly basic is what payroll can actually recover against, and it is the
// figure every Indian salary-advance policy is written in terms of.
//
// It is read from the recorded salary structure and **never estimated**. The
// payroll engine falls back to 40% of CTC when no structure exists, which is a
// reasonable convention for showing somebody an indicative payslip and a bad
// one for deciding how much money they may have: a guess that runs high lends
// somebody more than a month of the pay they will actually be recovered from.
// With no structure this refuses and says so, which HR can fix in a minute.
//
// ─── What is already owed counts ───
//
// A limit applied per loan and not across them is not a limit either: three
// advances of one month's basic each is three months' basic. Outstanding
// balances are subtracted from the headroom.

import type { LoanType } from "./employee-loans";
import type { Minor } from "./statutory-india";

/**
 * Multiples of **monthly basic** each kind of borrowing is capped at.
 *
 * A salary advance is one month, which is the rule this exists to enforce:
 * an advance is pay brought forward, and bringing forward more than a month of
 * it means recovering more than a month's pay from a single month, which
 * leaves somebody with nothing to live on.
 *
 * The rest are a starting policy, not a statutory figure — nothing in Indian
 * law sets them — and any organisation can override them. They are ordered by
 * how long the thing being bought lasts: a house outlives a car, which outlives
 * a personal expense.
 */
export const DEFAULT_LIMIT_MONTHS: Record<LoanType, number> = {
  salary_advance: 1,
  personal: 3,
  medical: 6,
  education: 12,
  vehicle: 18,
  housing: 60,
};

/** The longest an organisation may stretch a cap to, in months of basic. */
export const MAX_LIMIT_MONTHS = 120;

export interface LimitInput {
  loanType: LoanType;
  /** From the recorded salary structure. Null when none exists. */
  monthlyBasicMinor: Minor | null;
  /** Still outstanding across every live loan, in paise. */
  outstandingMinor: Minor;
  /** Per-organisation overrides, in months of basic. */
  limitMonths?: Partial<Record<LoanType, number>>;
}

export type LimitVerdict =
  | { ok: true; capMinor: Minor; headroomMinor: Minor; months: number }
  | { ok: false; reason: "no-salary-structure" | "no-headroom"; message: string; capMinor?: Minor };

/** Months of basic allowed for a type, clamped to something sane. */
export function limitMonthsFor(
  loanType: LoanType,
  overrides?: Partial<Record<LoanType, number>>
): number {
  const configured = overrides?.[loanType];
  const months =
    typeof configured === "number" && Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_LIMIT_MONTHS[loanType];
  return Math.min(Math.max(Math.floor(months), 1), MAX_LIMIT_MONTHS);
}

/**
 * The ceiling for this kind of borrowing, and what is left of it.
 *
 * Returns the cap as well as the headroom, because "you may borrow up to
 * ₹80,000, and ₹30,000 of that is already lent" tells somebody something they
 * can act on, where a bare "₹50,000" does not explain itself.
 */
export function loanLimit(input: LimitInput): LimitVerdict {
  const { loanType, monthlyBasicMinor, outstandingMinor } = input;

  if (monthlyBasicMinor === null || monthlyBasicMinor <= 0n) {
    return {
      ok: false,
      reason: "no-salary-structure",
      message:
        "Your salary structure has not been recorded, so the amount you can " +
        "borrow cannot be worked out. Ask HR to add it.",
    };
  }

  const months = limitMonthsFor(loanType, input.limitMonths);
  const capMinor = monthlyBasicMinor * BigInt(months);
  const outstanding = outstandingMinor > 0n ? outstandingMinor : 0n;
  const headroomMinor = capMinor - outstanding;

  if (headroomMinor <= 0n) {
    return {
      ok: false,
      reason: "no-headroom",
      capMinor,
      message:
        "What you already owe reaches the limit for this kind of loan, so " +
        "there is nothing further to draw against until some of it is repaid.",
    };
  }

  return { ok: true, capMinor, headroomMinor, months };
}

export type RequestVerdict =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Whether a specific amount may be borrowed.
 *
 * Separate from [loanLimit] so a screen can show the ceiling before somebody
 * types anything, and the endpoint can refuse the same way afterwards. Both
 * read the same rule, which is what stops the form and the server disagreeing.
 */
export function checkLoanRequest(
  principalMinor: Minor,
  input: LimitInput
): RequestVerdict {
  if (principalMinor <= 0n) {
    return { ok: false, message: "Enter how much you need." };
  }

  const limit = loanLimit(input);
  if (!limit.ok) return { ok: false, message: limit.message };

  if (principalMinor > limit.headroomMinor) {
    const isAdvance = input.loanType === "salary_advance";
    return {
      ok: false,
      message: isAdvance
        ? `A salary advance cannot be more than one month of your basic pay, ` +
          `which is ${rupees(limit.capMinor)}.` +
          (limit.headroomMinor < limit.capMinor
            ? ` You have ${rupees(limit.headroomMinor)} of that left.`
            : "")
        : `The most you can borrow for this is ${rupees(limit.capMinor)} — ` +
          `${limit.months} months of your basic pay.` +
          (limit.headroomMinor < limit.capMinor
            ? ` You have ${rupees(limit.headroomMinor)} of that left.`
            : ""),
    };
  }

  return { ok: true };
}

/**
 * Paise as rupees, for a message somebody reads.
 *
 * Indian digit grouping — 12,34,567 rather than 1,234,567 — because this is
 * the only grouping the audience reads without stopping to count.
 */
export function rupees(minor: Minor): string {
  const whole = minor / 100n;
  const digits = whole.toString();
  if (digits.length <= 3) return `₹${digits}`;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `₹${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}
