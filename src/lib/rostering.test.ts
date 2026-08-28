// @vitest-environment node
//
// Rostering is where the system meets employment law. A roster that breaks
// minimum rest or exceeds weekly hours is illegal, and "the software let me"
// is not a defence — so these tests pin the constraints rather than the
// convenience.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONSTRAINTS,
  canSwap,
  generateRoster,
  isoWeekday,
  materialise,
  shiftDurationMinutes,
  validateRoster,
  type AvailableEmployee,
  type CoverageRequirement,
  type ShiftPattern,
} from "@/lib/rostering";

const day: ShiftPattern = {
  id: "day",
  name: "Day",
  startTime: "09:00",
  endTime: "17:00",
  breakMinutes: 60,
  weekdays: [1, 2, 3, 4, 5],
  isNightShift: false,
};

const night: ShiftPattern = {
  id: "night",
  name: "Night",
  startTime: "22:00",
  endTime: "06:00",
  breakMinutes: 60,
  weekdays: [1, 2, 3, 4, 5],
  isNightShift: true,
};

describe("shiftDurationMinutes", () => {
  it("computes a day shift net of break", () => {
    expect(shiftDurationMinutes("09:00", "17:00", 60)).toBe(420);
  });

  it("handles a shift crossing midnight", () => {
    // Without the roll-over a 22:00-06:00 shift reads as minus sixteen hours.
    expect(shiftDurationMinutes("22:00", "06:00", 60)).toBe(420);
  });

  it("handles a full 24-hour span", () => {
    expect(shiftDurationMinutes("08:00", "08:00", 0)).toBe(1440);
  });

  it("never returns negative when the break exceeds the shift", () => {
    expect(shiftDurationMinutes("09:00", "10:00", 120)).toBe(0);
  });

  it("rejects malformed times rather than computing nonsense", () => {
    expect(() => shiftDurationMinutes("9am", "5pm", 0)).toThrow(/HH:MM/);
  });
});

describe("materialise", () => {
  it("places a day shift on the given date", () => {
    const a = materialise(day, "2026-04-06", "emp-1");
    expect(a.startsAt.toISOString()).toBe("2026-04-06T09:00:00.000Z");
    expect(a.endsAt.toISOString()).toBe("2026-04-06T17:00:00.000Z");
    expect(a.durationMinutes).toBe(420);
  });

  it("rolls a night shift's end into the next day", () => {
    const a = materialise(night, "2026-04-06", "emp-1");
    expect(a.startsAt.toISOString()).toBe("2026-04-06T22:00:00.000Z");
    expect(a.endsAt.toISOString()).toBe("2026-04-07T06:00:00.000Z");
  });
});

describe("isoWeekday", () => {
  it("treats Monday as 1 and Sunday as 7", () => {
    expect(isoWeekday("2026-04-06")).toBe(1);
    expect(isoWeekday("2026-04-12")).toBe(7);
  });
});

describe("validateRoster", () => {
  it("accepts a normal working week", () => {
    const shifts = ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10"].map(
      (d) => materialise(day, d, "emp-1")
    );
    expect(validateRoster(shifts)).toEqual([]);
  });

  it("catches insufficient rest between shifts", () => {
    // A night shift ending 06:00 followed by a day shift at 09:00 leaves three
    // hours, well under the statutory minimum.
    const shifts = [
      materialise(night, "2026-04-06", "emp-1"),
      materialise(day, "2026-04-07", "emp-1"),
    ];

    const violations = validateRoster(shifts);
    expect(violations.map((v) => v.code)).toContain("insufficient_rest");
    expect(violations[0].severity).toBe("blocking");
    expect(violations[0].message).toMatch(/3\.0h rest/);
  });

  it("catches overlapping shifts separately from a rest breach", () => {
    // One person cannot be in two places, whatever the rest configuration.
    const first = materialise(day, "2026-04-06", "emp-1");
    const overlapping = {
      ...materialise(day, "2026-04-06", "emp-1"),
      patternId: "other",
      startsAt: new Date("2026-04-06T12:00:00Z"),
      endsAt: new Date("2026-04-06T20:00:00Z"),
    };

    const violations = validateRoster([first, overlapping]);
    expect(violations.map((v) => v.code)).toContain("overlapping_shifts");
  });

  it("catches too many shifts in one day", () => {
    const shifts = [
      materialise(day, "2026-04-06", "emp-1"),
      materialise(night, "2026-04-06", "emp-1"),
    ];
    expect(validateRoster(shifts).map((v) => v.code)).toContain("too_many_shifts_in_day");
  });

  it("measures weekly hours over a rolling window, not calendar weeks", () => {
    // Thursday to the following Wednesday breaches the limit without any
    // calendar week showing it.
    const dates = [
      "2026-04-02",
      "2026-04-03",
      "2026-04-04",
      "2026-04-05",
      "2026-04-06",
      "2026-04-07",
      "2026-04-08",
    ];
    const shifts = dates.map((d) => materialise(day, d, "emp-1"));

    const violations = validateRoster(shifts, { ...DEFAULT_CONSTRAINTS, maxHoursPerWeek: 40 });
    expect(violations.map((v) => v.code)).toContain("weekly_hours_exceeded");
  });

  it("reports a weekly breach once rather than for every overlapping window", () => {
    const dates = Array.from({ length: 10 }, (_, i) =>
      new Date(Date.UTC(2026, 3, 6 + i)).toISOString().slice(0, 10)
    );
    const shifts = dates.map((d) => materialise(day, d, "emp-1"));

    const weekly = validateRoster(shifts, {
      ...DEFAULT_CONSTRAINTS,
      maxHoursPerWeek: 40,
      maxConsecutiveDays: 30,
    }).filter((v) => v.code === "weekly_hours_exceeded");

    expect(weekly).toHaveLength(1);
  });

  it("catches too many consecutive days", () => {
    const dates = Array.from({ length: 8 }, (_, i) =>
      new Date(Date.UTC(2026, 3, 6 + i)).toISOString().slice(0, 10)
    );
    const shifts = dates.map((d) => materialise(day, d, "emp-1"));

    const violations = validateRoster(shifts, {
      ...DEFAULT_CONSTRAINTS,
      maxHoursPerWeek: 1000,
    });
    expect(violations.map((v) => v.code)).toContain("consecutive_days_exceeded");
  });

  it("does not count a break in the run as consecutive", () => {
    const shifts = [
      materialise(day, "2026-04-06", "emp-1"),
      materialise(day, "2026-04-07", "emp-1"),
      // Gap.
      materialise(day, "2026-04-10", "emp-1"),
      materialise(day, "2026-04-11", "emp-1"),
    ];
    expect(
      validateRoster(shifts, { ...DEFAULT_CONSTRAINTS, maxConsecutiveDays: 3 })
    ).toEqual([]);
  });

  it("flags a week with no rest day as a warning", () => {
    const dates = Array.from({ length: 7 }, (_, i) =>
      new Date(Date.UTC(2026, 3, 6 + i)).toISOString().slice(0, 10)
    );
    const shifts = dates.map((d) => materialise(day, d, "emp-1"));

    const violations = validateRoster(shifts, {
      ...DEFAULT_CONSTRAINTS,
      maxHoursPerWeek: 1000,
      maxConsecutiveDays: 30,
    });
    const restDay = violations.find((v) => v.code === "no_rest_day");
    expect(restDay?.severity).toBe("warning");
  });

  it("flags someone rostered while unavailable", () => {
    const shifts = [materialise(day, "2026-04-06", "emp-1")];
    const violations = validateRoster(shifts, DEFAULT_CONSTRAINTS, [
      { employeeId: "emp-1", date: "2026-04-06", reason: "on approved leave" },
    ]);

    expect(violations[0].code).toBe("unavailable");
    expect(violations[0].message).toContain("on approved leave");
  });

  it("reports every violation rather than stopping at the first", () => {
    // A manager fixing a roster needs the whole picture; resolving one problem
    // often creates another.
    const shifts = [
      materialise(night, "2026-04-06", "emp-1"),
      materialise(day, "2026-04-07", "emp-1"),
    ];
    const violations = validateRoster(shifts, DEFAULT_CONSTRAINTS, [
      { employeeId: "emp-1", date: "2026-04-06", reason: "sick" },
    ]);

    expect(violations.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps each employee's constraints separate", () => {
    const shifts = [
      materialise(night, "2026-04-06", "emp-1"),
      materialise(day, "2026-04-07", "emp-2"),
    ];
    expect(validateRoster(shifts)).toEqual([]);
  });
});

describe("generateRoster", () => {
  const staff: AvailableEmployee[] = [
    {
      employeeId: "emp-1",
      eligiblePatternIds: ["day"],
      unavailableDates: [],
      contractedHoursPerWeek: 40,
    },
    {
      employeeId: "emp-2",
      eligiblePatternIds: ["day"],
      unavailableDates: [],
      contractedHoursPerWeek: 40,
    },
  ];

  it("fills a requirement", () => {
    const requirements: CoverageRequirement[] = [
      { date: "2026-04-06", patternId: "day", headcount: 2 },
    ];

    const result = generateRoster(requirements, staff, [day]);
    expect(result.assignments).toHaveLength(2);
    expect(result.unfilled).toEqual([]);
    expect(result.violations).toEqual([]);
  });

  it("reports a shortfall rather than returning nothing", () => {
    // A manager with 90% of a roster and a clear gap list can act; "infeasible"
    // cannot be acted on.
    const requirements: CoverageRequirement[] = [
      { date: "2026-04-06", patternId: "day", headcount: 5 },
    ];

    const result = generateRoster(requirements, staff, [day]);
    expect(result.assignments).toHaveLength(2);
    expect(result.unfilled[0]).toMatchObject({ shortfall: 3 });
  });

  it("skips people who are unavailable", () => {
    const result = generateRoster(
      [{ date: "2026-04-06", patternId: "day", headcount: 2 }],
      [staff[0], { ...staff[1], unavailableDates: ["2026-04-06"] }],
      [day]
    );

    expect(result.assignments.map((a) => a.employeeId)).toEqual(["emp-1"]);
    expect(result.unfilled[0].shortfall).toBe(1);
  });

  it("skips people not eligible for the pattern", () => {
    const result = generateRoster(
      [{ date: "2026-04-06", patternId: "night", headcount: 1 }],
      staff,
      [day, night]
    );

    expect(result.assignments).toHaveLength(0);
    expect(result.unfilled[0].reason).toMatch(/Nobody eligible/);
  });

  it("reports an unknown pattern instead of silently skipping it", () => {
    const result = generateRoster(
      [{ date: "2026-04-06", patternId: "ghost", headcount: 1 }],
      staff,
      [day]
    );
    expect(result.unfilled[0].reason).toBe("No such shift pattern");
  });

  it("never produces a roster that breaks a blocking constraint", () => {
    // Candidates are trial-validated before assignment; checking afterwards
    // would produce a roster the manager must unpick.
    const dates = Array.from({ length: 10 }, (_, i) =>
      new Date(Date.UTC(2026, 3, 6 + i)).toISOString().slice(0, 10)
    );
    const requirements = dates.map((date) => ({ date, patternId: "day", headcount: 1 }));

    const result = generateRoster(requirements, [staff[0]], [day], {
      ...DEFAULT_CONSTRAINTS,
      maxConsecutiveDays: 3,
    });

    expect(result.violations.filter((v) => v.severity === "blocking")).toEqual([]);
    expect(result.unfilled.length).toBeGreaterThan(0);
  });

  it("spreads work rather than exhausting the first person listed", () => {
    const requirements = [
      { date: "2026-04-06", patternId: "day", headcount: 1 },
      { date: "2026-04-07", patternId: "day", headcount: 1 },
    ];

    const result = generateRoster(requirements, staff, [day]);
    const perEmployee = new Set(result.assignments.map((a) => a.employeeId));
    expect(perEmployee.size).toBe(2);
  });

  it("does not roster the same person twice in a day", () => {
    const result = generateRoster(
      [
        { date: "2026-04-06", patternId: "day", headcount: 1 },
        { date: "2026-04-06", patternId: "night", headcount: 1 },
      ],
      [{ ...staff[0], eligiblePatternIds: ["day", "night"] }],
      [day, night]
    );

    expect(result.assignments).toHaveLength(1);
  });
});

describe("canSwap", () => {
  it("allows a swap that leaves both schedules legal", () => {
    const assignments = [materialise(day, "2026-04-06", "emp-1")];
    expect(canSwap(assignments, assignments[0], "emp-2")).toEqual({ allowed: true });
  });

  it("refuses a swap that would breach the receiver's rest", () => {
    // Both parties agreeing does not make an illegal roster legal.
    const assignments = [
      materialise(night, "2026-04-06", "emp-2"),
      materialise(day, "2026-04-07", "emp-1"),
    ];

    const verdict = canSwap(assignments, assignments[1], "emp-2");
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.violations[0].code).toBe("insufficient_rest");
    }
  });

  it("refuses swapping with yourself", () => {
    const assignments = [materialise(day, "2026-04-06", "emp-1")];
    const verdict = canSwap(assignments, assignments[0], "emp-1");
    expect(verdict.allowed).toBe(false);
  });

  it("refuses a swap onto a date the receiver is unavailable", () => {
    const assignments = [materialise(day, "2026-04-06", "emp-1")];
    const verdict = canSwap(assignments, assignments[0], "emp-2", DEFAULT_CONSTRAINTS, [
      { employeeId: "emp-2", date: "2026-04-06", reason: "on leave" },
    ]);

    expect(verdict.allowed).toBe(false);
  });
});
