import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
  addDaysToKey,
  dateKeyInZone,
  toLocalDateKey,
  todayKey,
} from "./date-keys";

describe("dateKeyInZone", () => {
  it("returns the IST date, not the UTC one, in the pre-dawn window", () => {
    // 02:00 IST on 15 June is still 20:30 on 14 June in UTC. This is the exact
    // case that made `toISOString()` wrong: the night shift clocking out.
    const instant = new Date("2026-06-14T20:30:00Z");

    expect(dateKeyInZone(instant, "Asia/Kolkata")).toBe("2026-06-15");
    expect(instant.toISOString().split("T")[0]).toBe("2026-06-14");
  });

  it("defaults to IST", () => {
    const instant = new Date("2026-06-14T20:30:00Z");
    expect(dateKeyInZone(instant)).toBe(dateKeyInZone(instant, DEFAULT_TIMEZONE));
    expect(dateKeyInZone(instant)).toBe("2026-06-15");
  });

  it("agrees with UTC when the instant is mid-morning IST", () => {
    const instant = new Date("2026-06-15T06:00:00Z"); // 11:30 IST
    expect(dateKeyInZone(instant, "Asia/Kolkata")).toBe("2026-06-15");
    expect(instant.toISOString().split("T")[0]).toBe("2026-06-15");
  });

  it("handles the last minute of an IST day", () => {
    const instant = new Date("2026-06-15T18:29:59Z"); // 23:59:59 IST
    expect(dateKeyInZone(instant, "Asia/Kolkata")).toBe("2026-06-15");

    const nextTick = new Date("2026-06-15T18:30:00Z"); // 00:00:00 IST, 16 June
    expect(dateKeyInZone(nextTick, "Asia/Kolkata")).toBe("2026-06-16");
  });

  it("reads zones west of UTC, where the shift runs the other way", () => {
    // 20:00 on 14 June in New York is already 15 June in UTC.
    const instant = new Date("2026-06-15T00:30:00Z");
    expect(dateKeyInZone(instant, "America/New_York")).toBe("2026-06-14");
    expect(dateKeyInZone(instant, "UTC")).toBe("2026-06-15");
  });

  it("respects daylight saving rather than a fixed offset", () => {
    // London is UTC+1 in July and UTC+0 in January. Same wall clock, two
    // different offsets — a hardcoded one gets exactly one of these right.
    expect(dateKeyInZone(new Date("2026-07-14T23:30:00Z"), "Europe/London")).toBe("2026-07-15");
    expect(dateKeyInZone(new Date("2026-01-14T23:30:00Z"), "Europe/London")).toBe("2026-01-14");
  });

  it("pads single-digit months and days", () => {
    expect(dateKeyInZone(new Date("2026-03-05T06:00:00Z"), "Asia/Kolkata")).toBe("2026-03-05");
  });

  it("rejects an invalid Date rather than emitting NaN-NaN-NaN", () => {
    expect(() => dateKeyInZone(new Date("nonsense"))).toThrow(RangeError);
  });
});

describe("todayKey", () => {
  it("uses the injected clock", () => {
    expect(todayKey("Asia/Kolkata", new Date("2026-06-14T20:30:00Z"))).toBe("2026-06-15");
  });

  it("produces a well-formed key from the real clock", () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("toLocalDateKey", () => {
  it("keeps the calendar fields a Date was built from", () => {
    // Month is zero-based: this is 15 June 2026, local midnight.
    const built = new Date(2026, 5, 15);
    expect(toLocalDateKey(built)).toBe("2026-06-15");
  });

  it("does not drift the way toISOString does east of UTC", () => {
    const built = new Date(2026, 5, 15);
    // Only meaningful when the test runner sits east of Greenwich, so assert
    // the invariant that matters instead: the fields round-trip exactly.
    expect(toLocalDateKey(built)).toBe(
      `${built.getFullYear()}-${String(built.getMonth() + 1).padStart(2, "0")}-${String(
        built.getDate()
      ).padStart(2, "0")}`
    );
  });

  it("pads single-digit months and days", () => {
    expect(toLocalDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("handles a leap day", () => {
    expect(toLocalDateKey(new Date(2028, 1, 29))).toBe("2028-02-29");
  });

  it("rejects an invalid Date", () => {
    expect(() => toLocalDateKey(new Date("nonsense"))).toThrow(RangeError);
  });
});

describe("addDaysToKey", () => {
  it("moves forward", () => {
    expect(addDaysToKey("2026-06-15", 7)).toBe("2026-06-22");
  });

  it("moves backward", () => {
    expect(addDaysToKey("2026-06-15", -1)).toBe("2026-06-14");
  });

  it("returns the same key for zero", () => {
    expect(addDaysToKey("2026-06-15", 0)).toBe("2026-06-15");
  });

  it("rolls over a month boundary", () => {
    expect(addDaysToKey("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("rolls over a year boundary", () => {
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("knows 2028 is a leap year and 2027 is not", () => {
    expect(addDaysToKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToKey("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("survives a spring-forward transition", () => {
    // 29 March 2026 is when the UK springs forward. Local-midnight arithmetic
    // can land on 23:00 the evening before and lose a day; UTC cannot.
    expect(addDaysToKey("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDaysToKey("2026-03-29", 1)).toBe("2026-03-30");
  });

  it("rejects a malformed key", () => {
    expect(() => addDaysToKey("15-06-2026", 1)).toThrow(RangeError);
    expect(() => addDaysToKey("2026-6-15", 1)).toThrow(RangeError);
    expect(() => addDaysToKey("", 1)).toThrow(RangeError);
  });

  it("rejects an impossible date that matches the shape", () => {
    expect(() => addDaysToKey("2026-13-01", 1)).toThrow(RangeError);
  });

  it("rejects fractional days", () => {
    expect(() => addDaysToKey("2026-06-15", 1.5)).toThrow(RangeError);
  });
});
