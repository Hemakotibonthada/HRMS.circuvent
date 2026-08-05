// ═══════════════════════════════════════════════════════════════
// ROSTERING ENGINE
// ═══════════════════════════════════════════════════════════════
// Generates and validates shift schedules. Pure, so the constraint logic is
// testable without a database.
//
// Rostering is where an HR system meets employment law. The constraints are
// not preferences — a roster that breaks minimum rest or exceeds weekly hours
// is illegal in most jurisdictions, and "the software let me" is not a
// defence. So the engine reports violations rather than silently producing a
// schedule that looks fine.
//
// The other reason to keep this pure: a manager needs to see *why* a roster is
// invalid before publishing it, not discover it when someone is already
// working the shift.

export interface ShiftPattern {
  id: string;
  name: string;
  /** Local start time, HH:MM. */
  startTime: string;
  endTime: string;
  breakMinutes: number;
  /** ISO weekday numbers this pattern runs on, 1 = Monday. */
  weekdays: number[];
  /** Crosses midnight, so the end time is on the following day. */
  isNightShift: boolean;
}

export interface RosterAssignment {
  employeeId: string;
  date: string;
  patternId: string;
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
}

export interface RosterConstraints {
  /** Minimum hours between the end of one shift and the start of the next. */
  minRestHours: number;
  maxHoursPerWeek: number;
  maxConsecutiveDays: number;
  /** Shifts a single employee may work in one day. */
  maxShiftsPerDay: number;
  /** Whole days off required in any seven-day window. */
  minDaysOffPerWeek: number;
}

export const DEFAULT_CONSTRAINTS: RosterConstraints = {
  // Eleven hours is the EU Working Time Directive's daily rest minimum and a
  // common statutory floor elsewhere; it is a safe default rather than a
  // generous one.
  minRestHours: 11,
  maxHoursPerWeek: 48,
  maxConsecutiveDays: 6,
  maxShiftsPerDay: 1,
  minDaysOffPerWeek: 1,
};

export type ViolationCode =
  | "insufficient_rest"
  | "weekly_hours_exceeded"
  | "consecutive_days_exceeded"
  | "too_many_shifts_in_day"
  | "no_rest_day"
  | "overlapping_shifts"
  | "unavailable";

export interface Violation {
  code: ViolationCode;
  employeeId: string;
  /** The date the problem occurs, or the first date of the window. */
  date: string;
  /** Written for the manager fixing it, with the numbers that triggered it. */
  message: string;
  severity: "blocking" | "warning";
}

/** Minutes between two clock times, accounting for a shift crossing midnight. */
export function shiftDurationMinutes(
  startTime: string,
  endTime: string,
  breakMinutes: number
): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);

  if ([sh, sm, eh, em].some(Number.isNaN)) {
    throw new Error("Shift times must be HH:MM");
  }

  const start = sh * 60 + sm;
  let end = eh * 60 + em;
  // A night shift's end is numerically before its start; without this a 22:00
  // to 06:00 shift reads as minus sixteen hours.
  if (end <= start) end += 24 * 60;

  return Math.max(0, end - start - breakMinutes);
}

/** Builds the concrete instants a pattern occupies on a given date. */
export function materialise(
  pattern: ShiftPattern,
  date: string,
  employeeId: string
): RosterAssignment {
  const [sh, sm] = pattern.startTime.split(":").map(Number);
  const [eh, em] = pattern.endTime.split(":").map(Number);

  const startsAt = new Date(`${date}T00:00:00Z`);
  startsAt.setUTCHours(sh, sm, 0, 0);

  const endsAt = new Date(`${date}T00:00:00Z`);
  endsAt.setUTCHours(eh, em, 0, 0);
  // Roll the end into the next day for a shift that crosses midnight.
  if (endsAt <= startsAt) endsAt.setUTCDate(endsAt.getUTCDate() + 1);

  return {
    employeeId,
    date,
    patternId: pattern.id,
    startsAt,
    endsAt,
    durationMinutes: shiftDurationMinutes(
      pattern.startTime,
      pattern.endTime,
      pattern.breakMinutes
    ),
  };
}

/** ISO weekday, 1 = Monday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Validates a set of assignments against the constraints.
 *
 * Returns every violation rather than the first, because a manager fixing a
 * roster needs the whole picture — resolving one problem often creates
 * another, and discovering them one at a time is how a roster takes an
 * afternoon.
 */
export function validateRoster(
  assignments: RosterAssignment[],
  constraints: RosterConstraints = DEFAULT_CONSTRAINTS,
  unavailable: { employeeId: string; date: string; reason: string }[] = []
): Violation[] {
  const violations: Violation[] = [];
  const byEmployee = new Map<string, RosterAssignment[]>();

  for (const assignment of assignments) {
    const list = byEmployee.get(assignment.employeeId) ?? [];
    list.push(assignment);
    byEmployee.set(assignment.employeeId, list);
  }

  const unavailableSet = new Set(unavailable.map((u) => `${u.employeeId}|${u.date}`));

  for (const [employeeId, shifts] of byEmployee) {
    const sorted = [...shifts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    // ── Availability ──
    for (const shift of sorted) {
      if (unavailableSet.has(`${employeeId}|${shift.date}`)) {
        const reason =
          unavailable.find((u) => u.employeeId === employeeId && u.date === shift.date)
            ?.reason ?? "unavailable";
        violations.push({
          code: "unavailable",
          employeeId,
          date: shift.date,
          message: `Rostered while ${reason}`,
          severity: "blocking",
        });
      }
    }

    // ── Shifts per day and overlaps ──
    const perDay = new Map<string, RosterAssignment[]>();
    for (const shift of sorted) {
      const list = perDay.get(shift.date) ?? [];
      list.push(shift);
      perDay.set(shift.date, list);
    }

    for (const [date, dayShifts] of perDay) {
      if (dayShifts.length > constraints.maxShiftsPerDay) {
        violations.push({
          code: "too_many_shifts_in_day",
          employeeId,
          date,
          message: `${dayShifts.length} shifts on one day, limit is ${constraints.maxShiftsPerDay}`,
          severity: "blocking",
        });
      }
    }

    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];

      // A genuine overlap means one person is in two places, which no amount
      // of rest configuration makes acceptable.
      if (current.startsAt < previous.endsAt) {
        violations.push({
          code: "overlapping_shifts",
          employeeId,
          date: current.date,
          message: "This shift overlaps the previous one",
          severity: "blocking",
        });
        continue;
      }

      const restHours =
        (current.startsAt.getTime() - previous.endsAt.getTime()) / 3_600_000;

      if (restHours < constraints.minRestHours) {
        violations.push({
          code: "insufficient_rest",
          employeeId,
          date: current.date,
          message: `Only ${restHours.toFixed(1)}h rest after the previous shift, minimum is ${constraints.minRestHours}h`,
          severity: "blocking",
        });
      }
    }

    // ── Weekly hours, over a rolling seven-day window ──
    // Rolling rather than calendar weeks: someone working every day from
    // Thursday to Wednesday breaches the limit without any calendar week
    // showing it.
    const dates = [...new Set(sorted.map((s) => s.date))].sort();
    for (const start of dates) {
      const end = addDays(start, 6);
      const inWindow = sorted.filter((s) => s.date >= start && s.date <= end);
      const hours = inWindow.reduce((sum, s) => sum + s.durationMinutes, 0) / 60;

      if (hours > constraints.maxHoursPerWeek) {
        violations.push({
          code: "weekly_hours_exceeded",
          employeeId,
          date: start,
          message: `${hours.toFixed(1)}h in the seven days from ${start}, limit is ${constraints.maxHoursPerWeek}h`,
          severity: "blocking",
        });
        // One report per employee: every overlapping window would otherwise
        // fire and bury the rest of the output.
        break;
      }
    }

    // ── Consecutive days ──
    let run = 0;
    let runStart = dates[0];
    for (let i = 0; i < dates.length; i++) {
      if (i > 0 && dates[i] !== addDays(dates[i - 1], 1)) {
        run = 0;
        runStart = dates[i];
      }
      run++;

      if (run > constraints.maxConsecutiveDays) {
        violations.push({
          code: "consecutive_days_exceeded",
          employeeId,
          date: runStart,
          message: `${run} consecutive days from ${runStart}, limit is ${constraints.maxConsecutiveDays}`,
          severity: "blocking",
        });
        break;
      }
    }

    // ── Rest days ──
    if (dates.length >= 7) {
      for (const start of dates) {
        const end = addDays(start, 6);
        const worked = new Set(dates.filter((d) => d >= start && d <= end));
        const daysOff = 7 - worked.size;

        if (daysOff < constraints.minDaysOffPerWeek) {
          violations.push({
            code: "no_rest_day",
            employeeId,
            date: start,
            message: `No rest day in the seven days from ${start}`,
            severity: "warning",
          });
          break;
        }
      }
    }
  }

  return violations;
}

// ─── Generation ──────────────────────────────────────────────

export interface CoverageRequirement {
  date: string;
  patternId: string;
  /** How many people must be on this shift. */
  headcount: number;
}

export interface AvailableEmployee {
  employeeId: string;
  /** Patterns this person is trained or contracted for. */
  eligiblePatternIds: string[];
  /** Dates they cannot work: leave, training, existing commitments. */
  unavailableDates: string[];
  /** Contracted hours, used to balance allocation. */
  contractedHoursPerWeek: number;
}

export interface GenerationResult {
  assignments: RosterAssignment[];
  /** Requirements that could not be filled, and why. */
  unfilled: { date: string; patternId: string; shortfall: number; reason: string }[];
  violations: Violation[];
}

/**
 * Generates a roster from coverage requirements.
 *
 * Deliberately a greedy allocator that reports what it could not fill, rather
 * than a solver that returns nothing when the problem is over-constrained. A
 * manager with 90% of a roster and a clear list of the gaps can act; an empty
 * result with "infeasible" cannot be acted on at all.
 *
 * Allocation prefers whoever is furthest below their contracted hours, which
 * spreads work rather than exhausting the first name in the list.
 */
export function generateRoster(
  requirements: CoverageRequirement[],
  employees: AvailableEmployee[],
  patterns: ShiftPattern[],
  constraints: RosterConstraints = DEFAULT_CONSTRAINTS
): GenerationResult {
  const patternById = new Map(patterns.map((p) => [p.id, p]));
  const assignments: RosterAssignment[] = [];
  const unfilled: GenerationResult["unfilled"] = [];
  const assignedMinutes = new Map<string, number>();

  const sorted = [...requirements].sort(
    (a, b) => a.date.localeCompare(b.date) || a.patternId.localeCompare(b.patternId)
  );

  for (const requirement of sorted) {
    const pattern = patternById.get(requirement.patternId);
    if (!pattern) {
      unfilled.push({
        date: requirement.date,
        patternId: requirement.patternId,
        shortfall: requirement.headcount,
        reason: "No such shift pattern",
      });
      continue;
    }

    const candidates = employees
      .filter((e) => e.eligiblePatternIds.includes(pattern.id))
      .filter((e) => !e.unavailableDates.includes(requirement.date))
      .filter(
        (e) =>
          // Already on a shift that day.
          !assignments.some(
            (a) => a.employeeId === e.employeeId && a.date === requirement.date
          )
      )
      .filter((e) => {
        // Provisionally add the shift and reject the candidate if it would
        // break a rule. Checking after generating would produce a roster the
        // manager must then unpick.
        const trial = materialise(pattern, requirement.date, e.employeeId);
        const theirs = assignments.filter((a) => a.employeeId === e.employeeId);
        return (
          validateRoster([...theirs, trial], constraints).filter(
            (v) => v.severity === "blocking"
          ).length === 0
        );
      })
      // Whoever is furthest below their contracted hours goes first.
      .sort((a, b) => {
        const aUsed = (assignedMinutes.get(a.employeeId) ?? 0) / 60;
        const bUsed = (assignedMinutes.get(b.employeeId) ?? 0) / 60;
        return aUsed / a.contractedHoursPerWeek - bUsed / b.contractedHoursPerWeek;
      });

    const taking = candidates.slice(0, requirement.headcount);

    for (const employee of taking) {
      const assignment = materialise(pattern, requirement.date, employee.employeeId);
      assignments.push(assignment);
      assignedMinutes.set(
        employee.employeeId,
        (assignedMinutes.get(employee.employeeId) ?? 0) + assignment.durationMinutes
      );
    }

    if (taking.length < requirement.headcount) {
      unfilled.push({
        date: requirement.date,
        patternId: requirement.patternId,
        shortfall: requirement.headcount - taking.length,
        reason:
          candidates.length === 0
            ? "Nobody eligible and available"
            : "Not enough eligible people available",
      });
    }
  }

  return { assignments, unfilled, violations: validateRoster(assignments, constraints) };
}

// ─── Shift swaps ─────────────────────────────────────────────

export type SwapVerdict =
  | { allowed: true }
  | { allowed: false; reason: string; violations: Violation[] };

/**
 * Whether two employees may exchange shifts.
 *
 * Checked against both people's resulting schedules. A swap that suits the two
 * of them but leaves one without legal rest is still illegal, and approving it
 * because both agreed does not change that.
 */
export function canSwap(
  assignments: RosterAssignment[],
  fromAssignment: RosterAssignment,
  toEmployeeId: string,
  constraints: RosterConstraints = DEFAULT_CONSTRAINTS,
  unavailable: { employeeId: string; date: string; reason: string }[] = []
): SwapVerdict {
  if (fromAssignment.employeeId === toEmployeeId) {
    return { allowed: false, reason: "You cannot swap a shift with yourself", violations: [] };
  }

  const swapped = assignments.map((a) =>
    a === fromAssignment || (a.employeeId === fromAssignment.employeeId && a.date === fromAssignment.date && a.patternId === fromAssignment.patternId)
      ? { ...a, employeeId: toEmployeeId }
      : a
  );

  const blocking = validateRoster(swapped, constraints, unavailable).filter(
    (v) => v.severity === "blocking" && v.employeeId === toEmployeeId
  );

  if (blocking.length > 0) {
    return {
      allowed: false,
      reason: blocking[0].message,
      violations: blocking,
    };
  }

  return { allowed: true };
}
