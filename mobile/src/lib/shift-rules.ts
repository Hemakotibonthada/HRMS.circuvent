// ═══════════════════════════════════════════════════════════════
// SHIFT RULES — grouping, ordering and labelling a published roster
// ═══════════════════════════════════════════════════════════════
// Pure and tested, for the same reason as leave-rules.ts: this is the logic
// that decides what someone believes about when they are next expected at
// work, and a screen is a poor place to keep it.
//
// Two kinds of value arrive from /api/roster/my-shifts and they are not
// interchangeable:
//
//   * `shiftDate` is a calendar date, YYYY-MM-DD, and is compared as a string.
//     Turning it into a Date to compare it reintroduces the bug leave-rules.ts
//     documents — UTC midnight reads as the previous day west of Greenwich.
//   * `startsAt` and `endsAt` are instants, already ISO-8601 with an offset.
//     Those are compared as instants, because "has this shift started" is a
//     question about a moment in time and not about a calendar.
//
// Mixing the two is how a night shift ends up on the wrong day.

/** One published assignment, as returned by GET /api/roster/my-shifts. */
export interface ShiftAssignment {
  id: string;
  shiftDate: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: string;
  patternName?: string;
  patternColour?: string;
  note?: string;
}

export interface ShiftDay {
  /** YYYY-MM-DD. */
  date: string;
  shifts: ShiftAssignment[];
  totalMinutes: number;
}

export type ShiftState = "in_progress" | "upcoming" | "past";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Where a shift sits relative to now.
 *
 * `in_progress` is checked before `upcoming` deliberately. Someone halfway
 * through a night shift asking what is next should be told about the shift
 * they are standing in, not the one after it.
 *
 * An unparseable timestamp is reported as `past` rather than thrown on: it
 * drops off the top of the screen instead of blanking it, and the server is
 * the authority on the roster either way.
 */
export function shiftState(shift: ShiftAssignment, now: Date = new Date()): ShiftState {
  const starts = Date.parse(shift.startsAt);
  const ends = Date.parse(shift.endsAt);
  if (Number.isNaN(starts) || Number.isNaN(ends)) return "past";

  const at = now.getTime();
  if (at >= ends) return "past";
  if (at >= starts) return "in_progress";
  return "upcoming";
}

/**
 * The shift the person needs to know about: the one running now, or the next
 * one to start.
 *
 * Returns undefined when the roster holds nothing ahead — which the caller
 * must render as "nothing scheduled" rather than as an empty row. A blank
 * where a time should be reads as a loading failure.
 */
export function nextShift(
  shifts: readonly ShiftAssignment[],
  now: Date = new Date()
): ShiftAssignment | undefined {
  let best: ShiftAssignment | undefined;
  let bestStart = Number.POSITIVE_INFINITY;
  let running: ShiftAssignment | undefined;
  let runningStart = Number.POSITIVE_INFINITY;

  for (const shift of shifts) {
    const state = shiftState(shift, now);
    if (state === "past") continue;

    const starts = Date.parse(shift.startsAt);
    if (Number.isNaN(starts)) continue;

    if (state === "in_progress") {
      // Overlapping assignments are possible on a badly built roster. The one
      // that started most recently is the one being worked.
      if (running === undefined || starts > runningStart) {
        running = shift;
        runningStart = starts;
      }
      continue;
    }

    if (starts < bestStart) {
      best = shift;
      bestStart = starts;
    }
  }

  return running ?? best;
}

/**
 * Groups assignments by their calendar date, earliest day first and each day's
 * shifts in start order.
 *
 * Grouped on `shiftDate` rather than on the date part of `startsAt`. A shift
 * beginning at 22:00 belongs to the day it was rostered for, which is the day
 * the person was told to come in; deriving the day from the start instant puts
 * half of a night rota on one date and half on another.
 */
export function groupByDay(shifts: readonly ShiftAssignment[]): ShiftDay[] {
  const days = new Map<string, ShiftAssignment[]>();

  for (const shift of shifts) {
    const existing = days.get(shift.shiftDate);
    if (existing) existing.push(shift);
    else days.set(shift.shiftDate, [shift]);
  }

  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, entries]) => {
      const ordered = [...entries].sort((a, b) => {
        const left = Date.parse(a.startsAt);
        const right = Date.parse(b.startsAt);
        if (Number.isNaN(left) || Number.isNaN(right)) return 0;
        return left - right;
      });

      return {
        date,
        shifts: ordered,
        totalMinutes: ordered.reduce((sum, shift) => sum + shift.durationMinutes, 0),
      };
    });
}

/**
 * True when the shift finishes on a later calendar day than it starts.
 *
 * Compared in the device's own timezone, because the question being answered
 * is the one the person on the shift would ask: do I go home tomorrow.
 */
export function isOvernight(shift: ShiftAssignment): boolean {
  const starts = new Date(shift.startsAt);
  const ends = new Date(shift.endsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return false;

  return (
    starts.getFullYear() !== ends.getFullYear() ||
    starts.getMonth() !== ends.getMonth() ||
    starts.getDate() !== ends.getDate()
  );
}

/**
 * Human duration for a count of minutes.
 *
 * Negative and non-finite inputs collapse to an em dash rather than rendering
 * "-1h 0m" or "NaNh". A duration is a fact about a shift; if it cannot be
 * stated it should be visibly absent, not wrong.
 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "—";

  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;

  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/**
 * Day heading: "Today", "Tomorrow", "Yesterday", or a written date.
 *
 * Both arguments are YYYY-MM-DD and are compared as strings. `today` is passed
 * in rather than read from the clock so the caller decides which timezone the
 * word "today" refers to, and so this is testable without freezing time.
 */
export function dayLabel(date: string, today: string): string {
  if (!ISO_DATE.test(date)) return date;
  if (date === today) return "Today";

  if (ISO_DATE.test(today)) {
    if (date === addDays(today, 1)) return "Tomorrow";
    if (date === addDays(today, -1)) return "Yesterday";
  }

  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;

  // Formatted in UTC, matching the UTC midnight it was parsed at. Letting it
  // fall back to the device zone shifts the weekday by one for half the world.
  return parsed.toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** A calendar date shifted by whole days, staying in YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed)) return date;
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

/** Clock time for an instant, e.g. "09:00". */
export function formatClock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
