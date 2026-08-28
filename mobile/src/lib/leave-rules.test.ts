import { describe, expect, it } from "vitest";
import {
  daysBetween,
  isRealDate,
  todayIso,
  validateLeave,
  type LeaveDraft,
} from "./leave-rules";

const valid: LeaveDraft = {
  leaveType: "casual",
  startDate: "2026-03-10",
  endDate: "2026-03-12",
  isHalfDay: false,
  reason: "Family wedding",
};

const TODAY = "2026-03-01";

describe("isRealDate", () => {
  it("accepts an ordinary date", () => {
    expect(isRealDate("2026-03-10")).toBe(true);
  });

  it("rejects the wrong shape", () => {
    expect(isRealDate("10/03/2026")).toBe(false);
    expect(isRealDate("2026-3-10")).toBe(false);
    expect(isRealDate("")).toBe(false);
  });

  it("rejects a date that does not exist", () => {
    // The regex alone accepts this, and Date would roll it into March.
    expect(isRealDate("2026-02-31")).toBe(false);
    expect(isRealDate("2026-04-31")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(isRealDate("2026-00-10")).toBe(false);
    expect(isRealDate("2026-03-00")).toBe(false);
  });

  it("knows which years are leap years", () => {
    expect(isRealDate("2024-02-29")).toBe(true);
    expect(isRealDate("2026-02-29")).toBe(false);
    // 1900 is not a leap year; 2000 is. The century rule is the one a
    // hand-rolled check usually gets wrong.
    expect(isRealDate("1900-02-29")).toBe(false);
    expect(isRealDate("2000-02-29")).toBe(true);
  });
});

describe("daysBetween", () => {
  it("counts inclusively", () => {
    expect(daysBetween("2026-03-10", "2026-03-10")).toBe(1);
    expect(daysBetween("2026-03-10", "2026-03-12")).toBe(3);
  });

  it("spans a month boundary", () => {
    expect(daysBetween("2026-02-27", "2026-03-02")).toBe(4);
  });

  it("spans a leap day", () => {
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(3);
  });

  it("is unaffected by daylight saving", () => {
    // The UK clocks go forward on 29 March 2026. Computed in local time, one
    // of these days is 23 hours long and the count comes out one short —
    // which is a day of leave the employee applied for and did not get.
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(3);
    // And back on 25 October, where a day is 25 hours.
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(3);
  });
});

describe("validateLeave", () => {
  it("accepts a well-formed request", () => {
    expect(validateLeave(valid, TODAY)).toEqual({});
  });

  it("requires a leave type", () => {
    expect(validateLeave({ ...valid, leaveType: "" }, TODAY).leaveType).toBeDefined();
  });

  it("rejects an end date before the start", () => {
    const errors = validateLeave({ ...valid, endDate: "2026-03-08" }, TODAY);
    expect(errors.endDate).toBeDefined();
  });

  it("allows a single-day request", () => {
    const errors = validateLeave({ ...valid, endDate: valid.startDate }, TODAY);
    expect(errors).toEqual({});
  });

  it("requires a half day to be one day", () => {
    const errors = validateLeave({ ...valid, isHalfDay: true }, TODAY);
    expect(errors.endDate).toBeDefined();
  });

  it("accepts a half day on a single date", () => {
    const errors = validateLeave(
      { ...valid, isHalfDay: true, endDate: valid.startDate },
      TODAY
    );
    expect(errors).toEqual({});
  });

  it("refuses back-dated leave rather than warning about it", () => {
    // Back-dating is a regularisation, which has its own approver. Quietly
    // accepting it here routes it around that person.
    const errors = validateLeave({ ...valid, startDate: "2026-02-20" }, TODAY);
    expect(errors.startDate).toBeDefined();
  });

  it("allows leave starting today", () => {
    const errors = validateLeave(
      { ...valid, startDate: TODAY, endDate: TODAY },
      TODAY
    );
    expect(errors).toEqual({});
  });

  it("requires a reason", () => {
    expect(validateLeave({ ...valid, reason: "" }, TODAY).reason).toBeDefined();
    expect(validateLeave({ ...valid, reason: "  " }, TODAY).reason).toBeDefined();
    expect(validateLeave({ ...valid, reason: "ok" }, TODAY).reason).toBeDefined();
  });

  it("matches the server's 1000-character limit", () => {
    expect(validateLeave({ ...valid, reason: "x".repeat(1000) }, TODAY).reason).toBeUndefined();
    expect(validateLeave({ ...valid, reason: "x".repeat(1001) }, TODAY).reason).toBeDefined();
  });

  it("reports a malformed date without crashing on the comparison", () => {
    const errors = validateLeave({ ...valid, startDate: "not-a-date" }, TODAY);
    expect(errors.startDate).toBeDefined();
    // The range check must not also fire with a nonsense message about
    // ordering when the real problem is that the date is unreadable.
    expect(errors.endDate).toBeUndefined();
  });
});

describe("todayIso", () => {
  it("uses local date parts, not UTC", () => {
    // 23:30 on 1 March. toISOString() would give 2 March for anyone east of
    // Greenwich, and the form would then reject leave starting today as
    // being in the past.
    const late = new Date(2026, 2, 1, 23, 30, 0);
    expect(todayIso(late)).toBe("2026-03-01");
  });

  it("pads single-digit months and days", () => {
    expect(todayIso(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });
});
