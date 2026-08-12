import { describe, expect, it } from "vitest";
import { formatAmount, formatMoney, formatPeriod, formatPeriodShort } from "./format";

// Intl output contains non-breaking and narrow-no-break spaces, which are not
// the ASCII space anyone types into an assertion. Normalising avoids tests
// that fail on an invisible character.
const normalise = (value: string) => value.replace(/\u00a0|\u202f/g, " ");

describe("formatMoney", () => {
  it("groups in the Indian system, not the Western one", () => {
    // 1234567 is twelve lakh, not one million two hundred thousand. Grouping
    // every three digits gives 1,234,567 and reads as a different amount to
    // the person whose salary it is.
    expect(normalise(formatMoney(1234567))).toContain("12,34,567.00");
    expect(normalise(formatMoney(100000))).toContain("1,00,000.00");
    expect(normalise(formatMoney(999))).toContain("999.00");
  });

  it("always shows two decimal places", () => {
    // A salary shown as ₹50,000 and a salary shown as ₹50,000.00 invite
    // different questions. Paise are part of the figure.
    expect(normalise(formatMoney(50000))).toContain("50,000.00");
    expect(normalise(formatMoney(50000.5))).toContain("50,000.50");
    expect(normalise(formatMoney(50000.456))).toContain("50,000.46");
  });

  it("includes a currency symbol", () => {
    expect(formatMoney(1000)).toMatch(/₹|INR/);
  });

  it("handles zero and negatives", () => {
    // A negative net pay is a recovery, and it must be legible rather than
    // silently rendered as a positive.
    expect(normalise(formatMoney(0))).toContain("0.00");
    expect(formatMoney(-2500)).toMatch(/-|−|\(/);
  });

  it("returns a dash rather than NaN", () => {
    // The payroll engine produced NaN once, from Infinity × 0 in a month with
    // no working days. "NaN" where a net pay belongs is alarming and tells
    // nobody anything.
    expect(formatMoney(Number.NaN)).toBe("—");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatMoney(Number.NEGATIVE_INFINITY)).toBe("—");
  });

  it("can be asked for another currency", () => {
    expect(formatMoney(1000, "USD", "en-US")).toMatch(/\$/);
  });
});

describe("formatAmount", () => {
  it("omits the symbol but keeps the grouping", () => {
    const formatted = normalise(formatAmount(1234567));
    expect(formatted).toBe("12,34,567.00");
    expect(formatted).not.toMatch(/₹/);
  });

  it("returns a dash rather than NaN", () => {
    expect(formatAmount(Number.NaN)).toBe("—");
  });
});

describe("formatPeriod", () => {
  it("treats month as 1-12, matching the database", () => {
    // Date uses 0-11. Mixing the conventions labels December's payslip as
    // January's, which is a call to finance.
    expect(formatPeriod(1, 2026)).toBe("January 2026");
    expect(formatPeriod(12, 2026)).toBe("December 2026");
  });

  it("refuses a month outside the range rather than guessing", () => {
    expect(formatPeriod(0, 2026)).toBe("Unknown period");
    expect(formatPeriod(13, 2026)).toBe("Unknown period");
    expect(formatPeriod(-1, 2026)).toBe("Unknown period");
  });

  it("refuses a fractional month", () => {
    expect(formatPeriod(1.5, 2026)).toBe("Unknown period");
  });

  it("says so when the period is missing", () => {
    // The record itself carries no period; only the run does. Rendering
    // "undefined 2026" would look like a bug in the payslip rather than a
    // gap in the response.
    expect(formatPeriod(undefined, 2026)).toBe("Unknown period");
    expect(formatPeriod(3, undefined)).toBe("Unknown period");
    expect(formatPeriod(undefined, undefined)).toBe("Unknown period");
  });

  it("refuses an implausible year", () => {
    expect(formatPeriod(3, 12026)).toBe("Unknown period");
    expect(formatPeriod(3, 0)).toBe("Unknown period");
  });
});

describe("formatPeriodShort", () => {
  it("abbreviates the month", () => {
    expect(formatPeriodShort(1, 2026)).toBe("Jan 2026");
    expect(formatPeriodShort(9, 2026)).toBe("Sep 2026");
  });

  it("applies the same validation as the long form", () => {
    expect(formatPeriodShort(13, 2026)).toBe("Unknown period");
    expect(formatPeriodShort(undefined, undefined)).toBe("Unknown period");
  });
});
