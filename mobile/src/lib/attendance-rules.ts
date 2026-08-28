// ═══════════════════════════════════════════════════════════════
// ATTENDANCE RULES — month navigation and the vocabulary of a punch
// ═══════════════════════════════════════════════════════════════
// Pure and tested. Two things here are worth more than they look.
//
// The month cursor cannot be moved into the future. A future month has no
// records, and a summary built from no records reports zero present days —
// which renders as "you were absent for all of it". The absence of data and a
// month of absence are different facts and the screen must not confuse them.
//
// The average is guarded against a zero divisor. The payroll engine shipped
// with exactly this defect: a month with no working days produced Infinity,
// which multiplied to NaN and reached a bank payment instruction.

export interface MonthCursor {
  year: number;
  month: number;
}

export interface AttendanceSummary {
  employeeId: string;
  month: number;
  year: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  halfDays: number;
  leaveDays: number;
  wfhDays: number;
  totalWorkedMinutes: number;
  totalOvertimeMinutes: number;
}

export interface AttendanceRecord {
  id: string;
  workDate: string;
  clockInAt?: string;
  clockOutAt?: string;
  status: string;
  workedMinutes?: number;
  overtimeMinutes: number;
  lateByMinutes: number;
  requiresLocationReview: boolean;
  isRegularized: boolean;
}

/** How a status should read, and how it should be coloured. */
export type StatusTone = "success" | "warning" | "danger" | "neutral";

const STATUS_LABEL: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  half_day: "Half day",
  on_leave: "On leave",
  wfh: "Working from home",
  holiday: "Holiday",
  weekend: "Weekend",
};

const STATUS_TONE: Record<string, StatusTone> = {
  present: "success",
  wfh: "success",
  late: "warning",
  half_day: "warning",
  on_leave: "neutral",
  holiday: "neutral",
  weekend: "neutral",
  absent: "danger",
};

/**
 * A status the server sent that this build does not know about.
 *
 * Rendered as its own raw value made readable, not as "Unknown" and not
 * hidden. A status the app cannot name is still the truth about someone's
 * attendance, and swallowing it would leave a blank row where a fact belongs.
 */
export function statusLabel(status: string): string {
  const known = STATUS_LABEL[status];
  if (known) return known;
  const spaced = status.replace(/_/g, " ").trim();
  if (!spaced) return "Unrecorded";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Unknown statuses are neutral: a colour guess on attendance data is a lie. */
export function statusTone(status: string): StatusTone {
  return STATUS_TONE[status] ?? "neutral";
}

/** The current month, in the device's own timezone. */
export function currentMonth(now: Date = new Date()): MonthCursor {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** The first and last calendar date of a month, as YYYY-MM-DD. */
export function monthRange(cursor: MonthCursor): { from: string; to: string } {
  const month = String(cursor.month).padStart(2, "0");
  // Day 0 of the next month is the last day of this one, which handles leap
  // years without a table.
  const last = new Date(Date.UTC(cursor.year, cursor.month, 0)).getUTCDate();
  return {
    from: `${cursor.year}-${month}-01`,
    to: `${cursor.year}-${month}-${String(last).padStart(2, "0")}`,
  };
}

export function previousMonth(cursor: MonthCursor): MonthCursor {
  return cursor.month === 1
    ? { year: cursor.year - 1, month: 12 }
    : { year: cursor.year, month: cursor.month - 1 };
}

export function nextMonth(cursor: MonthCursor): MonthCursor {
  return cursor.month === 12
    ? { year: cursor.year + 1, month: 1 }
    : { year: cursor.year, month: cursor.month + 1 };
}

/** Ordering helper, so two cursors can be compared without building dates. */
function ordinal(cursor: MonthCursor): number {
  return cursor.year * 12 + cursor.month;
}

/**
 * Whether the forward control should be live.
 *
 * The current month is the last one that can be reached. Beyond it there is
 * nothing to show, and an enabled control that produces an empty screen is
 * indistinguishable from a broken one.
 */
export function canGoForward(cursor: MonthCursor, now: Date = new Date()): boolean {
  return ordinal(cursor) < ordinal(currentMonth(now));
}

/** Clamps a cursor to the current month, for anything that computes one. */
export function clampToPresent(cursor: MonthCursor, now: Date = new Date()): MonthCursor {
  const present = currentMonth(now);
  return ordinal(cursor) > ordinal(present) ? present : cursor;
}

/** "March 2026", in the device's locale. */
export function monthLabel(cursor: MonthCursor): string {
  const at = new Date(Date.UTC(cursor.year, cursor.month - 1, 1));
  if (Number.isNaN(at.getTime())) return `${cursor.year}-${cursor.month}`;
  return at.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

/**
 * Average minutes worked per day the person was actually present.
 *
 * Returns undefined, not zero, when there were no present days. Zero is a
 * measurement — "you averaged no hours" — and this is the absence of one.
 */
export function averageWorkedMinutes(summary: AttendanceSummary): number | undefined {
  const days = summary.presentDays;
  if (!Number.isFinite(days) || days <= 0) return undefined;
  if (!Number.isFinite(summary.totalWorkedMinutes)) return undefined;
  return Math.round(summary.totalWorkedMinutes / days);
}

/**
 * Days in the month that are accounted for by some record.
 *
 * Half days count once. They are one day on which the person attended, and
 * counting them as a half would make the total disagree with the row count
 * that the same screen shows underneath it.
 */
export function accountedDays(summary: AttendanceSummary): number {
  return (
    summary.presentDays +
    summary.absentDays +
    summary.halfDays +
    summary.leaveDays +
    summary.wfhDays
  );
}
