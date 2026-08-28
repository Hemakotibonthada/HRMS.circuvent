// Employee loans: the schedule, the recovery, and the perquisite nobody bills.

import { describe, expect, it } from "vitest";
import {
  loanPerquisite,
  monthlyInstalment,
  positionOf,
  recoveryForMonth,
  schedule,
  type Loan,
} from "@/lib/employee-loans";

/** ₹1,20,000 over 12 months, interest free — the common salary advance. */
function interestFree(overrides: Partial<Loan> = {}): Loan {
  return {
    principalMinor: 1_20_000_00n,
    interestRatePercent: 0,
    tenureMonths: 12,
    firstRecoveryMonth: 4,
    firstRecoveryYear: 2025,
    type: "salary_advance",
    ...overrides,
  };
}

describe("the instalment", () => {
  it("divides evenly when there is no interest", () => {
    expect(monthlyInstalment(interestFree())).toBe(10_000_00n);
  });

  it("is larger than a simple division when interest is charged", () => {
    const withInterest = monthlyInstalment({
      principalMinor: 1_20_000_00n,
      interestRatePercent: 12,
      tenureMonths: 12,
    });
    expect(withInterest).toBeGreaterThan(10_000_00n);
  });

  it("is zero for a loan with no tenure rather than dividing by zero", () => {
    expect(monthlyInstalment({ principalMinor: 1_00_000_00n, interestRatePercent: 0, tenureMonths: 0 })).toBe(0n);
  });
});

describe("the schedule", () => {
  it("has one row per month of the tenure", () => {
    expect(schedule(interestFree())).toHaveLength(12);
  });

  it("clears the balance exactly on the final row", () => {
    const rows = schedule(interestFree());
    expect(rows[rows.length - 1].closingBalanceMinor).toBe(0n);
  });

  it("clears the balance exactly even with interest, where the last row differs", () => {
    const rows = schedule(interestFree({ interestRatePercent: 12 }));
    expect(rows[rows.length - 1].closingBalanceMinor).toBe(0n);
  });

  it("repays only principal when no interest is charged", () => {
    for (const row of schedule(interestFree())) {
      expect(row.interestMinor).toBe(0n);
    }
  });

  it("charges less interest each month as the balance reduces", () => {
    const rows = schedule(interestFree({ interestRatePercent: 12 }));
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].interestMinor).toBeLessThanOrEqual(rows[i - 1].interestMinor);
    }
  });

  it("rolls into the next calendar year rather than reaching month 13", () => {
    const rows = schedule(interestFree({ firstRecoveryMonth: 11, tenureMonths: 4 }));
    expect(rows.map((r) => `${r.year}-${r.month}`)).toEqual([
      "2025-11",
      "2025-12",
      "2026-1",
      "2026-2",
    ]);
  });

  it("repays the whole principal across the schedule", () => {
    const rows = schedule(interestFree({ interestRatePercent: 9, tenureMonths: 24 }));
    const principal = rows.reduce((a, r) => a + r.principalMinor, 0n);
    expect(principal).toBe(1_20_000_00n);
  });
});

describe("where the loan actually stands", () => {
  it("is closed once the principal has been recovered", () => {
    const loan = interestFree();
    const recoveries = schedule(loan).map((r) => ({
      month: r.month,
      year: r.year,
      amountMinor: r.principalMinor,
    }));
    const position = positionOf(loan, recoveries);
    expect(position.outstandingMinor).toBe(0n);
    expect(position.status).toBe("closed");
  });

  it("stays active when a month recovered nothing", () => {
    // Unpaid leave. The schedule says twelve instalments; payroll took eleven.
    const loan = interestFree();
    const recoveries = schedule(loan)
      .slice(0, 11)
      .map((r) => ({ month: r.month, year: r.year, amountMinor: r.principalMinor }));
    const position = positionOf(loan, recoveries);
    expect(position.outstandingMinor).toBe(10_000_00n);
    expect(position.status).toBe("active");
  });

  it("accepts a lump sum that clears the balance early", () => {
    const loan = interestFree();
    const position = positionOf(loan, [{ month: 5, year: 2025, amountMinor: 1_20_000_00n }]);
    expect(position.status).toBe("closed");
  });

  it("never reports a negative outstanding when more was recovered than lent", () => {
    const loan = interestFree();
    const position = positionOf(loan, [{ month: 5, year: 2025, amountMinor: 2_00_000_00n }]);
    expect(position.outstandingMinor).toBe(0n);
  });
});

describe("the perquisite on a concessional loan", () => {
  const twelveMonthsAt = (balance: bigint) => Array.from({ length: 12 }, () => balance);

  it("is charged on an interest-free loan, because it is not free", () => {
    const result = loanPerquisite({
      monthEndBalancesMinor: twelveMonthsAt(5_00_000_00n),
      sbiRatePercent: 9,
      employerRatePercent: 0,
      loanType: "personal",
      aggregateOutstandingMinor: 5_00_000_00n,
    });
    expect(result.exempt).toBe(false);
    // 9% of ₹5,00,000 for a year, held flat.
    expect(result.taxableMinor).toBe(45_000_00n);
  });

  it("charges only the shortfall when the employer charges something", () => {
    const result = loanPerquisite({
      monthEndBalancesMinor: twelveMonthsAt(5_00_000_00n),
      sbiRatePercent: 9,
      employerRatePercent: 4,
      loanType: "personal",
      aggregateOutstandingMinor: 5_00_000_00n,
    });
    expect(result.taxableMinor).toBe(25_000_00n);
  });

  it("charges nothing when the employer's rate matches the benchmark", () => {
    const result = loanPerquisite({
      monthEndBalancesMinor: twelveMonthsAt(5_00_000_00n),
      sbiRatePercent: 9,
      employerRatePercent: 9,
      loanType: "personal",
      aggregateOutstandingMinor: 5_00_000_00n,
    });
    expect(result.exempt).toBe(true);
    expect(result.taxableMinor).toBe(0n);
  });

  it("exempts small loans in aggregate", () => {
    const result = loanPerquisite({
      monthEndBalancesMinor: twelveMonthsAt(15_000_00n),
      sbiRatePercent: 9,
      employerRatePercent: 0,
      loanType: "personal",
      aggregateOutstandingMinor: 15_000_00n,
    });
    expect(result.exempt).toBe(true);
    expect(result.reason).toMatch(/₹20,000 exemption/);
  });

  it("exempts a medical loan, and says what would break the exemption", () => {
    const result = loanPerquisite({
      monthEndBalancesMinor: twelveMonthsAt(5_00_000_00n),
      sbiRatePercent: 9,
      employerRatePercent: 0,
      loanType: "medical",
      aggregateOutstandingMinor: 5_00_000_00n,
    });
    expect(result.exempt).toBe(true);
    expect(result.reason).toMatch(/reimbursed under a medical insurance policy/);
  });

  it("falls as the balance is repaid, rather than charging on the original principal", () => {
    const reducing = Array.from({ length: 12 }, (_, i) => 5_00_000_00n - BigInt(i) * 40_000_00n);
    const onReducing = loanPerquisite({
      monthEndBalancesMinor: reducing,
      sbiRatePercent: 9,
      employerRatePercent: 0,
      loanType: "personal",
      aggregateOutstandingMinor: 5_00_000_00n,
    });
    const onFlat = loanPerquisite({
      monthEndBalancesMinor: twelveMonthsAt(5_00_000_00n),
      sbiRatePercent: 9,
      employerRatePercent: 0,
      loanType: "personal",
      aggregateOutstandingMinor: 5_00_000_00n,
    });
    expect(onReducing.taxableMinor).toBeLessThan(onFlat.taxableMinor);
  });
});

describe("what payroll takes this month", () => {
  it("takes the instalment when there is pay to take it from", () => {
    const r = recoveryForMonth({
      instalmentMinor: 10_000_00n,
      outstandingMinor: 50_000_00n,
      netPayBeforeRecoveryMinor: 80_000_00n,
    });
    expect(r.amountMinor).toBe(10_000_00n);
    expect(r.capped).toBe(false);
  });

  it("takes only what is left in the final month", () => {
    const r = recoveryForMonth({
      instalmentMinor: 10_000_00n,
      outstandingMinor: 3_000_00n,
      netPayBeforeRecoveryMinor: 80_000_00n,
    });
    expect(r.amountMinor).toBe(3_000_00n);
  });

  it("never leaves an employee with a negative net pay", () => {
    const r = recoveryForMonth({
      instalmentMinor: 10_000_00n,
      outstandingMinor: 50_000_00n,
      netPayBeforeRecoveryMinor: 4_000_00n,
    });
    expect(r.amountMinor).toBe(4_000_00n);
    expect(r.capped).toBe(true);
    expect(r.note).toMatch(/consider pausing the recovery/);
  });

  it("takes nothing from a month with no pay", () => {
    const r = recoveryForMonth({
      instalmentMinor: 10_000_00n,
      outstandingMinor: 50_000_00n,
      netPayBeforeRecoveryMinor: 0n,
    });
    expect(r.amountMinor).toBe(0n);
  });

  it("takes nothing on a settled loan", () => {
    const r = recoveryForMonth({
      instalmentMinor: 10_000_00n,
      outstandingMinor: 0n,
      netPayBeforeRecoveryMinor: 80_000_00n,
    });
    expect(r.amountMinor).toBe(0n);
  });
});
