import { describe, expect, it } from "vitest";
import {
  accountedDays,
  averageWorkedMinutes,
  canGoForward,
  clampToPresent,
  currentMonth,
  monthLabel,
  monthRange,
  nextMonth,
  previousMonth,
  statusLabel,
  statusTone,
  type AttendanceSummary,
} from "./attendance-rules";

function summary(overrides: Partial<AttendanceSummary> = {}): AttendanceSummary {
  return {
    employeeId: "e1",
    month: 3,
    year: 2026,
    presentDays: 20,
    absentDays: 1,
    lateDays: 2,
    halfDays: 1,
    leaveDays: 2,
    wfhDays: 3,
    totalWorkedMinutes: 9600,
    totalOvertimeMinutes: 120,
    ...overrides,
  };
}

const NOW = new Date("2026-03-10T12:00:00.000Z");

describe("monthRange", () => {
  it("spans a whole 31-day month", () => {
    expect(monthRange({ year: 2026, month: 3 })).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
    });
  });

  it("ends February on the 28th in a common year and the 29th in a leap year", () => {
    expect(monthRange({ year: 2026, month: 2 }).to).toBe("2026-02-28");
    expect(monthRange({ year: 2028, month: 2 }).to).toBe("2028-02-29");
  });

  it("pads single-digit months so the range is a valid ISO date", () => {
    // An unpadded "2026-1-01" is rejected by the API's own date regex, so this
    // is the difference between a working screen and a 400.
    expect(monthRange({ year: 2026, month: 1 })).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });
});

describe("month arithmetic", () => {
  it("steps back across a year boundary", () => {
    expect(previousMonth({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 });
  });

  it("steps forward across a year boundary", () => {
    expect(nextMonth({ year: 2026, month: 12 })).toEqual({ year: 2027, month: 1 });
  });

  it("steps within a year", () => {
    expect(previousMonth({ year: 2026, month: 3 })).toEqual({ year: 2026, month: 2 });
    expect(nextMonth({ year: 2026, month: 3 })).toEqual({ year: 2026, month: 4 });
  });
});

describe("canGoForward", () => {
  it("is false in the current month", () => {
    expect(canGoForward(currentMonth(NOW), NOW)).toBe(false);
  });

  it("is true in any earlier month", () => {
    expect(canGoForward({ year: 2026, month: 2 }, NOW)).toBe(true);
    expect(canGoForward({ year: 2025, month: 12 }, NOW)).toBe(true);
  });

  it("is false beyond the current month", () => {
    // A future month has no records, and a summary of no records reads as a
    // month of absence. The control must not be reachable.
    expect(canGoForward({ year: 2026, month: 4 }, NOW)).toBe(false);
    expect(canGoForward({ year: 2027, month: 1 }, NOW)).toBe(false);
  });

  it("compares months across years rather than month numbers", () => {
    // December 2025 is before March 2026 despite 12 being greater than 3.
    expect(canGoForward({ year: 2025, month: 12 }, NOW)).toBe(true);
  });
});

describe("clampToPresent", () => {
  it("leaves a past month alone", () => {
    expect(clampToPresent({ year: 2025, month: 11 }, NOW)).toEqual({ year: 2025, month: 11 });
  });

  it("pulls a future month back to the current one", () => {
    expect(clampToPresent({ year: 2030, month: 6 }, NOW)).toEqual({ year: 2026, month: 3 });
  });
});

describe("monthLabel", () => {
  it("names the month it was given, not the one before it", () => {
    // Built at UTC midnight on the first; formatting in the device zone would
    // report the previous month for anyone west of Greenwich.
    expect(monthLabel({ year: 2026, month: 3 })).toMatch(/March/);
    expect(monthLabel({ year: 2026, month: 1 })).toMatch(/January/);
  });

  it("includes the year, so two Marches are distinguishable", () => {
    expect(monthLabel({ year: 2026, month: 3 })).toMatch(/2026/);
  });
});

describe("averageWorkedMinutes", () => {
  it("divides the month's minutes by the days actually present", () => {
    expect(averageWorkedMinutes(summary({ presentDays: 20, totalWorkedMinutes: 9600 }))).toBe(480);
  });

  it("rounds to a whole minute", () => {
    expect(averageWorkedMinutes(summary({ presentDays: 3, totalWorkedMinutes: 100 }))).toBe(33);
  });

  it("returns nothing rather than Infinity when no days were present", () => {
    // The payroll engine shipped with this exact defect: a zero divisor became
    // Infinity, then NaN, and reached a payment instruction.
    expect(averageWorkedMinutes(summary({ presentDays: 0 }))).toBeUndefined();
  });

  it("returns nothing for a negative or non-finite input", () => {
    expect(averageWorkedMinutes(summary({ presentDays: -3 }))).toBeUndefined();
    expect(
      averageWorkedMinutes(summary({ totalWorkedMinutes: Number.NaN }))
    ).toBeUndefined();
  });
});

describe("accountedDays", () => {
  it("adds up every kind of accounted day", () => {
    expect(
      accountedDays(
        summary({ presentDays: 20, absentDays: 1, halfDays: 1, leaveDays: 2, wfhDays: 3 })
      )
    ).toBe(27);
  });

  it("does not add late days twice", () => {
    // The server folds late days into presentDays. Adding lateDays as well
    // would report more accounted days than the month contains.
    const value = accountedDays(
      summary({
        presentDays: 20,
        lateDays: 5,
        absentDays: 0,
        halfDays: 0,
        leaveDays: 0,
        wfhDays: 0,
      })
    );
    expect(value).toBe(20);
  });
});

describe("statusLabel", () => {
  it("writes the known statuses in words", () => {
    expect(statusLabel("present")).toBe("Present");
    expect(statusLabel("half_day")).toBe("Half day");
    expect(statusLabel("on_leave")).toBe("On leave");
    expect(statusLabel("wfh")).toBe("Working from home");
  });

  it("makes an unknown status readable instead of hiding it", () => {
    // A status this build does not know is still the truth about someone's
    // attendance. Showing "Unknown" or nothing loses it.
    expect(statusLabel("sabbatical_unpaid")).toBe("Sabbatical unpaid");
  });

  it("names an empty status rather than rendering a blank row", () => {
    expect(statusLabel("")).toBe("Unrecorded");
    expect(statusLabel("   ")).toBe("Unrecorded");
  });
});

describe("statusTone", () => {
  it("colours the statuses it knows", () => {
    expect(statusTone("present")).toBe("success");
    expect(statusTone("absent")).toBe("danger");
    expect(statusTone("late")).toBe("warning");
    expect(statusTone("on_leave")).toBe("neutral");
  });

  it("stays neutral for a status it does not know", () => {
    // Guessing a colour for an unrecognised status states something about
    // someone's record that nobody checked.
    expect(statusTone("sabbatical_unpaid")).toBe("neutral");
  });
});
