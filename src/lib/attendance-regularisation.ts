// ═══════════════════════════════════════════════════════════════
// ATTENDANCE REGULARISATION — correcting the record after the fact
// ═══════════════════════════════════════════════════════════════
//
// Somebody forgot to clock out, spent the day at a client site, or the reader
// on the door was down. The attendance record is wrong, and left alone it
// becomes an absence, and an absence becomes loss of pay. So there has to be a
// way to correct it — and a way that cannot be used to quietly rewrite history.
//
// ─── The rule that matters ───
//
// **A month whose payroll has been processed cannot be regularised into a
// different shape.** Attendance is what pay was computed from. Changing it
// afterwards means the payslip, the register and the record no longer agree,
// and the disagreement is discovered either by an auditor or by an employee who
// was underpaid and has no way to prove it.
//
// The answer is not to refuse the correction — the employee was genuinely at
// work — but to refuse to make it silently. A locked month produces an
// adjustment that goes through the next payroll run as arrears, with the
// original record intact. That is the difference between a correction and a
// rewrite.
//
// ─── The rules that stop it being a free pass ───
//
// Regularisation is self-service, which makes it the easiest way to manufacture
// attendance. So: no future dates, a window measured in days rather than left
// open, a monthly cap, one live request per date, and an approver who is not
// the requester.

export type RegularisationReason =
  | "missed_punch"
  | "wrong_time"
  | "on_duty"
  | "work_from_home"
  | "system_error"
  | "shift_change";

export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface RegularisationPolicy {
  /** How far back a correction may reach, in days. */
  windowDays: number;
  /** How many may be approved in one calendar month. */
  monthlyLimit: number;
  /** Whether a reason in free text is required alongside the category. */
  requiresNote: boolean;
  /** Reasons that need evidence rather than only an explanation. */
  reasonsNeedingProof: RegularisationReason[];
}

export const DEFAULT_POLICY: RegularisationPolicy = {
  // Long enough to cover a forgotten punch noticed on the next payslip, short
  // enough that a month's attendance settles.
  windowDays: 30,
  monthlyLimit: 3,
  requiresNote: true,
  reasonsNeedingProof: ["on_duty"],
};

export interface RegularisationRequest {
  employeeId: string;
  /** The day being corrected, as YYYY-MM-DD. */
  date: string;
  reason: RegularisationReason;
  note?: string;
  /** Corrected times, as HH:MM in the employee's own timezone. */
  inTime?: string;
  outTime?: string;
  hasProof?: boolean;
}

export interface RegularisationContext {
  /** Today, as YYYY-MM-DD. Passed in so the rules are testable. */
  today: string;
  policy: RegularisationPolicy;
  /** Approved regularisations already used in the month of `date`. */
  approvedThisMonth: number;
  /** True when a request for the same date is already open. */
  hasOpenRequestForDate: boolean;
  /** True when payroll for the month of `date` has been processed. */
  payrollLockedForMonth: boolean;
  /** The day is a weekly off or a holiday. */
  isNonWorkingDay?: boolean;
}

export interface Problem {
  field: string;
  message: string;
}

export type Outcome =
  | { accepted: true; routing: "normal" | "adjustment"; notes: string[] }
  | { accepted: false; problems: Problem[] };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

function minutesOf(hhmm: string): number {
  return +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
}

/**
 * Whether a correction may be made, and how it must be routed.
 *
 * Returns every problem rather than the first, because the form is filled in
 * once and an employee sent back three times will stop bothering and take the
 * loss of pay instead.
 */
export function evaluate(
  request: RegularisationRequest,
  ctx: RegularisationContext
): Outcome {
  const problems: Problem[] = [];
  const notes: string[] = [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.date)) {
    return { accepted: false, problems: [{ field: "date", message: "The date is not a real date." }] };
  }

  const age = daysBetween(request.date, ctx.today);

  if (age < 0) {
    problems.push({
      field: "date",
      message: "A day that has not happened yet cannot be regularised.",
    });
  }

  if (age > ctx.policy.windowDays) {
    problems.push({
      field: "date",
      message: `Regularisation closes after ${ctx.policy.windowDays} days; this day is ${age} days old.`,
    });
  }

  if (ctx.hasOpenRequestForDate) {
    problems.push({
      field: "date",
      message: "There is already a request open for this day. Withdraw it before raising another.",
    });
  }

  if (ctx.approvedThisMonth >= ctx.policy.monthlyLimit) {
    problems.push({
      field: "date",
      message:
        `${ctx.policy.monthlyLimit} regularisations have already been approved this month. ` +
        `Raise it with your manager instead — a pattern of missed punches is a rota ` +
        `problem rather than a paperwork one.`,
    });
  }

  if (ctx.policy.requiresNote && !request.note?.trim()) {
    problems.push({
      field: "note",
      message: "Say what happened. An approver cannot judge a correction they cannot see the reason for.",
    });
  }

  if (ctx.policy.reasonsNeedingProof.includes(request.reason) && !request.hasProof) {
    problems.push({
      field: "proof",
      message: `A ${request.reason.replace(/_/g, " ")} correction needs supporting evidence.`,
    });
  }

  for (const [field, value] of [
    ["inTime", request.inTime],
    ["outTime", request.outTime],
  ] as const) {
    if (value !== undefined && !HHMM.test(value)) {
      problems.push({ field, message: `"${value}" is not a time of day.` });
    }
  }

  if (
    request.inTime &&
    request.outTime &&
    HHMM.test(request.inTime) &&
    HHMM.test(request.outTime) &&
    minutesOf(request.outTime) <= minutesOf(request.inTime)
  ) {
    // Overnight shifts are real, but they are a shift change rather than a
    // correction, and treating them here would let any pair of times through.
    problems.push({
      field: "outTime",
      message:
        "The out time is not after the in time. For a shift that crosses midnight, " +
        "raise a shift change instead.",
    });
  }

  if (!request.inTime && !request.outTime && request.reason !== "on_duty" && request.reason !== "work_from_home") {
    problems.push({
      field: "inTime",
      message: "Give at least one corrected time, or the record has nothing to change to.",
    });
  }

  if (ctx.isNonWorkingDay) {
    notes.push(
      "This is a weekly off or a holiday. If the employee genuinely worked, the day " +
        "should earn compensatory off rather than be recorded as ordinary attendance."
    );
  }

  if (problems.length > 0) return { accepted: false, problems };

  if (ctx.payrollLockedForMonth) {
    notes.push(
      "Payroll for this month has already been processed. The original record is kept " +
        "and the correction is carried into the next run as an adjustment, so the " +
        "payslip already issued still agrees with the attendance it was computed from."
    );
    return { accepted: true, routing: "adjustment", notes };
  }

  return { accepted: true, routing: "normal", notes };
}

export interface Approval {
  approverId: string;
  requesterId: string;
  status: RequestStatus;
  /** Required when rejecting. */
  reason?: string;
  /** Decider's role: admin and owner can override self-approval when running the organization */
  role?: string;
  isOwnerOrAdmin?: boolean;
}

/**
 * Whether an approval decision may be recorded.
 *
 * Self-approval is restricted by default for general employees, but permitted
 * for organization owners and administrators who manage their own enterprise.
 */
export function canDecide(approval: Approval): { allowed: boolean; message?: string } {
  const isElevated =
    approval.isOwnerOrAdmin || approval.role === "owner" || approval.role === "admin";

  if (approval.approverId === approval.requesterId && !isElevated) {
    return {
      allowed: false,
      message: "A regularisation cannot be approved by the person who raised it.",
    };
  }

  if (approval.status === "rejected" && !approval.reason?.trim()) {
    return {
      allowed: false,
      message: "Say why it was rejected. An employee losing a day's pay is owed a reason.",
    };
  }

  if (approval.status !== "approved" && approval.status !== "rejected") {
    return { allowed: false, message: `"${approval.status}" is not a decision.` };
  }

  return { allowed: true };
}

/** Hours a corrected day is worth, for the attendance record. */
export function workedMinutes(inTime: string, outTime: string): number {
  if (!HHMM.test(inTime) || !HHMM.test(outTime)) return 0;
  const minutes = minutesOf(outTime) - minutesOf(inTime);
  return minutes > 0 ? minutes : 0;
}
