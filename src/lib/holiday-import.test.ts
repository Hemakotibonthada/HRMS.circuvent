// A bulk import writes a whole year in one action, so a row read wrongly is
// not one bad record — it is a calendar that looks complete and is not.
// Attendance marks people absent against it and payroll counts working days
// against it.

import { describe, expect, it } from "vitest";
import {
  apCalendarRows,
  dedupeAgainstExisting,
  parseHolidayCsv,
  parseHolidayDate,
} from "@/lib/holiday-import";
import { SUPPORTED_YEARS, holidaysFor } from "@/lib/ap-holidays";

describe("reading a date", () => {
  it("accepts ISO", () => {
    expect(parseHolidayDate("2026-01-26")).toBe("2026-01-26");
    expect(parseHolidayDate("  2026-1-6 ")).toBe("2026-01-06");
  });

  it("accepts an unambiguous named month", () => {
    expect(parseHolidayDate("26-Jan-2026")).toBe("2026-01-26");
    expect(parseHolidayDate("15 August 2026")).toBe("2026-08-15");
    expect(parseHolidayDate("2 oct 2026")).toBe("2026-10-02");
  });

  it("refuses slash-separated dates rather than guessing", () => {
    // 03/04/2026 is the 3rd of April to an Indian reader and the 4th of March
    // to an American one. Both are real dates two months apart, so there is no
    // safe guess — and a holiday calendar off by a month is acted on by
    // payroll before anybody notices.
    expect(parseHolidayDate("03/04/2026")).toBeNull();
    expect(parseHolidayDate("26/01/2026")).toBeNull();
  });

  it("refuses a date that does not exist", () => {
    expect(parseHolidayDate("2026-02-30")).toBeNull();
    expect(parseHolidayDate("2026-13-01")).toBeNull();
    expect(parseHolidayDate("31-Feb-2026")).toBeNull();
  });

  it("knows February has 29 days only in a leap year", () => {
    expect(parseHolidayDate("2028-02-29")).toBe("2028-02-29");
    expect(parseHolidayDate("2027-02-29")).toBeNull();
  });
});

describe("reading a pasted list", () => {
  it("reads name, date, optional and description", () => {
    const { rows, issues } = parseHolidayCsv(
      [
        "Republic Day,2026-01-26,no,Gazetted",
        "Founders Day,2026-07-15,yes,Company shutdown",
      ].join("\n")
    );

    expect(issues).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "Republic Day",
      holidayDate: "2026-01-26",
      year: 2026,
      isOptional: false,
      description: "Gazetted",
    });
    expect(rows[1].isOptional).toBe(true);
  });

  it("works with only a name and a date", () => {
    const { rows, issues } = parseHolidayCsv("Ugadi,2026-03-19");
    expect(issues).toEqual([]);
    expect(rows[0]).toMatchObject({ name: "Ugadi", holidayDate: "2026-03-19", isOptional: false, description: null });
  });

  it("skips a header row without being told there is one", () => {
    const { rows } = parseHolidayCsv("Name,Date,Optional\nRepublic Day,2026-01-26,no");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Republic Day");
  });

  it("keeps a comma inside a quoted description", () => {
    const { rows, issues } = parseHolidayCsv('Dasara,2026-10-20,no,"Ten days, observed statewide"');
    expect(issues).toEqual([]);
    expect(rows[0].description).toBe("Ten days, observed statewide");
  });

  it("handles a doubled quote inside a quoted field", () => {
    // Every spreadsheet writes "" for a literal quote; a splitter that forgets
    // turns one field into two from that point on and shifts every column.
    const { rows } = parseHolidayCsv('Founders Day,2026-07-15,no,"The ""first light"" anniversary"');
    expect(rows[0].description).toBe('The "first light" anniversary');
  });

  it("reports every bad line rather than stopping at the first", () => {
    const { rows, issues } = parseHolidayCsv(
      [
        "Republic Day,2026-01-26",
        "Bad Date,26/01/2026",
        "No Date Here",
        "Independence Day,2026-08-15",
      ].join("\n")
    );

    expect(rows).toHaveLength(2);
    expect(issues).toHaveLength(2);
    expect(issues[0].line).toBe(2);
    expect(issues[0].reason).toMatch(/either side of the Atlantic/);
    expect(issues[1].line).toBe(3);
  });

  it("normalises a north-Indian festival name to the Telugu one", () => {
    // So a pasted "Diwali" and the calendar's "Deepavali" are one holiday
    // rather than two on the same date.
    const { rows } = parseHolidayCsv("Diwali,2026-11-08");
    expect(rows[0].name).toBe("Deepavali");
  });

  it("drops a line duplicated within the same paste, and says so", () => {
    const { rows, issues } = parseHolidayCsv(
      ["Deepavali,2026-11-08", "Diwali,2026-11-08"].join("\n")
    );
    expect(rows).toHaveLength(1);
    expect(issues[0].reason).toMatch(/Duplicate/);
  });

  it("returns rows in date order however they were pasted", () => {
    const { rows } = parseHolidayCsv(
      ["Christmas,2026-12-25", "Republic Day,2026-01-26", "Independence Day,2026-08-15"].join("\n")
    );
    expect(rows.map((r) => r.holidayDate)).toEqual(["2026-01-26", "2026-08-15", "2026-12-25"]);
  });

  it("ignores blank lines", () => {
    const { rows, issues } = parseHolidayCsv("\nRepublic Day,2026-01-26\n\n\n");
    expect(rows).toHaveLength(1);
    expect(issues).toEqual([]);
  });
});

describe("importing the curated Andhra Pradesh calendar", () => {
  it("returns the same dates the calendar module states", () => {
    const rows = apCalendarRows(2027);
    expect(rows.map((r) => r.holidayDate)).toEqual(holidaysFor(2027).map((h) => h.date));
  });

  it("carries a restricted holiday across as optional", () => {
    const rows = apCalendarRows(2027);
    const newYear = rows.find((r) => r.name === "New Year's Day");
    expect(newYear?.isOptional).toBe(true);

    const republicDay = rows.find((r) => r.name === "Republic Day");
    expect(republicDay?.isOptional).toBe(false);
  });

  it("says when a holiday falls on a weekend instead of quietly moving it", () => {
    // Indian public holidays are not observed on the following Monday. A
    // calendar that moved them would give a day off nobody actually gets.
    const rows = apCalendarRows(2026);
    const weekendOnes = rows.filter((r) => r.description?.includes("Falls on a weekend"));
    for (const row of weekendOnes) {
      const day = new Date(`${row.holidayDate}T00:00:00Z`).getUTCDay();
      expect(day === 0 || day === 6).toBe(true);
    }
  });

  it("refuses a year it cannot state, rather than generating plausible dates", () => {
    expect(() => apCalendarRows(SUPPORTED_YEARS.last + 1)).toThrow(/paste the dates instead/);
    expect(() => apCalendarRows(2020)).toThrow(/only generated for/);
  });
});

describe("importing the same year twice", () => {
  it("skips what is already on file and keeps the rest", () => {
    const rows = parseHolidayCsv(
      ["Republic Day,2026-01-26", "Independence Day,2026-08-15", "Christmas,2026-12-25"].join("\n")
    ).rows;

    const { toInsert, duplicates } = dedupeAgainstExisting(rows, [
      { holidayDate: "2026-01-26", name: "Republic Day" },
    ]);

    expect(duplicates.map((r) => r.name)).toEqual(["Republic Day"]);
    expect(toInsert.map((r) => r.name)).toEqual(["Independence Day", "Christmas"]);
  });

  it("matches an alias already on file as the same holiday", () => {
    const rows = parseHolidayCsv("Diwali,2026-11-08").rows;
    const { toInsert, duplicates } = dedupeAgainstExisting(rows, [
      { holidayDate: "2026-11-08", name: "Deepavali" },
    ]);
    expect(toInsert).toEqual([]);
    expect(duplicates).toHaveLength(1);
  });

  it("keeps two genuinely different holidays that share a date", () => {
    const rows = parseHolidayCsv("Bhogi,2026-01-13").rows;
    const { toInsert } = dedupeAgainstExisting(rows, [
      { holidayDate: "2026-01-13", name: "Company Shutdown" },
    ]);
    expect(toInsert).toHaveLength(1);
  });

  it("is idempotent — importing the AP calendar twice writes nothing the second time", () => {
    const rows = apCalendarRows(2027);
    const existing = rows.map((r) => ({ holidayDate: r.holidayDate, name: r.name }));
    const { toInsert, duplicates } = dedupeAgainstExisting(rows, existing);
    expect(toInsert).toEqual([]);
    expect(duplicates).toHaveLength(rows.length);
  });
});
