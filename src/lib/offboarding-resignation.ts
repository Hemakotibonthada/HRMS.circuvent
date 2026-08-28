// ═══════════════════════════════════════════════════════════════
// RESIGNATION RULES — pure notice-period and last-working-day logic
// ═══════════════════════════════════════════════════════════════
// The decisions a resignation needs, separated from storage so they test
// without a database — the same split `lifecycle-rules.ts` makes for
// checklists, for the same reason: a proration bug or a wrong last-working
// day is easier to find in a pure function that runs in a test than in a
// repository method that needs a transaction to exercise.
//
// The one rule that matters most here is `computeAgreedLastWorkingDay`. An
// employee's "intended last working day" is a request, not a fact — the
// resignation table keeps it verbatim precisely because it is not what
// necessarily happens. What actually gets recorded as agreed, the moment a
// resignation is accepted, is the later of what was requested and what the
// notice-period policy requires, so acceptance can never shorten a person's
// notice by itself. Only a deliberate, separate, HR-only action —
// `adjustLastWorkingDay` — can release someone earlier than policy would
// have required, and that is exactly the situation `computeSettlement` in
// settlement.ts already knows how to price: a shortfall between what notice
// was owed and what notice was actually served.

import { addDaysToKey } from "./date-keys";

/** Matches `employees.noticePeriodDays`' own default — used only when that column is somehow null. */
export const DEFAULT_NOTICE_PERIOD_DAYS = 60;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertDateKey(value: string, label: string): void {
  if (!DATE_KEY_PATTERN.test(value)) {
    throw new RangeError(`${label} must be YYYY-MM-DD, got "${value}"`);
  }
}

/**
 * The last working day notice policy alone would produce: submission plus
 * the full notice period, with no regard for what the employee asked for.
 * Exported on its own (rather than folded silently into
 * `computeAgreedLastWorkingDay`) because the settlement screen needs to be
 * able to show "policy would require the 14th" next to "agreed: the 5th" —
 * the gap between the two is the whole reason a notice recovery line exists.
 */
export function policyLastWorkingDay(submittedAt: string, noticePeriodDays: number): string {
  assertDateKey(submittedAt, "submittedAt");
  if (!Number.isInteger(noticePeriodDays) || noticePeriodDays < 0) {
    throw new RangeError(`noticePeriodDays must be a non-negative whole number, got ${noticePeriodDays}`);
  }
  return addDaysToKey(submittedAt, noticePeriodDays);
}

/**
 * What gets written to `resignations.agreedLastWorkingDay` the moment
 * acceptance runs.
 *
 * The later of the two dates, not simply the requested one: if policy
 * requires 60 days and somebody only offered 10, accepting the resignation
 * does not by itself waive 50 days of notice — HR must do that on purpose,
 * through `adjustLastWorkingDay`, which is the one action in this path that
 * can move the date earlier than policy would allow. If the employee offered
 * *more* notice than policy requires, that offer is honoured rather than cut
 * short to the policy minimum.
 */
export function computeAgreedLastWorkingDay(
  submittedAt: string,
  intendedLastWorkingDay: string,
  noticePeriodDays: number
): string {
  assertDateKey(intendedLastWorkingDay, "intendedLastWorkingDay");
  const policyMinimum = policyLastWorkingDay(submittedAt, noticePeriodDays);
  return intendedLastWorkingDay > policyMinimum ? intendedLastWorkingDay : policyMinimum;
}

/** A resignation accepts exactly once — there is no "accepted" → "submitted" path back. */
export function canAcceptResignation(status: string): boolean {
  return status === "submitted";
}

/**
 * Whether HR may still move the agreed last working day.
 *
 * Blocked once a settlement snapshot exists rather than once exit processing
 * has fully finished: the snapshot is what freezes the proration, and it can
 * be computed by an early "HR confirms exit" trigger well before the
 * cron sweep would otherwise have reached the agreed date (see
 * `offboarding-exit.ts`). Moving the date after that point would leave a
 * frozen settlement quietly priced against a last working day that is no
 * longer the real one, with nothing in this path recomputing it — this
 * codebase's settlement deliberately never recomputes once frozen, so the
 * guard has to sit here, before the freeze, rather than after it.
 */
export function canAdjustLastWorkingDay(status: string, hasSettlementSnapshot: boolean): boolean {
  return status === "accepted" && !hasSettlementSnapshot;
}

/** Whether a new resignation may be submitted for this employee right now. */
export function canSubmitResignation(hasOpenResignation: boolean): boolean {
  return !hasOpenResignation;
}
