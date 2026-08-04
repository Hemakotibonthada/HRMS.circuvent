// @vitest-environment node
//
// The pure calculations extracted from the leave and attendance repositories.
// These are the parts that decide whether someone's leave balance is right and
// whether a mobile clock-in is accepted, so they are tested independently of
// the database.

import { describe, expect, it } from "vitest";
import { countLeaveDays } from "@/db/repositories/leave.neon";
import { distanceMeters } from "@/db/repositories/attendance.neon";
import { RepositoryError } from "@/db/repositories/types";

describe("countLeaveDays", () => {
  it("counts a single day as one", () => {
    expect(countLeaveDays("2026-04-06", "2026-04-06", false)).toBe(1);
  });

  it("counts an inclusive range", () => {
    // Monday to Friday is five days, not four.
    expect(countLeaveDays("2026-04-06", "2026-04-10", false)).toBe(5);
  });

  it("counts a half day as 0.5", () => {
    expect(countLeaveDays("2026-04-06", "2026-04-06", true)).toBe(0.5);
  });

  it("rejects a half day spanning more than one date", () => {
    expect(() => countLeaveDays("2026-04-06", "2026-04-07", true)).toThrow(RepositoryError);
  });

  it("rejects an end date before the start", () => {
    expect(() => countLeaveDays("2026-04-10", "2026-04-06", false)).toThrow(
      /End date is before start date/
    );
  });

  it("rejects unparseable dates", () => {
    expect(() => countLeaveDays("not-a-date", "2026-04-06", false)).toThrow(RepositoryError);
  });

  it("spans a month boundary correctly", () => {
    // 29 + 2 = 31, and 2026 is not a leap year.
    expect(countLeaveDays("2026-02-27", "2026-03-02", false)).toBe(4);
  });

  it("spans a leap day correctly", () => {
    expect(countLeaveDays("2028-02-27", "2028-03-01", false)).toBe(4);
  });

  it("spans a year boundary correctly", () => {
    expect(countLeaveDays("2026-12-30", "2027-01-02", false)).toBe(4);
  });

  it("is unaffected by daylight-saving shifts", () => {
    // Parsed as UTC deliberately. Local-time parsing makes a 23- or 25-hour
    // day round to the wrong number of days in zones that observe DST.
    expect(countLeaveDays("2026-03-28", "2026-03-30", false)).toBe(3);
    expect(countLeaveDays("2026-10-24", "2026-10-26", false)).toBe(3);
  });
});

describe("distanceMeters", () => {
  it("is zero for identical points", () => {
    expect(distanceMeters(12.9716, 77.5946, 12.9716, 77.5946)).toBe(0);
  });

  it("measures a short distance accurately", () => {
    // Roughly 111 m per 0.001° of latitude.
    const d = distanceMeters(12.9716, 77.5946, 12.9726, 77.5946);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(118);
  });

  it("is symmetric", () => {
    const a = distanceMeters(12.9716, 77.5946, 19.076, 72.8777);
    const b = distanceMeters(19.076, 72.8777, 12.9716, 77.5946);
    expect(Math.abs(a - b)).toBeLessThan(1);
  });

  it("measures Bangalore to Mumbai within 1% of the known distance", () => {
    // ~845 km great-circle.
    const d = distanceMeters(12.9716, 77.5946, 19.076, 72.8777) / 1000;
    expect(d).toBeGreaterThan(837);
    expect(d).toBeLessThan(853);
  });

  it("handles the antimeridian without wrapping the wrong way", () => {
    // 1° apart across the date line, not 359°.
    const d = distanceMeters(0, 179.5, 0, -179.5) / 1000;
    expect(d).toBeLessThan(120);
  });

  it("handles the poles without returning NaN", () => {
    const d = distanceMeters(90, 0, -90, 0);
    expect(Number.isFinite(d)).toBe(true);
    // Half the Earth's circumference, ~20,015 km.
    expect(d / 1000).toBeGreaterThan(19_900);
    expect(d / 1000).toBeLessThan(20_100);
  });

  it("decides a typical 200 m geofence correctly", () => {
    const office = { lat: 12.9716, lon: 77.5946 };
    // ~55 m north — inside.
    expect(distanceMeters(12.9721, 77.5946, office.lat, office.lon)).toBeLessThan(200);
    // ~550 m north — outside.
    expect(distanceMeters(12.9766, 77.5946, office.lat, office.lon)).toBeGreaterThan(200);
  });
});
