// The arithmetic here decides how much leave a real person gets, and the
// mid-year joiner cases are the ones that quietly go wrong.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAVE_POLICIES,
  accrualMonths,
  availableDays,
  provisionFor,
  toHalfDays,
  type LeavePolicy,
} from "@/lib/leave-provisioning";

const CASUAL: LeavePolicy = {
  leaveType: "casual",
  label: "Casual Leave",
  annualQuotaDays: 12,
  isProRata: true,
};

const MATERNITY: LeavePolicy = {
  leaveType: "maternity",
  label: "Maternity Leave",
  annualQuotaDays: 182,
  isProRata: false,
};

describe("accrual months", () => {
  it("gives a full year to someone who joined earlier", () => {
    expect(accrualMonths("2024-06-15", 2026)).toBe(12);
    expect(accrualMonths("2025-12-31", 2026)).toBe(12);
  });

  it("counts from the joining month, inclusively", () => {
    expect(accrualMonths("2026-01-01", 2026)).toBe(12);
    expect(accrualMonths("2026-07-01", 2026)).toBe(6);
    expect(accrualMonths("2026-12-01", 2026)).toBe(1);
  });

  // Someone who starts on the 20th has still worked part of that month, and
  // counting only whole months means a late-month joiner accrues nothing for a
  // month they were paid for.
  it("counts a partial month as a month", () => {
    expect(accrualMonths("2026-11-30", 2026)).toBe(2);
    expect(accrualMonths("2026-11-01", 2026)).toBe(2);
  });

  it("gives nothing for a year before the person joined", () => {
    expect(accrualMonths("2027-01-01", 2026)).toBe(0);
  });

  it("returns nothing rather than guessing at a malformed date", () => {
    expect(accrualMonths("01/04/2026", 2026)).toBe(0);
    expect(accrualMonths("", 2026)).toBe(0);
  });
});

describe("rounding", () => {
  it("rounds to the nearest half day", () => {
    expect(toHalfDays(1.24)).toBe(1);
    expect(toHalfDays(1.26)).toBe(1.5);
    expect(toHalfDays(1.74)).toBe(1.5);
    expect(toHalfDays(1.76)).toBe(2);
  });

  it("leaves exact halves alone", () => {
    expect(toHalfDays(3.5)).toBe(3.5);
    expect(toHalfDays(4)).toBe(4);
  });
});

describe("provisioning a joiner", () => {
  it("gives a full quota to someone who was already here", () => {
    const [balance] = provisionFor({
      policies: [CASUAL],
      joinDate: "2025-01-01",
      year: 2026,
    });
    expect(balance.openingDays).toBe(12);
  });

  it("pro-rates a mid-year joiner", () => {
    const [balance] = provisionFor({
      policies: [CASUAL],
      joinDate: "2026-07-01",
      year: 2026,
    });
    expect(balance.openingDays).toBe(6);
  });

  // Twelve days over two months is two, which divides cleanly; eighteen over
  // five does not, and that is where rounding shows.
  it("rounds an uneven pro-rata to the nearest half day", () => {
    const [balance] = provisionFor({
      policies: [{ ...CASUAL, annualQuotaDays: 18 }],
      joinDate: "2026-08-01",
      year: 2026,
    });
    expect(balance.openingDays).toBe(7.5);
  });

  it("does not pro-rate a statutory entitlement", () => {
    const [balance] = provisionFor({
      policies: [MATERNITY],
      joinDate: "2026-11-01",
      year: 2026,
    });
    expect(balance.openingDays).toBe(182);
  });

  it("provisions nothing for a year before the person joined", () => {
    expect(provisionFor({ policies: [CASUAL], joinDate: "2027-01-01", year: 2026 })).toEqual([]);
  });

  it("skips a retired policy", () => {
    const balances = provisionFor({
      policies: [CASUAL, { ...MATERNITY, isActive: false }],
      joinDate: "2026-01-01",
      year: 2026,
    });
    expect(balances.map((b) => b.leaveType)).toEqual(["casual"]);
  });

  // Compensatory off is earned by working and unpaid leave has no ceiling, so
  // both are legitimately zero-quota. The row still has to exist, or applying
  // for either is refused for want of a balance.
  it("still creates a row for a zero-quota policy", () => {
    const [balance] = provisionFor({
      policies: [{ leaveType: "compensatory", label: "Comp off", annualQuotaDays: 0, isProRata: false }],
      joinDate: "2026-01-01",
      year: 2026,
    });
    expect(balance).toBeDefined();
    expect(balance.openingDays).toBe(0);
  });
});

describe("carry forward", () => {
  it("carries what last year left, up to the policy limit", () => {
    const [balance] = provisionFor({
      policies: [{ ...CASUAL, carryForwardLimitDays: 5 }],
      joinDate: "2024-01-01",
      year: 2026,
      carryForward: { casual: 3 },
    });
    expect(balance.carryForwardDays).toBe(3);
  });

  it("caps it at the limit", () => {
    const [balance] = provisionFor({
      policies: [{ ...CASUAL, carryForwardLimitDays: 5 }],
      joinDate: "2024-01-01",
      year: 2026,
      carryForward: { casual: 40 },
    });
    expect(balance.carryForwardDays).toBe(5);
  });

  it("carries nothing where the policy forbids it", () => {
    const [balance] = provisionFor({
      policies: [{ ...CASUAL, carryForwardLimitDays: 0 }],
      joinDate: "2024-01-01",
      year: 2026,
      carryForward: { casual: 10 },
    });
    expect(balance.carryForwardDays).toBe(0);
  });

  it("does not invent a carry-forward that was not supplied", () => {
    const [balance] = provisionFor({
      policies: [{ ...CASUAL, carryForwardLimitDays: 5 }],
      joinDate: "2024-01-01",
      year: 2026,
    });
    expect(balance.carryForwardDays).toBe(0);
  });
});

describe("what is left to take", () => {
  const base = {
    openingDays: 12,
    accruedDays: 0,
    carryForwardDays: 3,
    usedDays: 0,
    pendingDays: 0,
  };

  it("counts granted minus taken", () => {
    expect(availableDays(base)).toBe(15);
  });

  it("holds back what is applied for but not yet decided", () => {
    expect(availableDays({ ...base, pendingDays: 2 })).toBe(13);
  });

  it("subtracts what has lapsed or been encashed", () => {
    expect(availableDays({ ...base, lapsedDays: 1, encashedDays: 2 })).toBe(12);
  });

  // An approval made against a policy that later changed can legitimately
  // overdraw a balance, and "-2 days available" reads as a bug.
  it("never reports a negative balance", () => {
    expect(availableDays({ ...base, usedDays: 99 })).toBe(0);
  });
});

describe("the default policy set", () => {
  it("covers every type an employee can apply for", () => {
    const types = DEFAULT_LEAVE_POLICIES.map((p) => p.leaveType);
    for (const required of ["casual", "sick", "earned", "unpaid"]) {
      expect(types).toContain(required);
    }
  });

  it("names one policy per leave type", () => {
    const types = DEFAULT_LEAVE_POLICIES.map((p) => p.leaveType);
    expect(new Set(types).size).toBe(types.length);
  });

  it("sets maternity leave to the statutory twenty-six weeks", () => {
    const maternity = DEFAULT_LEAVE_POLICIES.find((p) => p.leaveType === "maternity");
    expect(maternity?.annualQuotaDays).toBe(182);
    expect(maternity?.isProRata).toBe(false);
  });

  it("gives a January joiner a usable balance for every type", () => {
    const balances = provisionFor({
      policies: DEFAULT_LEAVE_POLICIES,
      joinDate: "2026-01-01",
      year: 2026,
    });
    expect(balances).toHaveLength(DEFAULT_LEAVE_POLICIES.length);
    expect(balances.find((b) => b.leaveType === "casual")?.openingDays).toBe(12);
  });

  it("gives a December joiner something rather than nothing", () => {
    const balances = provisionFor({
      policies: DEFAULT_LEAVE_POLICIES,
      joinDate: "2026-12-15",
      year: 2026,
    });
    expect(balances.length).toBeGreaterThan(0);
    expect(availableDays({ ...balances[0], usedDays: 0, pendingDays: 0 })).toBeGreaterThanOrEqual(0);
  });
});
