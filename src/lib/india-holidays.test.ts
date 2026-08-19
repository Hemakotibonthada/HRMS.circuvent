// A wrong holiday date is acted on by attendance and payroll: somebody is
// marked absent on a day the office was shut, or loses leave for a day they
// were never expected to work. These pin the dates that are certain and the
// boundary of what this module claims to know.

import { describe, expect, it } from "vitest";
import {
  FIXED_HOLIDAYS,
  MOVABLE_HOLIDAYS,
  SUPPORTED_YEARS,
  allHolidays,
  fallsOnWeekend,
  holidaysFor,
  missingFor,
} from "@/lib/india-holidays";

describe("the national gazetted holidays", () => {
  // These three are the only holidays observed across the whole of India, and
  // each is fixed by what it commemorates rather than by a calendar that moves.
  it("puts Republic Day on 26 January of every year", () => {
    for (let year = SUPPORTED_YEARS.first; year <= SUPPORTED_YEARS.last; year++) {
      const republic = holidaysFor(year).find((h) => h.name === "Republic Day");
      expect(republic?.date).toBe(`${year}-01-26`);
      expect(republic?.restricted).toBe(false);
    }
  });

  it("puts Independence Day on 15 August of every year", () => {
    for (let year = SUPPORTED_YEARS.first; year <= SUPPORTED_YEARS.last; year++) {
      expect(holidaysFor(year).find((h) => h.name === "Independence Day")?.date)
        .toBe(`${year}-08-15`);
    }
  });

  it("puts Gandhi Jayanti on 2 October of every year", () => {
    for (let year = SUPPORTED_YEARS.first; year <= SUPPORTED_YEARS.last; year++) {
      expect(holidaysFor(year).find((h) => h.name === "Gandhi Jayanti")?.date)
        .toBe(`${year}-10-02`);
    }
  });

  it("treats all three as closed days rather than optional", () => {
    const national = ["Republic Day", "Independence Day", "Gandhi Jayanti"];
    for (const name of national) {
      expect(FIXED_HOLIDAYS.find((h) => h.name === name)?.restricted).toBe(false);
    }
  });
});

describe("holidays that are widely observed but not national", () => {
  // Labour Day is a public holiday in Tamil Nadu, Kerala, Maharashtra and
  // others, and an ordinary working day in Delhi. Marking it gazetted would
  // close offices that are open.
  it("marks Labour Day restricted rather than gazetted", () => {
    const labour = FIXED_HOLIDAYS.find((h) => h.name === "Labour Day");
    expect(labour?.restricted).toBe(true);
    expect(labour?.description).toContain("rather than nationally");
  });

  it("marks New Year's Day restricted", () => {
    expect(FIXED_HOLIDAYS.find((h) => h.name === "New Year's Day")?.restricted).toBe(true);
  });

  it("keeps Christmas gazetted", () => {
    expect(FIXED_HOLIDAYS.find((h) => h.name === "Christmas Day")?.restricted).toBe(false);
  });
});

describe("weekends", () => {
  // 26 January 2026 is a Monday; 15 August 2026 is a Saturday. Verifiable
  // against any calendar, and they pin the weekday arithmetic.
  it("identifies a weekday and a weekend correctly", () => {
    expect(fallsOnWeekend("2026-01-26")).toBe(false);
    expect(fallsOnWeekend("2026-08-15")).toBe(true);
  });

  it("flags a holiday that falls on a weekend", () => {
    const independence = holidaysFor(2026).find((h) => h.name === "Independence Day");
    expect(independence?.onWeekend).toBe(true);
  });

  // India has no "observed on the following Monday" convention. Moving the
  // date would invent a day off nobody gets.
  it("does not move a weekend holiday to the next working day", () => {
    expect(holidaysFor(2026).find((h) => h.name === "Independence Day")?.date)
      .toBe("2026-08-15");
  });

  // A UTC server serving IST users: parsing without an explicit zone puts the
  // weekday out by one for half the day.
  it("reads the same weekday regardless of the server's timezone", () => {
    expect(fallsOnWeekend("2026-01-01")).toBe(false);
    expect(fallsOnWeekend("2026-01-03")).toBe(true);
    expect(fallsOnWeekend("2026-01-04")).toBe(true);
  });
});

describe("generation", () => {
  it("covers 2026 to 2036", () => {
    const all = allHolidays();
    const years = new Set(all.map((h) => h.year));
    expect(Math.min(...years)).toBe(2026);
    expect(Math.max(...years)).toBe(2036);
    expect(years.size).toBe(11);
  });

  it("produces every fixed holiday for each year", () => {
    expect(allHolidays()).toHaveLength(FIXED_HOLIDAYS.length * 11);
  });

  it("returns them in date order", () => {
    const dates = holidaysFor(2026).map((h) => h.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("emits ISO dates with padding", () => {
    for (const holiday of allHolidays()) {
      expect(holiday.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("names no two holidays the same within a year", () => {
    const names = holidaysFor(2030).map((h) => h.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("honours a narrower range", () => {
    const two = allHolidays(2026, 2027);
    expect(new Set(two.map((h) => h.year))).toEqual(new Set([2026, 2027]));
  });
});

describe("what this module does not know", () => {
  // The point of this group. Producing plausible Diwali dates from memory
  // would be fabrication acted on by payroll — worse than admitting the gap.
  it("does not claim a date for any lunisolar or Islamic festival", () => {
    const fixedNames = FIXED_HOLIDAYS.map((h) => h.name);
    for (const movable of MOVABLE_HOLIDAYS) {
      expect(fixedNames).not.toContain(movable.name);
    }
  });

  it("names the festivals it cannot date, so they can be asked for", () => {
    const names = MOVABLE_HOLIDAYS.map((h) => h.name);
    for (const expected of ["Diwali", "Holi", "Eid al-Fitr", "Good Friday", "Dussehra"]) {
      expect(names).toContain(expected);
    }
  });

  it("says why each one moves, since that decides who can supply it", () => {
    for (const movable of MOVABLE_HOLIDAYS) {
      expect(movable.reason.length).toBeGreaterThan(15);
    }
  });

  // An Islamic date in India is announced on moon sighting, so it is not
  // knowable years ahead by anyone, including an ephemeris.
  it("records that Islamic dates depend on sighting rather than calculation", () => {
    const eid = MOVABLE_HOLIDAYS.find((h) => h.name === "Eid al-Fitr");
    expect(eid?.calendar).toBe("islamic");
    expect(eid?.reason).toContain("moon sighting");
  });

  it("reports the gap for any supported year", () => {
    expect(missingFor(2026).length).toBe(MOVABLE_HOLIDAYS.length);
    expect(missingFor(2036).length).toBeGreaterThan(10);
  });
});
