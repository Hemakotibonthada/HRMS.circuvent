import { describe, expect, it } from "vitest";
import {
  addDays,
  dayLabel,
  formatClock,
  formatDuration,
  groupByDay,
  isOvernight,
  nextShift,
  shiftState,
  type ShiftAssignment,
} from "./shift-rules";

function shift(overrides: Partial<ShiftAssignment> = {}): ShiftAssignment {
  return {
    id: "a",
    shiftDate: "2026-03-10",
    startsAt: "2026-03-10T09:00:00.000Z",
    endsAt: "2026-03-10T17:00:00.000Z",
    durationMinutes: 480,
    status: "scheduled",
    ...overrides,
  };
}

const DURING = new Date("2026-03-10T12:00:00.000Z");
const BEFORE = new Date("2026-03-10T06:00:00.000Z");
const AFTER = new Date("2026-03-10T20:00:00.000Z");

describe("shiftState", () => {
  it("reports a shift that has not started as upcoming", () => {
    expect(shiftState(shift(), BEFORE)).toBe("upcoming");
  });

  it("reports a shift being worked as in progress", () => {
    expect(shiftState(shift(), DURING)).toBe("in_progress");
  });

  it("reports a finished shift as past", () => {
    expect(shiftState(shift(), AFTER)).toBe("past");
  });

  it("treats the start instant as in progress and the end instant as past", () => {
    // A shift is not "upcoming" one millisecond after it began, and someone
    // whose shift ended exactly now is not still on it.
    expect(shiftState(shift(), new Date("2026-03-10T09:00:00.000Z"))).toBe("in_progress");
    expect(shiftState(shift(), new Date("2026-03-10T17:00:00.000Z"))).toBe("past");
  });

  it("degrades to past rather than throwing on an unparseable timestamp", () => {
    expect(shiftState(shift({ startsAt: "not a date" }), DURING)).toBe("past");
    expect(shiftState(shift({ endsAt: "" }), DURING)).toBe("past");
  });
});

describe("nextShift", () => {
  it("returns nothing for an empty roster", () => {
    expect(nextShift([], DURING)).toBeUndefined();
  });

  it("returns nothing when every shift is behind us", () => {
    expect(nextShift([shift()], AFTER)).toBeUndefined();
  });

  it("prefers the shift being worked over the one that follows it", () => {
    const running = shift({ id: "running" });
    const later = shift({
      id: "later",
      shiftDate: "2026-03-11",
      startsAt: "2026-03-11T09:00:00.000Z",
      endsAt: "2026-03-11T17:00:00.000Z",
    });

    expect(nextShift([later, running], DURING)?.id).toBe("running");
  });

  it("picks the earliest upcoming shift regardless of input order", () => {
    const soon = shift({ id: "soon", startsAt: "2026-03-10T09:00:00.000Z" });
    const later = shift({
      id: "later",
      shiftDate: "2026-03-12",
      startsAt: "2026-03-12T09:00:00.000Z",
      endsAt: "2026-03-12T17:00:00.000Z",
    });

    expect(nextShift([later, soon], BEFORE)?.id).toBe("soon");
    expect(nextShift([soon, later], BEFORE)?.id).toBe("soon");
  });

  it("picks the most recently started of two overlapping live shifts", () => {
    const early = shift({ id: "early", startsAt: "2026-03-10T08:00:00.000Z" });
    const late = shift({ id: "late", startsAt: "2026-03-10T11:00:00.000Z" });

    expect(nextShift([early, late], DURING)?.id).toBe("late");
  });

  it("skips a shift whose start cannot be read instead of returning it", () => {
    const broken = shift({ id: "broken", startsAt: "", endsAt: "" });
    const good = shift({ id: "good" });

    expect(nextShift([broken, good], BEFORE)?.id).toBe("good");
  });
});

describe("groupByDay", () => {
  it("returns nothing for an empty roster", () => {
    expect(groupByDay([])).toEqual([]);
  });

  it("groups on the rostered date, earliest day first", () => {
    const days = groupByDay([
      shift({ id: "b", shiftDate: "2026-03-12" }),
      shift({ id: "a", shiftDate: "2026-03-10" }),
    ]);

    expect(days.map((d) => d.date)).toEqual(["2026-03-10", "2026-03-12"]);
  });

  it("orders a day's shifts by when they start", () => {
    const evening = shift({ id: "evening", startsAt: "2026-03-10T18:00:00.000Z" });
    const morning = shift({ id: "morning", startsAt: "2026-03-10T06:00:00.000Z" });

    const [day] = groupByDay([evening, morning]);
    expect(day?.shifts.map((s) => s.id)).toEqual(["morning", "evening"]);
  });

  it("keeps a night shift on the day it was rostered for", () => {
    // The whole reason grouping uses shiftDate. This shift starts at 22:00 on
    // the 10th and ends on the 11th; the person was told to come in on the
    // 10th, so that is the day it belongs to.
    const night = shift({
      shiftDate: "2026-03-10",
      startsAt: "2026-03-10T22:00:00.000Z",
      endsAt: "2026-03-11T06:00:00.000Z",
    });

    expect(groupByDay([night]).map((d) => d.date)).toEqual(["2026-03-10"]);
  });

  it("totals the minutes on each day", () => {
    const days = groupByDay([
      shift({ id: "a", durationMinutes: 240 }),
      shift({ id: "b", durationMinutes: 180, startsAt: "2026-03-10T14:00:00.000Z" }),
    ]);

    expect(days[0]?.totalMinutes).toBe(420);
  });

  it("does not mutate the roster it was given", () => {
    const evening = shift({ id: "evening", startsAt: "2026-03-10T18:00:00.000Z" });
    const morning = shift({ id: "morning", startsAt: "2026-03-10T06:00:00.000Z" });
    const input = [evening, morning];

    groupByDay(input);

    expect(input.map((s) => s.id)).toEqual(["evening", "morning"]);
  });
});

describe("isOvernight", () => {
  /**
   * An instant expressed in the runner's own timezone.
   *
   * Built this way deliberately. `isOvernight` asks the question the person on
   * the shift would ask — do I go home tomorrow — so it compares local
   * calendar days. A fixture written as a UTC instant answers a different
   * question and passes or fails depending on where the test is run: in
   * India, 22:00Z and 06:00Z the next day are both the same local date.
   */
  function localIso(year: number, month: number, day: number, hour: number): string {
    return new Date(year, month - 1, day, hour, 0, 0, 0).toISOString();
  }

  it("is false for a shift that starts and ends on one day", () => {
    expect(isOvernight(shift())).toBe(false);
    expect(
      isOvernight(
        shift({ startsAt: localIso(2026, 3, 10, 9), endsAt: localIso(2026, 3, 10, 17) })
      )
    ).toBe(false);
  });

  it("is true when the end falls on a later local day", () => {
    expect(
      isOvernight(
        shift({ startsAt: localIso(2026, 3, 10, 22), endsAt: localIso(2026, 3, 11, 6) })
      )
    ).toBe(true);
  });

  it("is true across a month boundary", () => {
    expect(
      isOvernight(
        shift({ startsAt: localIso(2026, 3, 31, 22), endsAt: localIso(2026, 4, 1, 6) })
      )
    ).toBe(true);
  });

  it("is true across a year boundary", () => {
    // Comparing day-of-month alone would call this a same-day shift.
    expect(
      isOvernight(
        shift({ startsAt: localIso(2026, 12, 31, 22), endsAt: localIso(2027, 1, 1, 6) })
      )
    ).toBe(true);
  });

  it("is false rather than true when a timestamp cannot be read", () => {
    // Claiming a shift runs overnight on the strength of a value that could
    // not be parsed would tell someone to arrange a night off they do not need.
    expect(isOvernight(shift({ endsAt: "nonsense" }))).toBe(false);
    expect(isOvernight(shift({ startsAt: "" }))).toBe(false);
  });
});

describe("formatDuration", () => {
  it("writes minutes under an hour on their own", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45)).toBe("45m");
  });

  it("drops the minutes when there are none", () => {
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(480)).toBe("8h");
  });

  it("writes hours and minutes together", () => {
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(510)).toBe("8h 30m");
  });

  it("refuses to render a negative or non-finite duration as a number", () => {
    expect(formatDuration(-30)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("addDays", () => {
  it("moves forward and back across a month boundary", () => {
    expect(addDays("2026-03-31", 1)).toBe("2026-04-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(addDays("later", 1)).toBe("later");
  });
});

describe("dayLabel", () => {
  const today = "2026-03-10";

  it("names today, tomorrow and yesterday", () => {
    expect(dayLabel("2026-03-10", today)).toBe("Today");
    expect(dayLabel("2026-03-11", today)).toBe("Tomorrow");
    expect(dayLabel("2026-03-09", today)).toBe("Yesterday");
  });

  it("writes any other day out", () => {
    const label = dayLabel("2026-03-14", today);
    expect(label).not.toBe("Today");
    expect(label).toContain("14");
  });

  it("names the weekday from the calendar date, not the device timezone", () => {
    // 2026-03-14 is a Saturday. Formatting it in the device zone after parsing
    // it at UTC midnight reports Friday for anyone west of Greenwich.
    expect(dayLabel("2026-03-14", today)).toMatch(/Sat/);
  });

  it("passes through anything that is not a date", () => {
    expect(dayLabel("soon", today)).toBe("soon");
  });
});

describe("formatClock", () => {
  it("refuses an unreadable instant rather than printing Invalid Date", () => {
    expect(formatClock("")).toBe("—");
    expect(formatClock("nonsense")).toBe("—");
  });

  it("renders a real instant as a time", () => {
    expect(formatClock("2026-03-10T09:00:00.000Z")).toMatch(/\d/);
  });
});
