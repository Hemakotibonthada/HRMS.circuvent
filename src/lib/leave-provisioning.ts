// ═══════════════════════════════════════════════════════════════
// LEAVE PROVISIONING
// ═══════════════════════════════════════════════════════════════
//
// Turning a leave policy into the balance an employee can actually draw on.
//
// This was the missing half of the leave module. `leave_policies` describes
// what the company grants, `leave_balances` records what each person has, and
// nothing anywhere in the product ever wrote a balance row — the schema
// defined the table, `/api/leave/balances` had a GET and no POST, and no
// repository inserted one. So every application, from every employee, in every
// tenant, was refused with "No casual balance exists for 2026".
//
// The leave module looked finished from the outside: an apply form, an
// approvals queue, a balances page, a calendar. It could not process a single
// request, because the prerequisite data had no way of coming into existence.
//
// Two things decide the arithmetic here, and both are the sort of detail that
// quietly costs somebody a day of leave:
//
//   - **A mid-year joiner does not get the full annual quota.** Where a policy
//     is pro-rata, entitlement is earned per remaining month. Granting the
//     whole quota to someone who joined in November means they can take
//     twenty-one days of earned leave in December.
//
//   - **Rounding goes to the employee.** Pro-rata almost never divides evenly,
//     and the difference is a fraction of a day. Rounding down silently
//     shortens people's leave, so this rounds to the nearest half day, which
//     is also the smallest unit the rest of the product books in.

/** The leave types this product knows, matching `leave_type` in the schema. */
export type LeaveType =
  | "casual"
  | "sick"
  | "earned"
  | "maternity"
  | "paternity"
  | "compensatory"
  | "unpaid"
  | "bereavement"
  | "wfh"
  | "marriage"
  | "study";

export interface LeavePolicy {
  leaveType: LeaveType;
  label: string;
  annualQuotaDays: number;
  /** Accrue over the year rather than granting the whole quota up front. */
  isProRata: boolean;
  carryForwardLimitDays?: number;
  isActive?: boolean;
}

export interface ProvisionedBalance {
  leaveType: LeaveType;
  year: number;
  openingDays: number;
  accruedDays: number;
  carryForwardDays: number;
}

/**
 * The default policy set for a new organisation.
 *
 * A tenant that has just registered has no leave policies, so without these
 * `provisionFor` returns nothing and the module stays as inert as it was. The
 * quotas below are ordinary Indian private-sector practice and are a starting
 * point the tenant is expected to edit, not a statutory claim — the one figure
 * that *is* statutory, maternity leave at twenty-six weeks under the Maternity
 * Benefit Act as amended in 2017, is set to that and marked non-pro-rata,
 * because an entitlement conferred by statute is not earned by the month.
 */
export const DEFAULT_LEAVE_POLICIES: readonly LeavePolicy[] = [
  { leaveType: "casual", label: "Casual Leave", annualQuotaDays: 12, isProRata: true, carryForwardLimitDays: 0 },
  { leaveType: "sick", label: "Sick Leave", annualQuotaDays: 12, isProRata: true, carryForwardLimitDays: 0 },
  { leaveType: "earned", label: "Earned Leave", annualQuotaDays: 18, isProRata: true, carryForwardLimitDays: 30 },
  { leaveType: "maternity", label: "Maternity Leave", annualQuotaDays: 182, isProRata: false },
  { leaveType: "paternity", label: "Paternity Leave", annualQuotaDays: 15, isProRata: false },
  { leaveType: "bereavement", label: "Bereavement Leave", annualQuotaDays: 5, isProRata: false },
  { leaveType: "marriage", label: "Marriage Leave", annualQuotaDays: 5, isProRata: false },
  { leaveType: "compensatory", label: "Compensatory Off", annualQuotaDays: 0, isProRata: false },
  { leaveType: "unpaid", label: "Leave Without Pay", annualQuotaDays: 0, isProRata: false },
] as const;

/** Rounds to the nearest half day, which is the smallest unit leave is booked in. */
export function toHalfDays(value: number): number {
  return Math.round(value * 2) / 2;
}

/**
 * Months of the year an employee is entitled to accrue over.
 *
 * Counted inclusively from the joining month: somebody who starts on
 * 20 November has still worked part of November, and the alternative — counting
 * only whole months — means a late-month joiner accrues nothing for a month
 * they were paid for.
 */
export function accrualMonths(joinDate: string, year: number): number {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(joinDate);
  if (!match) return 0;

  const joinYear = Number(match[1]);
  const joinMonth = Number(match[2]);

  if (joinYear > year) return 0;
  if (joinYear < year) return 12;

  return 12 - joinMonth + 1;
}

/**
 * The balances an employee should start the year with.
 *
 * Carry-forward is passed in rather than derived, because it is a fact about
 * last year's closing balance that this function has no way to know and must
 * not invent.
 */
export function provisionFor(input: {
  policies: readonly LeavePolicy[];
  joinDate: string;
  year: number;
  carryForward?: Partial<Record<LeaveType, number>>;
}): ProvisionedBalance[] {
  const months = accrualMonths(input.joinDate, input.year);
  if (months === 0) return [];

  const out: ProvisionedBalance[] = [];

  for (const policy of input.policies) {
    if (policy.isActive === false) continue;

    // A quota of zero is a real policy, not a missing one: compensatory off is
    // earned by working, and unpaid leave has no ceiling. The row still has to
    // exist, or applying for either is refused for want of a balance.
    const entitlement = policy.isProRata
      ? toHalfDays((policy.annualQuotaDays * months) / 12)
      : policy.annualQuotaDays;

    const carried = Math.min(
      input.carryForward?.[policy.leaveType] ?? 0,
      policy.carryForwardLimitDays ?? 0
    );

    out.push({
      leaveType: policy.leaveType,
      year: input.year,
      openingDays: entitlement,
      // Non-pro-rata entitlement is available immediately; pro-rata is granted
      // as the opening figure too, because this product books against
      // `openingDays + accruedDays` and accruing monthly needs a scheduled job
      // that does not exist yet. Stated rather than hidden: the balance is
      // correct for the year, and generous within it.
      accruedDays: 0,
      carryForwardDays: carried,
    });
  }

  return out;
}

/** Days an employee may still take, given a balance row. */
export function availableDays(balance: {
  openingDays: number;
  accruedDays: number;
  carryForwardDays: number;
  usedDays: number;
  pendingDays: number;
  lapsedDays?: number;
  encashedDays?: number;
}): number {
  const granted =
    balance.openingDays + balance.accruedDays + balance.carryForwardDays;
  const gone =
    balance.usedDays +
    balance.pendingDays +
    (balance.lapsedDays ?? 0) +
    (balance.encashedDays ?? 0);

  // Never negative. A balance can legitimately be overdrawn by an approval
  // made against a policy that later changed, and showing "-2 days available"
  // reads as a bug to the employee looking at it.
  return Math.max(0, toHalfDays(granted - gone));
}
