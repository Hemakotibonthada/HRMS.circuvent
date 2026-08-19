// ═══════════════════════════════════════════════════════════════
// FULL AND FINAL SETTLEMENT — what is owed when employment ends
// ═══════════════════════════════════════════════════════════════
//
// The last calculation an employer does for somebody, and the one they
// remember. It is also the one most often got wrong, because it is the only
// time gratuity, leave encashment, notice pay and every outstanding recovery
// meet in a single figure.
//
// Three things this module insists on:
//
//   * **The net may be negative.** An employee who resigns without serving
//     notice, holds an unreturned laptop and an outstanding advance can owe the
//     company money. A settlement that clamps at zero silently writes off a
//     debt; one that reports a negative lets somebody decide what to do about
//     it. Representing it is not the same as pursuing it.
//
//   * **Every line is shown.** A single net figure is unarguable and therefore
//     untrustworthy — the employee cannot see that their notice recovery was
//     computed on gross rather than basic until it is written down.
//
//   * **The leave encashment divisor is a choice, not a fact.** Gratuity has a
//     statutory divisor of 26. Leave encashment does not: companies use 26 or
//     30, the difference is about 15% of the payment, and the Act is silent. It
//     is therefore a required input with no default, so that an organisation
//     states its own rule rather than inheriting whichever one happened to be
//     written here.

import { calculateGratuity, type GratuityResult, type Minor } from "./statutory-india";

/** Why employment ended. Some reasons change what is owed. */
export type ExitReason =
  | "resignation"
  | "termination"
  | "retirement"
  | "redundancy"
  | "death"
  | "disablement";

/**
 * The divisor used to turn a monthly figure into a daily one.
 *
 * 26 treats a month as working days only, which is the basis the Payment of
 * Gratuity Act uses. 30 treats it as calendar days. Both are defensible and
 * they differ by about 15%, so the organisation states which it uses.
 */
export type DayBasis = 26 | 30;

export interface SettlementInput {
  joinDate: string;
  /** Last day of employment. */
  exitDate: string;
  reason: ExitReason;

  /** Last drawn figures, used for every per-day computation. */
  monthlyBasicPlusDaMinor: Minor;
  monthlyGrossMinor: Minor;

  /** Pay for the final part-month. */
  daysWorkedInFinalMonth: number;
  daysInFinalMonth: number;

  /** Notice, in days. */
  noticePeriodDays: number;
  noticeServedDays: number;
  /**
   * The employer released the employee early without recovery.
   *
   * Distinct from serving the notice: it means the shortfall exists and is
   * forgiven, which is a decision somebody made and should be visible.
   */
  noticeWaived?: boolean;

  /** Unused leave the policy allows to be encashed. */
  encashableLeaveDays: number;
  leaveEncashmentBasis: DayBasis;
  /** Notice recovery is usually on basic, occasionally on gross. Stated, not assumed. */
  noticeRecoveryOnGross?: boolean;

  /** Anything still owed to the company. */
  outstandingLoanMinor?: Minor;
  unreturnedAssetMinor?: Minor;
  otherRecoveryMinor?: Minor;

  /** Amounts still owed to the employee. */
  pendingReimbursementMinor?: Minor;
  bonusPayableMinor?: Minor;

  /** Statutory deductions on the settlement itself. */
  professionalTaxMinor?: Minor;
  tdsMinor?: Minor;

  /** Overrides the ₹20,00,000 statutory gratuity ceiling where one applies. */
  gratuityCeilingMinor?: Minor;
}

export interface SettlementLine {
  code: string;
  label: string;
  amountMinor: Minor;
  note?: string;
}

export interface Settlement {
  earnings: SettlementLine[];
  deductions: SettlementLine[];
  totalEarningsMinor: Minor;
  totalDeductionsMinor: Minor;
  /** Positive when the company pays; negative when the employee owes. */
  netPayableMinor: Minor;
  employeeOwes: boolean;
  gratuity: GratuityResult;
  /** Everything a reviewer should look at before this is paid. */
  notes: string[];
}

const zero = 0n;
const orZero = (v: Minor | undefined): Minor => v ?? zero;

/**
 * A number of days' pay from a monthly figure.
 *
 * Multiplies before dividing. Computing a daily rate first and then scaling it
 * truncates a fraction of a paise every day and loses ten of them across a
 * thirty-day notice period — small, but it makes the settlement disagree with
 * the arithmetic anyone checks it against by hand, which is worse than the
 * money.
 */
function daysOfPay(monthlyMinor: Minor, days: number, basis: DayBasis): Minor {
  return (monthlyMinor * BigInt(Math.round(days))) / BigInt(basis);
}

/**
 * Works out what is owed in either direction when employment ends.
 *
 * Reasons matter in two places and nowhere else: death and disablement waive
 * the five-year gratuity qualification, and neither they nor redundancy attract
 * a notice recovery — recovering notice pay from the estate of somebody who
 * died in service is not a thing an HR system should make easy to do by
 * accident.
 */
export function computeSettlement(input: SettlementInput): Settlement {
  const notes: string[] = [];
  const earnings: SettlementLine[] = [];
  const deductions: SettlementLine[] = [];

  // ── Final month's salary ──
  const daysInMonth = input.daysInFinalMonth > 0 ? input.daysInFinalMonth : 30;
  const workedDays = Math.max(0, Math.min(input.daysWorkedInFinalMonth, daysInMonth));
  const finalSalary =
    (input.monthlyGrossMinor * BigInt(Math.round(workedDays * 100))) /
    (BigInt(daysInMonth) * 100n);

  earnings.push({
    code: "final_salary",
    label: `Salary for ${workedDays} of ${daysInMonth} days`,
    amountMinor: finalSalary,
  });

  // ── Leave encashment ──
  const leaveDays = Math.max(0, input.encashableLeaveDays);
  const encashment = daysOfPay(
    input.monthlyBasicPlusDaMinor,
    leaveDays,
    input.leaveEncashmentBasis
  );

  if (leaveDays > 0) {
    earnings.push({
      code: "leave_encashment",
      label: `Encashment of ${leaveDays} day(s)`,
      amountMinor: encashment,
      note: `Computed on basic plus DA at a ${input.leaveEncashmentBasis}-day month.`,
    });
  }

  // ── Gratuity ──
  const gratuity = calculateGratuity(input.monthlyBasicPlusDaMinor, input.joinDate, input.exitDate, {
    ceilingMinor: input.gratuityCeilingMinor,
    isDeathOrDisablement: input.reason === "death" || input.reason === "disablement",
  });

  if (gratuity.isEligible && gratuity.cappedAmountMinor > zero) {
    earnings.push({
      code: "gratuity",
      label: `Gratuity for ${gratuity.yearsOfService} year(s)`,
      amountMinor: gratuity.cappedAmountMinor,
    });
    if (gratuity.cappedAmountMinor < gratuity.amountMinor) {
      notes.push(
        `Gratuity was capped at the statutory ceiling; ${
          (gratuity.amountMinor - gratuity.cappedAmountMinor) / 100n
        } rupees of the computed entitlement is not payable under the Act.`
      );
    }
  } else if (!gratuity.isEligible) {
    notes.push(`No gratuity: ${gratuity.reason ?? "not eligible"}.`);
  }

  // ── Other amounts owed to the employee ──
  if (orZero(input.pendingReimbursementMinor) > zero) {
    earnings.push({
      code: "reimbursements",
      label: "Approved reimbursements not yet paid",
      amountMinor: orZero(input.pendingReimbursementMinor),
    });
  }
  if (orZero(input.bonusPayableMinor) > zero) {
    earnings.push({
      code: "bonus",
      label: "Bonus or incentive due",
      amountMinor: orZero(input.bonusPayableMinor),
    });
  }

  // ── Notice ──
  const shortfallDays = Math.max(0, input.noticePeriodDays - input.noticeServedDays);
  const recoverable =
    input.reason !== "death" && input.reason !== "disablement" && input.reason !== "redundancy";

  if (shortfallDays > 0 && recoverable && !input.noticeWaived) {
    const base = input.noticeRecoveryOnGross
      ? input.monthlyGrossMinor
      : input.monthlyBasicPlusDaMinor;
    const recovery = daysOfPay(base, shortfallDays, 30);
    deductions.push({
      code: "notice_recovery",
      label: `Notice shortfall of ${shortfallDays} day(s)`,
      amountMinor: recovery,
      note: input.noticeRecoveryOnGross
        ? "Recovered on gross pay."
        : "Recovered on basic plus DA.",
    });
  } else if (shortfallDays > 0 && input.noticeWaived) {
    notes.push(
      `${shortfallDays} day(s) of notice were not served and the recovery was waived.`
    );
  } else if (shortfallDays > 0 && !recoverable) {
    notes.push(
      `${shortfallDays} day(s) of notice were not served; no recovery is made where ` +
        `service ended through ${input.reason}.`
    );
  }

  // ── Recoveries ──
  if (orZero(input.outstandingLoanMinor) > zero) {
    deductions.push({
      code: "loan_recovery",
      label: "Outstanding loan or advance",
      amountMinor: orZero(input.outstandingLoanMinor),
    });
  }
  if (orZero(input.unreturnedAssetMinor) > zero) {
    deductions.push({
      code: "asset_recovery",
      label: "Company property not returned",
      amountMinor: orZero(input.unreturnedAssetMinor),
      note: "Reverse this line if the item is returned before payment.",
    });
  }
  if (orZero(input.otherRecoveryMinor) > zero) {
    deductions.push({
      code: "other_recovery",
      label: "Other recoveries",
      amountMinor: orZero(input.otherRecoveryMinor),
    });
  }

  // ── Statutory ──
  if (orZero(input.professionalTaxMinor) > zero) {
    deductions.push({
      code: "professional_tax",
      label: "Professional tax",
      amountMinor: orZero(input.professionalTaxMinor),
    });
  }
  if (orZero(input.tdsMinor) > zero) {
    deductions.push({
      code: "tds",
      label: "Tax deducted at source",
      amountMinor: orZero(input.tdsMinor),
    });
  }

  const totalEarningsMinor = earnings.reduce((a, l) => a + l.amountMinor, zero);
  const totalDeductionsMinor = deductions.reduce((a, l) => a + l.amountMinor, zero);
  const netPayableMinor = totalEarningsMinor - totalDeductionsMinor;

  if (netPayableMinor < zero) {
    notes.push(
      `The deductions exceed the amount due by ${-netPayableMinor / 100n} rupees. ` +
        `This is recoverable from the employee rather than payable to them, and ` +
        `should be agreed before the settlement is issued.`
    );
  }

  return {
    earnings,
    deductions,
    totalEarningsMinor,
    totalDeductionsMinor,
    netPayableMinor,
    employeeOwes: netPayableMinor < zero,
    gratuity,
    notes,
  };
}

/**
 * How much of a gratuity payment escapes tax.
 *
 * For an employee not covered by government rules the exemption under section
 * 10(10) is the least of the actual gratuity, the statutory computation, and a
 * lifetime ceiling of ₹20,00,000 across all employers. The lifetime part is the
 * catch: this employer cannot see what a previous one already exempted, so the
 * figure is an upper bound and the employee is told as much rather than being
 * left to assume it is final.
 */
export function gratuityExemption(
  gratuityPaidMinor: Minor,
  options: { alreadyExemptedMinor?: Minor; lifetimeCeilingMinor?: Minor } = {}
): { exemptMinor: Minor; taxableMinor: Minor; note: string } {
  const ceiling = options.lifetimeCeilingMinor ?? 20_00_000_00n;
  const used = options.alreadyExemptedMinor ?? zero;
  const headroom = ceiling - used > zero ? ceiling - used : zero;

  const exemptMinor = gratuityPaidMinor < headroom ? gratuityPaidMinor : headroom;
  const taxableMinor = gratuityPaidMinor - exemptMinor;

  return {
    exemptMinor,
    taxableMinor,
    note:
      options.alreadyExemptedMinor === undefined
        ? "Assumes no gratuity exemption has been claimed with a previous employer; " +
          "the ₹20,00,000 ceiling is a lifetime one and this employer cannot see it."
        : "Computed against the exemption already used with previous employers.",
  };
}

/**
 * Leave encashment exemption under section 10(10AA) for a private-sector
 * employee.
 *
 * The lifetime ceiling was raised from ₹3,00,000 to ₹25,00,000 with effect from
 * April 2023, and a system still applying the old figure taxes almost the whole
 * payment. Retirement and resignation are treated alike here; encashment *while
 * still employed* is fully taxable and is not this function's business.
 */
export function leaveEncashmentExemption(
  encashedMinor: Minor,
  options: { alreadyExemptedMinor?: Minor; lifetimeCeilingMinor?: Minor } = {}
): { exemptMinor: Minor; taxableMinor: Minor } {
  const ceiling = options.lifetimeCeilingMinor ?? 25_00_000_00n;
  const used = options.alreadyExemptedMinor ?? zero;
  const headroom = ceiling - used > zero ? ceiling - used : zero;

  const exemptMinor = encashedMinor < headroom ? encashedMinor : headroom;
  return { exemptMinor, taxableMinor: encashedMinor - exemptMinor };
}
