// Recurring days, which are harder than they look across a year boundary.

import { describe, expect, it } from "vitest";
import {
  nextOccurrence,
  toIso,
  upcomingAnniversaries,
  upcomingBirthdays,
  type PersonDay,
} from "@/lib/celebrations";

const on = (iso: string) => new Date(`${iso}T00:00:00Z`);

function person(overrides: Partial<PersonDay> = {}): PersonDay {
  return {
    employeeId: "e1",
    name: "Priya Sharma",
    designation: "Engineer",
    date: "1990-08-25",
    ...overrides,
  };
}

describe("when a recurring day next falls", () => {
  it("finds a day later this month", () => {
    expect(nextOccurrence("08-25", on("2026-08-19"), 30)).toEqual({
      soon: true,
      on: "2026-08-25",
    });
  });

  it("finds today itself", () => {
    expect(nextOccurrence("08-19", on("2026-08-19"), 30)).toEqual({
      soon: true,
      on: "2026-08-19",
    });
  });

  it("crosses into the next year, which is the whole point", () => {
    // Viewed on 20 December, a 3 January birthday is two weeks away. Comparing
    // full dates would put it eleven months away and nobody would be told.
    expect(nextOccurrence("01-03", on("2026-12-20"), 30)).toEqual({
      soon: true,
      on: "2027-01-03",
    });
  });

  it("crosses a month boundary", () => {
    expect(nextOccurrence("09-02", on("2026-08-28"), 30)).toEqual({
      soon: true,
      on: "2026-09-02",
    });
  });

  it("does not find a day beyond the horizon", () => {
    expect(nextOccurrence("12-25", on("2026-08-19"), 30).soon).toBe(false);
  });

  it("respects a horizon of one day", () => {
    expect(nextOccurrence("08-20", on("2026-08-19"), 1).soon).toBe(true);
    expect(nextOccurrence("08-21", on("2026-08-19"), 1).soon).toBe(false);
  });

  it("finds 29 February in a leap year", () => {
    expect(nextOccurrence("02-29", on("2028-02-01"), 40)).toEqual({
      soon: true,
      on: "2028-02-29",
    });
  });

  it("does not invent a substitute for 29 February in an ordinary year", () => {
    // Moving somebody to the 28th or the 1st is a decision about their identity
    // that a payroll system should not make for them.
    expect(nextOccurrence("02-29", on("2027-02-01"), 40).soon).toBe(false);
  });

  it("refuses a malformed month or day rather than guessing", () => {
    expect(nextOccurrence("13-01", on("2026-08-19"), 60).soon).toBe(false);
    expect(nextOccurrence("00-10", on("2026-08-19"), 60).soon).toBe(false);
    expect(nextOccurrence("xx-yy", on("2026-08-19"), 60).soon).toBe(false);
  });
});

describe("birthdays", () => {
  it("lists those inside the horizon", () => {
    const list = upcomingBirthdays([person()], on("2026-08-19"), 30);
    expect(list).toHaveLength(1);
    expect(list[0].on).toBe("2026-08-25");
  });

  it("never carries the birth year through", () => {
    const list = upcomingBirthdays([person({ date: "1990-08-25" })], on("2026-08-19"), 30);
    const fields = Object.keys(list[0]);
    expect(fields).not.toContain("year");
    expect(fields).not.toContain("dateOfBirth");
    // The only year present is the year it next falls, which is this year.
    expect(list[0].on.startsWith("2026")).toBe(true);
    expect(JSON.stringify(list[0])).not.toContain("1990");
  });

  it("marks today", () => {
    const list = upcomingBirthdays([person({ date: "1990-08-19" })], on("2026-08-19"), 30);
    expect(list[0].isToday).toBe(true);
  });

  it("skips people with no date on record", () => {
    expect(upcomingBirthdays([person({ date: null })], on("2026-08-19"), 30)).toEqual([]);
  });

  it("sorts soonest first, across a year boundary", () => {
    const list = upcomingBirthdays(
      [
        person({ employeeId: "a", name: "A", date: "1990-01-10" }),
        person({ employeeId: "b", name: "B", date: "1990-12-28" }),
      ],
      on("2026-12-20"),
      30
    );
    expect(list.map((b) => b.name)).toEqual(["B", "A"]);
  });
});

describe("work anniversaries", () => {
  it("counts the years", () => {
    const list = upcomingAnniversaries(
      [person({ date: "2020-08-25" })],
      on("2026-08-19"),
      30
    );
    expect(list[0].years).toBe(6);
  });

  it("does not celebrate somebody's first day as an anniversary", () => {
    const list = upcomingAnniversaries(
      [person({ date: "2026-08-25" })],
      on("2026-08-19"),
      30
    );
    expect(list).toEqual([]);
  });

  it("counts the first anniversary a year later", () => {
    const list = upcomingAnniversaries(
      [person({ date: "2025-08-25" })],
      on("2026-08-19"),
      30
    );
    expect(list[0].years).toBe(1);
  });

  it("counts correctly across a year boundary", () => {
    // Joined January 2020; viewed in December 2026 the next anniversary is
    // January 2027, which is seven years and not six.
    const list = upcomingAnniversaries(
      [person({ date: "2020-01-05" })],
      on("2026-12-20"),
      30
    );
    expect(list[0].on).toBe("2027-01-05");
    expect(list[0].years).toBe(7);
  });

  it("marks today", () => {
    const list = upcomingAnniversaries(
      [person({ date: "2021-08-19" })],
      on("2026-08-19"),
      30
    );
    expect(list[0].isToday).toBe(true);
    expect(list[0].years).toBe(5);
  });
});

describe("dates in and out", () => {
  it("formats a date as YYYY-MM-DD", () => {
    expect(toIso(on("2026-08-19"))).toBe("2026-08-19");
  });
});
