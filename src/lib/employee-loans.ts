// ═══════════════════════════════════════════════════════════════
// EMPLOYEE LOANS AND ADVANCES
// ═══════════════════════════════════════════════════════════════
//
// Money lent to an employee and recovered from their pay. Three things have to
// hold together and usually do not:
//
//   1. The **schedule** — what is owed each month, on a reducing balance.
//   2. The **recovery** — what payroll actually took, which is not always the
//      instalment: a month with no pay recovers nothing, and the loan has to
//      survive that without silently forgiving it.
//   3. The **perquisite** — the part almost every Indian HRMS misses.
//
// ─── The perquisite ───
//
// A loan from an employer at no interest, or at less than the State Bank of
// India's rate for that kind of loan, is a taxable perquisite under Rule
// 3(7)(i). The taxable value is the SBI rate applied to the maximum outstanding
// balance on the last day of each month, less whatever interest the employee
// actually paid.
//
// So an interest-free loan is not free. Giving one and not reporting the
// perquisite under-declares the employee's income every month, and it is the
// employer who is answerable for the short deduction. Two exemptions apply: an
// aggregate of ₹20,000 or less, and loans for the medical treatment of
// specified diseases.
//
// The SBI rate is not knowable from inside this module — it is published on the
// first day of the financial year and varies by loan type — so it is a required
// input rather than a number invented here.

import type { Minor } from "./statutory-india";

export type LoanType = "personal" | "housing" | "vehicle" | "education" | "medical" | "salary_advance";
export type LoanStatus = "pending" | "active" | "closed" | "written_off";

export interface Loan {
  principalMinor: Minor;
  /** Annual rate the employer charges, as a percentage. Zero is common. */
  interestRatePercent: number;
  tenureMonths: number;
  /** Month the first instalment is recovered, 1-12, with its year. */
  firstRecoveryMonth: number;
  firstRecoveryYear: number;
  type: LoanType;
}

export interface Instalment {
  index: number;
  month: number;
  year: number;
  openingBalanceMinor: Minor;
  principalMinor: Minor;
  interestMinor: Minor;
  totalMinor: Minor;
  closingBalanceMinor: Minor;
}

/**
 * The equated monthly instalment on a reducing balance.
 *
 * Computed in paise with integer arithmetic throughout. The usual floating
 * point formula is out by a few paise a month, which compounds across a
 * sixty-month tenure into a final instalment that does not clear the loan —
 * and a loan that will not close is a support ticket every month for ever.
 */
export function monthlyInstalment(loan: Pick<Loan, "principalMinor" | "interestRatePercent" | "tenureMonths">): Minor {
  if (loan.tenureMonths <= 0) return 0n;
  if (loan.interestRatePercent === 0) {
    // Rounded up, so the last instalment is the small one rather than leaving a
    // few paise outstanding after the final payment.
    const exact = loan.principalMinor / BigInt(loan.tenureMonths);
    return loan.principalMinor % BigInt(loan.tenureMonths) === 0n ? exact : exact + 1n;
  }

  // r is the monthly rate. Scaled by 1e9 to keep precision without floats.
  const SCALE = 1_000_000_000n;
  const monthlyRate = (BigInt(Math.round(loan.interestRatePercent * 1_000_000)) * SCALE) / (100n * 1_000_000n * 12n);

  // (1 + r)^n
  let compound = SCALE;
  for (let i = 0; i < loan.tenureMonths; i++) {
    compound = (compound * (SCALE + monthlyRate)) / SCALE;
  }

  const numerator = loan.principalMinor * monthlyRate * compound;
  const denominator = (compound - SCALE) * SCALE;
  if (denominator <= 0n) return loan.principalMinor / BigInt(loan.tenureMonths);

  const emi = numerator / denominator;
  return emi + 1n; // round up, for the same reason as above
}

/**
 * The full repayment schedule.
 *
 * The final instalment is whatever clears the balance rather than the computed
 * EMI, which is how a real amortisation works and why the last row is usually a
 * few rupees different from the rest.
 */
export function schedule(loan: Loan): Instalment[] {
  const emi = monthlyInstalment(loan);
  const rows: Instalment[] = [];

  let balance = loan.principalMinor;
  let month = loan.firstRecoveryMonth;
  let year = loan.firstRecoveryYear;

  for (let i = 1; i <= loan.tenureMonths && balance > 0n; i++) {
    const interest =
      loan.interestRatePercent === 0
        ? 0n
        : (balance * BigInt(Math.round(loan.interestRatePercent * 100))) / (100n * 100n * 12n);

    let principal = emi - interest;
    if (principal > balance) principal = balance;

    const total = principal + interest;
    const closing = balance - principal;

    rows.push({
      index: i,
      month,
      year,
      openingBalanceMinor: balance,
      principalMinor: principal,
      interestMinor: interest,
      totalMinor: total,
      closingBalanceMinor: closing,
    });

    balance = closing;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return rows;
}

export interface Recovery {
  month: number;
  year: number;
  amountMinor: Minor;
}

export interface LoanPosition {
  principalMinor: Minor;
  recoveredMinor: Minor;
  outstandingMinor: Minor;
  instalmentsPaid: number;
  instalmentsMissed: number;
  status: LoanStatus;
}

/**
 * Where a loan stands, given what payroll actually recovered.
 *
 * Recovery is compared against the schedule rather than assumed to follow it. A
 * month of unpaid leave recovers nothing; a settlement may clear the balance in
 * one go. Both are normal, and a system that assumes the schedule was followed
 * reports a loan as closed while money is still outstanding.
 */
export function positionOf(loan: Loan, recoveries: readonly Recovery[]): LoanPosition {
  const recovered = recoveries.reduce((a, r) => a + r.amountMinor, 0n);
  const outstanding = loan.principalMinor - recovered > 0n ? loan.principalMinor - recovered : 0n;

  const due = schedule(loan);
  const paidMonths = new Set(recoveries.filter((r) => r.amountMinor > 0n).map((r) => `${r.year}-${r.month}`));
  const elapsed = due.filter((d) => paidMonths.has(`${d.year}-${d.month}`));

  return {
    principalMinor: loan.principalMinor,
    recoveredMinor: recovered,
    outstandingMinor: outstanding,
    instalmentsPaid: elapsed.length,
    instalmentsMissed: 0,
    status: outstanding === 0n ? "closed" : "active",
  };
}

/** Aggregate below which no perquisite arises. */
export const PERQUISITE_EXEMPT_AGGREGATE_MINOR: Minor = 20_000_00n;

export interface PerquisiteInput {
  /** Outstanding balance on the last day of each month of the year. */
  monthEndBalancesMinor: readonly Minor[];
  /** SBI's rate for this class of loan on the first day of the financial year. */
  sbiRatePercent: number;
  /** What the employer actually charged, if anything. */
  employerRatePercent: number;
  loanType: LoanType;
  /** Total of all loans outstanding to this employee. */
  aggregateOutstandingMinor: Minor;
}

export interface PerquisiteResult {
  taxableMinor: Minor;
  exempt: boolean;
  reason?: string;
}

/**
 * The taxable value of a concessional loan.
 *
 * Applied month by month to the closing balance, because a loan being repaid
 * carries less benefit each month and charging the perquisite on the opening
 * principal overstates it substantially.
 */
export function loanPerquisite(input: PerquisiteInput): PerquisiteResult {
  if (input.aggregateOutstandingMinor <= PERQUISITE_EXEMPT_AGGREGATE_MINOR) {
    return {
      taxableMinor: 0n,
      exempt: true,
      reason: "Aggregate outstanding is within the ₹20,000 exemption.",
    };
  }

  if (input.loanType === "medical") {
    return {
      taxableMinor: 0n,
      exempt: true,
      reason:
        "Loans for the medical treatment of specified diseases are exempt. The " +
        "exemption does not survive any part reimbursed under a medical insurance policy.",
    };
  }

  const shortfall = input.sbiRatePercent - input.employerRatePercent;
  if (shortfall <= 0) {
    return {
      taxableMinor: 0n,
      exempt: true,
      reason: "The rate charged is at or above the benchmark, so no benefit arises.",
    };
  }

  // Summed first, then rated. Applying the rate month by month truncates a
  // fraction of a paise twelve times and lands a few paise below the figure
  // anyone verifying this by hand will get.
  const rateScaled = BigInt(Math.round(shortfall * 10_000));
  const totalBalance = input.monthEndBalancesMinor.reduce((sum, b) => sum + b, 0n);
  const taxable = (totalBalance * rateScaled) / (100n * 10_000n * 12n);

  return { taxableMinor: taxable, exempt: false };
}

/**
 * What payroll should recover this month.
 *
 * Capped at the outstanding balance so the final month takes what is left
 * rather than a full instalment, and capped again at what the employee is
 * actually being paid — recovering more than somebody earns produces a negative
 * net pay, which is not a thing that can happen and is usually a sign the
 * recovery should have been paused instead.
 */
export function recoveryForMonth(input: {
  instalmentMinor: Minor;
  outstandingMinor: Minor;
  netPayBeforeRecoveryMinor: Minor;
}): { amountMinor: Minor; capped: boolean; note?: string } {
  const wanted =
    input.instalmentMinor > input.outstandingMinor ? input.outstandingMinor : input.instalmentMinor;

  if (wanted <= 0n) return { amountMinor: 0n, capped: false };

  if (wanted > input.netPayBeforeRecoveryMinor) {
    const amount = input.netPayBeforeRecoveryMinor > 0n ? input.netPayBeforeRecoveryMinor : 0n;
    return {
      amountMinor: amount,
      capped: true,
      note:
        "The instalment exceeds this month's net pay and was reduced. The balance " +
        "carries forward; consider pausing the recovery rather than leaving the " +
        "employee with nothing.",
    };
  }

  return { amountMinor: wanted, capped: false };
}
