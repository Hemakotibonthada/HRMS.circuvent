// A wrong holiday date is acted on by attendance and payroll: somebody marked
// absent on a day the office was shut, or losing leave for a day they were
// never expected to work. These pin what is certain and the boundary of what
// this module claims to know.

import { describe, expect, it } from "vitest";
import {
  FIXED_HOLIDAYS,
  HOLIDAY_ALIASES,
  MOVABLE_HOLIDAYS,
  SUPPORTED_YEARS,
  allHolidays,
  canonicalName,
  fallsOnWeekend,
  holidaysFor,
  missingFor,
} from "@/lib/ap-holidays";

describe("alternate names for the same day", () => {
  it("resolves a north-Indian name to the Telugu one", () => {
    expect(canonicalName("Dussehra")).toBe("Dasara");
    expect(canonicalName("Diwali")).toBe("Deepavali");
    expect(canonicalName("Ganesh Chaturthi")).toBe("Vinayaka Chavithi");
  });

  it("resolves the honorific form of Ambedkar Jayanti", () => {
    expect(canonicalName("Dr Ambedkar Jayanti")).toBe("Ambedkar Jayanti");
    expect(canonicalName("Dr. Ambedkar Jayanti")).toBe("Ambedkar Jayanti");
  });

  it("leaves a canonical name unchanged", () => {
    expect(canonicalName("Dasara")).toBe("Dasara");
    expect(canonicalName("Makara Sankranti")).toBe("Makara Sankranti");
  });

  it("leaves an unknown name unchanged rather than guessing", () => {
    expect(canonicalName("Founders Day")).toBe("Founders Day");
  });

  it("tolerates surrounding whitespace from imported data", () => {
    expect(canonicalName("  Diwali  ")).toBe("Deepavali");
  });

  it("never maps a name onto itself, which would loop a rename", () => {
    for (const [alias, canonical] of Object.entries(HOLIDAY_ALIASES)) {
      expect(alias).not.toBe(canonical);
    }
  });

  it("points every alias at a holiday this module actually knows", () => {
    const known = new Set<string>([
      ...FIXED_HOLIDAYS.map((h) => h.name),
      ...MOVABLE_HOLIDAYS.map((h) => h.name),
    ]);
    for (const canonical of Object.values(HOLIDAY_ALIASES)) {
      expect(known).toContain(canonical);
    }
  });

  it("does not list a canonical name as an alias of something else", () => {
    const canonicals = new Set(Object.values(HOLIDAY_ALIASES));
    for (const alias of Object.keys(HOLIDAY_ALIASES)) {
      expect(canonicals.has(alias)).toBe(false);
    }
  });

  it("keeps the three Sankranti days distinct, since they are different days", () => {
    expect(canonicalName("Bhogi")).toBe("Bhogi");
    expect(canonicalName("Kanuma")).toBe("Kanuma");
    expect(canonicalName("Bhogi")).not.toBe(canonicalName("Kanuma"));
  });
});

describe("the Sankranti block", () => {
  // Andhra Pradesh's largest holiday, and the reason this module can state any
  // Telugu festival at all: Sankranti is solar. The sun's entry into Makara
  // holds to mid-January and drifts about a day per seventy years, rather than
  // moving a fortnight a year as a lunar date does.
  it("runs Bhogi, Sankranti and Kanuma on 13, 14 and 15 January", () => {
    for (let year = SUPPORTED_YEARS.first; year <= SUPPORTED_YEARS.last; year++) {
      const days = holidaysFor(year);
      expect(days.find((h) => h.name === "Bhogi")?.date).toBe(`${year}-01-13`);
      expect(days.find((h) => h.name === "Makara Sankranti")?.date).toBe(`${year}-01-14`);
      expect(days.find((h) => h.name === "Kanuma")?.date).toBe(`${year}-01-15`);
    }
  });

  it("treats all three as closed days", () => {
    for (const name of ["Bhogi", "Makara Sankranti", "Kanuma"]) {
      expect(FIXED_HOLIDAYS.find((h) => h.name === name)?.restricted).toBe(false);
    }
  });

  // The three-day block covers the festival whichever day the transit lands on,
  // which is how the state calendar lists it — and the description says so
  // rather than implying the 14th is exact every year.
  it("says the observance can move to the 15th in some years", () => {
    expect(FIXED_HOLIDAYS.find((h) => h.name === "Makara Sankranti")?.description)
      .toContain("15th");
  });

  it("carries Telugu names for the Telugu festivals", () => {
    for (const name of ["Bhogi", "Makara Sankranti", "Kanuma"]) {
      expect(FIXED_HOLIDAYS.find((h) => h.name === name)?.teluguName).toBeTruthy();
    }
  });
});

describe("national holidays", () => {
  it("puts Republic Day on 26 January of every year", () => {
    for (let year = SUPPORTED_YEARS.first; year <= SUPPORTED_YEARS.last; year++) {
      expect(holidaysFor(year).find((h) => h.name === "Republic Day")?.date)
        .toBe(`${year}-01-26`);
    }
  });

  it("puts Independence Day on 15 August and Gandhi Jayanti on 2 October", () => {
    for (let year = SUPPORTED_YEARS.first; year <= SUPPORTED_YEARS.last; year++) {
      const days = holidaysFor(year);
      expect(days.find((h) => h.name === "Independence Day")?.date).toBe(`${year}-08-15`);
      expect(days.find((h) => h.name === "Gandhi Jayanti")?.date).toBe(`${year}-10-02`);
    }
  });
});

describe("state holidays", () => {
  it("puts Andhra Pradesh Formation Day on 1 November", () => {
    expect(holidaysFor(2026).find((h) => h.name === "Andhra Pradesh Formation Day")?.date)
      .toBe("2026-11-01");
  });

  // A public holiday in Andhra Pradesh, unlike Delhi where it is a working day.
  // This module is scoped to AP, so it is gazetted here.
  it("treats Labour Day as a closed day", () => {
    expect(FIXED_HOLIDAYS.find((h) => h.name === "Labour Day")?.restricted).toBe(false);
  });

  it("keeps New Year's Day restricted", () => {
    expect(FIXED_HOLIDAYS.find((h) => h.name === "New Year's Day")?.restricted).toBe(true);
  });
});

describe("weekends", () => {
  // 26 January 2026 is a Monday; 15 August 2026 is a Saturday. Both verifiable
  // against any calendar, and they pin the weekday arithmetic.
  it("identifies a weekday and a weekend correctly", () => {
    expect(fallsOnWeekend("2026-01-26")).toBe(false);
    expect(fallsOnWeekend("2026-08-15")).toBe(true);
  });

  // India has no "observed on the following Monday" convention. Moving the date
  // would invent a day off nobody gets.
  it("does not move a weekend holiday to the next working day", () => {
    const independence = holidaysFor(2026).find((h) => h.name === "Independence Day");
    expect(independence?.date).toBe("2026-08-15");
    expect(independence?.onWeekend).toBe(true);
  });

  it("reads the same weekday regardless of the server's timezone", () => {
    expect(fallsOnWeekend("2026-01-03")).toBe(true);
    expect(fallsOnWeekend("2026-01-05")).toBe(false);
  });
});

describe("generation", () => {
  it("covers 2026 to 2036", () => {
    const years = new Set(allHolidays().map((h) => h.year));
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

  it("emits padded ISO dates", () => {
    for (const holiday of allHolidays()) {
      expect(holiday.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("names no two holidays the same within a year", () => {
    const names = holidaysFor(2030).map((h) => h.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("what this module does not know", () => {
  // The point of this group. Ugadi and Dasara are among the days Andhra
  // Pradesh most reliably closes for, and producing plausible dates for them
  // from memory would be fabrication acted on by payroll.
  it("claims no date for any lunisolar or Islamic festival", () => {
    const fixedNames = FIXED_HOLIDAYS.map((h) => h.name);
    for (const movable of MOVABLE_HOLIDAYS) {
      expect(fixedNames).not.toContain(movable.name);
    }
  });

  it("names the Telugu festivals it cannot date", () => {
    const names = MOVABLE_HOLIDAYS.map((h) => h.name);
    for (const expected of ["Ugadi", "Vinayaka Chavithi", "Dasara", "Deepavali", "Sri Rama Navami"]) {
      expect(names).toContain(expected);
    }
  });

  it("carries Telugu names for them too, so the calendar can ask properly", () => {
    const ugadi = MOVABLE_HOLIDAYS.find((h) => h.name === "Ugadi");
    expect(ugadi?.teluguName).toBe("ఉగాది");
  });

  it("says why each one moves, since that decides who can supply it", () => {
    for (const movable of MOVABLE_HOLIDAYS) {
      expect(movable.reason.length).toBeGreaterThan(15);
    }
  });

  // Ugadi follows the Amanta reckoning used in Andhra Pradesh, which differs
  // from the Purnimanta used further north — so the source has to be a Telugu
  // panchangam, not any Hindu calendar.
  it("records that Telugu dates follow the Amanta reckoning", () => {
    expect(MOVABLE_HOLIDAYS.find((h) => h.name === "Ugadi")?.reason).toContain("Amanta");
  });

  // An Islamic date in India is announced on moon sighting, so it is not
  // knowable years ahead by anyone, including an ephemeris.
  it("records that Ramzan and Bakrid depend on sighting rather than calculation", () => {
    for (const name of ["Ramzan (Eid al-Fitr)", "Bakrid (Eid al-Adha)"]) {
      const holiday = MOVABLE_HOLIDAYS.find((h) => h.name === name);
      expect(holiday?.calendar).toBe("islamic");
      expect(holiday?.reason).toContain("moon sighting");
    }
  });

  it("reports the gap for any supported year", () => {
    expect(missingFor(2026)).toHaveLength(MOVABLE_HOLIDAYS.length);
    expect(missingFor(2036).length).toBeGreaterThan(10);
  });
});
