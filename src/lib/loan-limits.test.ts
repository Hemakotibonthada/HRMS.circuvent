import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMIT_MONTHS,
  MAX_LIMIT_MONTHS,
  checkLoanRequest,
  limitMonthsFor,
  loanLimit,
  rupees,
} from "./loan-limits";

/**
 * Figures are in paise. ₹50,000 basic is 50_000_00n — a realistic monthly
 * basic for the salaries this product handles, chosen so the arithmetic in the
 * assertions is readable rather than round-number convenient.
 */
const BASIC = 50_000_00n;

describe("limitMonthsFor", () => {
  it("caps a salary advance at one month", () => {
    // The rule this module exists for.
    expect(limitMonthsFor("salary_advance")).toBe(1);
    expect(DEFAULT_LIMIT_MONTHS.salary_advance).toBe(1);
  });

  it("lets an organisation set its own", () => {
    expect(limitMonthsFor("personal", { personal: 6 })).toBe(6);
  });

  it("refuses to be talked into an absurd cap", () => {
    expect(limitMonthsFor("housing", { housing: 10_000 })).toBe(MAX_LIMIT_MONTHS);
  });

  it("ignores a nonsensical override rather than lending nothing", () => {
    // Zero or negative would mean nobody may borrow anything, which is far
    // more likely a typo than a policy.
    expect(limitMonthsFor("personal", { personal: 0 })).toBe(DEFAULT_LIMIT_MONTHS.personal);
    expect(limitMonthsFor("personal", { personal: -3 })).toBe(DEFAULT_LIMIT_MONTHS.personal);
    expect(limitMonthsFor("personal", { personal: Number.NaN })).toBe(DEFAULT_LIMIT_MONTHS.personal);
  });
});

describe("loanLimit", () => {
  it("a salary advance is exactly one month of basic", () => {
    const verdict = loanLimit({
      loanType: "salary_advance",
      monthlyBasicMinor: BASIC,
      outstandingMinor: 0n,
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.capMinor).toBe(50_000_00n);
      expect(verdict.headroomMinor).toBe(50_000_00n);
    }
  });

  it("subtracts what is already owed", () => {
    // A limit applied per loan and not across them is not a limit: three
    // advances of a month each is three months.
    const verdict = loanLimit({
      loanType: "salary_advance",
      monthlyBasicMinor: BASIC,
      outstandingMinor: 20_000_00n,
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.headroomMinor).toBe(30_000_00n);
  });

  it("refuses when the existing debt already reaches the cap", () => {
    const verdict = loanLimit({
      loanType: "salary_advance",
      monthlyBasicMinor: BASIC,
      outstandingMinor: 50_000_00n,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("no-headroom");
  });

  it("refuses rather than estimating basic from CTC", () => {
    // The payroll engine's 40%-of-CTC fallback is fine for an indicative
    // payslip and wrong for deciding how much money somebody may have.
    const verdict = loanLimit({
      loanType: "salary_advance",
      monthlyBasicMinor: null,
      outstandingMinor: 0n,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("no-salary-structure");
      expect(verdict.message).toContain("Ask HR");
    }
  });

  it("treats a zero basic as no basic", () => {
    const verdict = loanLimit({
      loanType: "personal",
      monthlyBasicMinor: 0n,
      outstandingMinor: 0n,
    });
    expect(verdict.ok).toBe(false);
  });

  it("scales longer-lived purchases further", () => {
    const housing = loanLimit({
      loanType: "housing",
      monthlyBasicMinor: BASIC,
      outstandingMinor: 0n,
    });
    expect(housing.ok).toBe(true);
    if (housing.ok) expect(housing.capMinor).toBe(BASIC * 60n);
  });
});

describe("checkLoanRequest", () => {
  const base = { monthlyBasicMinor: BASIC, outstandingMinor: 0n } as const;

  it("allows exactly one month's basic as an advance", () => {
    // The boundary itself is allowed — "not more than" includes it.
    expect(
      checkLoanRequest(50_000_00n, { ...base, loanType: "salary_advance" }).ok
    ).toBe(true);
  });

  it("refuses a paisa over one month's basic", () => {
    const verdict = checkLoanRequest(50_000_01n, { ...base, loanType: "salary_advance" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain("cannot be more than one month");
      expect(verdict.message).toContain("₹50,000");
    }
  });

  it("says how much is left when part is already borrowed", () => {
    const verdict = checkLoanRequest(40_000_00n, {
      ...base,
      loanType: "salary_advance",
      outstandingMinor: 20_000_00n,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain("₹30,000 of that left");
  });

  it("names the multiple for other kinds of loan", () => {
    const verdict = checkLoanRequest(BASIC * 4n, { ...base, loanType: "personal" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain("3 months of your basic pay");
  });

  it("refuses nothing and negatives", () => {
    expect(checkLoanRequest(0n, { ...base, loanType: "personal" }).ok).toBe(false);
    expect(checkLoanRequest(-1n, { ...base, loanType: "personal" }).ok).toBe(false);
  });

  it("passes the no-structure refusal through rather than allowing the amount", () => {
    const verdict = checkLoanRequest(1_00n, {
      loanType: "salary_advance",
      monthlyBasicMinor: null,
      outstandingMinor: 0n,
    });
    expect(verdict.ok).toBe(false);
  });
});

describe("rupees", () => {
  it("groups the Indian way", () => {
    // 12,34,567 and not 1,234,567 — the only grouping this audience reads
    // without stopping to count.
    expect(rupees(12_34_567_00n)).toBe("₹12,34,567");
    expect(rupees(1_000_00n)).toBe("₹1,000");
    expect(rupees(100_00n)).toBe("₹100");
    expect(rupees(1_00_000_00n)).toBe("₹1,00,000");
  });

  it("handles amounts below a thousand", () => {
    expect(rupees(999_00n)).toBe("₹999");
    expect(rupees(0n)).toBe("₹0");
  });
});
