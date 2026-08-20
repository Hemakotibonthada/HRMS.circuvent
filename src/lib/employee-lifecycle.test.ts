// Proration — the specific risk `calculateSettlement` exists to get right.
//
// `settlement.ts` is unit-tested against pre-computed day counts (see
// settlement.test.ts); nothing there confirms that a real calendar date turns
// into the *correct* day count in the first place. That conversion is this
// file's only genuine logic (see the module comment above `calculateSettlement`),
// and it is exactly the kind of arithmetic a leaver's final payslip depends on
// and nobody re-checks: somebody leaving on the 12th must be paid for 12 days,
// not a month and not zero, and a last working day that happens to fall on a
// Sunday must not quietly lose a day of pay just because nobody was at a desk
// that day. These cases are the four the leaver path is explicitly required to
// get right — the 1st of the month, the last day of the month, mid-month, and a
// non-working day — plus the same-month join/exit edge case the source comment
// calls out as the only reason proration does not simply start counting at day 1.

import { describe, expect, it } from "vitest";
import {
  calculateSettlement,
  daysBetween,
  daysInMonth,
  finalMonthProration,
  type SettlementCalculationInput,
} from "@/lib/employee-lifecycle";

describe("daysInMonth", () => {
  it("knows February in a leap year has 29 days", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it("knows February in a non-leap year has 28 days", () => {
    expect(daysInMonth(2025, 2)).toBe(28);
  });

  it("knows a century year not divisible by 400 is not a leap year", () => {
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it("knows a century year divisible by 400 is a leap year", () => {
    expect(daysInMonth(2000, 2)).toBe(29);
  });

  it("gets the 30- and 31-day months right", () => {
    expect(daysInMonth(2025, 6)).toBe(30);
    expect(daysInMonth(2025, 1)).toBe(31);
  });
});

describe("daysBetween", () => {
  it("is zero for the same date", () => {
    expect(daysBetween("2025-06-01", "2025-06-01")).toBe(0);
  });

  it("counts whole calendar days forward, crossing a month boundary", () => {
    expect(daysBetween("2025-01-30", "2025-02-02")).toBe(3);
  });

  it("is negative rather than clamped to zero when the range runs backwards", () => {
    // A resignation whose agreed last working day is somehow before it was
    // submitted is a data-entry mistake, not a valid state — it must surface
    // as a visibly wrong (negative) number, not read as "notice fully served".
    expect(daysBetween("2025-06-10", "2025-06-01")).toBe(-9);
  });
});

describe("finalMonthProration — the boundaries the leaver path is required to get right", () => {
  it("pays exactly 1 day for someone leaving on the 1st of the month, not a full month and not zero", () => {
    const p = finalMonthProration("2024-06-01", "2025-06-01");
    expect(p.daysWorked).toBe(1);
    expect(p.daysInMonth).toBe(30);
  });

  it("pays the whole month for someone leaving on the last day of the month", () => {
    const p = finalMonthProration("2024-06-01", "2025-06-30");
    expect(p.daysWorked).toBe(30);
    expect(p.daysInMonth).toBe(30);
  });

  it("pays exactly the day count for a mid-month exit", () => {
    const p = finalMonthProration("2024-01-01", "2025-01-15");
    expect(p.daysWorked).toBe(15);
    expect(p.daysInMonth).toBe(31);
  });

  it("does not discount a last working day that falls on a non-working day (Sunday)", () => {
    // 2025-01-12 is a Sunday. Proration counts calendar days elapsed, not
    // days actually worked at a desk (see the function's own comment) — a
    // leaver whose last working day is a Sunday is still owed pay up to and
    // including it, the same as any other day of that month.
    const p = finalMonthProration("2024-01-01", "2025-01-12");
    expect(p.daysWorked).toBe(12);
    expect(p.daysInMonth).toBe(31);
  });

  it("starts counting from the join day, not day 1, when join and exit fall in the same month", () => {
    // Counting from day 1 for someone who joined and left within the same
    // calendar month would pay them for days before they were ever employed.
    const p = finalMonthProration("2025-06-10", "2025-06-20");
    expect(p.startDay).toBe(10);
    expect(p.daysWorked).toBe(11);
  });

  it("never goes negative when a same-month exit date somehow precedes the join date", () => {
    const p = finalMonthProration("2025-06-20", "2025-06-10");
    expect(p.daysWorked).toBe(0);
  });
});

describe("calculateSettlement — proration expressed in rupees on the final payslip", () => {
  /** No gratuity (under a year of service), no leave encashment, notice served in full — isolates the assertions below to proration alone. */
  function base(overrides: Partial<SettlementCalculationInput> = {}): SettlementCalculationInput {
    return {
      joinDate: "2024-01-01",
      exitDate: "2025-01-15",
      reason: "resignation",
      monthlyBasicPay: 93_000,
      monthlyGrossPay: 93_000,
      noticePeriodDays: 30,
      noticeServedDays: 30,
      encashableLeaveDays: 0,
      leaveEncashmentBasis: 30,
      ...overrides,
    };
  }

  it("leaving on the 1st: pays 1 day's salary, not a full month and not zero", () => {
    const s = calculateSettlement(base({ exitDate: "2025-01-01", monthlyGrossPay: 93_000 }));
    expect(s.daysWorkedInFinalMonth).toBe(1);
    expect(s.daysInFinalMonth).toBe(31);
    expect(s.proratedFinalSalary).toBe(3_000); // 93,000 / 31 days
    expect(s.netSettlement).toBe(3_000);
  });

  it("leaving on the last day of the month: pays the full month", () => {
    const s = calculateSettlement(base({ exitDate: "2025-01-31", monthlyGrossPay: 93_000 }));
    expect(s.daysWorkedInFinalMonth).toBe(31);
    expect(s.proratedFinalSalary).toBe(93_000);
    expect(s.netSettlement).toBe(93_000);
  });

  it("leaving mid-month: pays exactly for the days elapsed", () => {
    const s = calculateSettlement(base({ exitDate: "2025-01-15", monthlyGrossPay: 93_000 }));
    expect(s.daysWorkedInFinalMonth).toBe(15);
    expect(s.proratedFinalSalary).toBe(45_000); // 93,000 / 31 * 15
    expect(s.netSettlement).toBe(45_000);
  });

  it("leaving on a non-working day (Sunday): still paid up to and including that day, no holiday discount", () => {
    // 2025-01-12 is a Sunday.
    const s = calculateSettlement(base({ exitDate: "2025-01-12", monthlyGrossPay: 93_000 }));
    expect(s.daysWorkedInFinalMonth).toBe(12);
    expect(s.proratedFinalSalary).toBe(36_000); // 93,000 / 31 * 12
    expect(s.netSettlement).toBe(36_000);
  });

  it("is never zero for a real exit date, even the earliest possible one in a month", () => {
    const s = calculateSettlement(base({ exitDate: "2025-02-01", monthlyGrossPay: 84_000 }));
    expect(s.proratedFinalSalary).toBeGreaterThan(0);
  });
});
