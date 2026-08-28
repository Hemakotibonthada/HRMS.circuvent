// ═══════════════════════════════════════════════════════════════
// LEAVE RULES — client-side validation
// ═══════════════════════════════════════════════════════════════
// Pure and tested. The server validates all of this again — it must, because
// the phone is not trusted — but a form that only tells you what is wrong
// after a round-trip is painful on a mobile connection, and this is a form
// people fill in while walking.
//
// Dates are handled as YYYY-MM-DD strings throughout, never as Date objects.
// `new Date("2026-03-01")` parses as UTC midnight, and in any timezone west of
// Greenwich `.getDate()` on it returns the 28th of February. Leave spans have
// been shortened by a day by exactly that.

export interface LeaveDraft {
  leaveType: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  reason: string;
}

export type LeaveField = "leaveType" | "startDate" | "endDate" | "reason";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a syntactically valid date that also exists (not 31 February). */
export function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  if (month < 1 || month > 12 || day < 1) return false;

  // Day 0 of the next month is the last day of this one, which handles leap
  // years without a table.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDay;
}

/**
 * Whole days between two dates, inclusive.
 *
 * Computed in UTC. Using local time makes the span one day short whenever a
 * daylight-saving boundary falls inside it, because one of the days is 23
 * hours long and integer division loses it.
 */
export function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function validateLeave(
  draft: LeaveDraft,
  today: string
): Partial<Record<LeaveField, string>> {
  const errors: Partial<Record<LeaveField, string>> = {};

  if (!draft.leaveType) {
    errors.leaveType = "Choose a leave type";
  }

  if (!isRealDate(draft.startDate)) {
    errors.startDate = "Enter a start date as YYYY-MM-DD";
  }

  if (!isRealDate(draft.endDate)) {
    errors.endDate = "Enter an end date as YYYY-MM-DD";
  }

  if (isRealDate(draft.startDate) && isRealDate(draft.endDate)) {
    // String comparison is correct for ISO dates and avoids timezone
    // arithmetic entirely: "2026-03-01" < "2026-03-02" lexically and
    // chronologically, always.
    if (draft.endDate < draft.startDate) {
      errors.endDate = "The end date cannot be before the start date";
    }

    // Half day means one day. Allowing a range makes "half day" ambiguous:
    // half of which one?
    if (draft.isHalfDay && draft.endDate !== draft.startDate) {
      errors.endDate = "A half day must start and end on the same date";
    }
  }

  if (isRealDate(draft.startDate) && draft.startDate < today) {
    // A warning rather than a refusal would be wrong here: back-dated leave is
    // a regularisation, which is a different flow with an approver who is
    // meant to see it. Silently accepting it here bypasses that.
    errors.startDate = "You cannot apply for leave in the past. Ask HR to regularise it.";
  }

  const reason = draft.reason.trim();
  if (reason.length < 3) {
    errors.reason = "Give a reason, however brief";
  } else if (reason.length > 1000) {
    errors.reason = "Keep the reason under 1000 characters";
  }

  return errors;
}

/** Today as YYYY-MM-DD in the device's own timezone. */
export function todayIso(now: Date = new Date()): string {
  // Built from local parts, not toISOString(). toISOString() converts to UTC,
  // so anyone east of Greenwich after 5:30am gets tomorrow's date and is told
  // that today is in the past.
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
