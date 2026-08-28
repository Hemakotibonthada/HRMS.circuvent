// @vitest-environment node
//
// Benefits rules decide what comes out of someone's salary every month and
// what a claim is worth. The failure modes tested here: electing outside a
// window (which collapses the risk pool), splitting cost wrongly, and
// mis-prorating a partial year.

import { describe, expect, it } from "vitest";
import {
  ageInYears,
  calculateCost,
  isEligible,
  lifeEventWindowOpen,
  prorateContribution,
  validateDependants,
  windowFor,
  type EligibilitySubject,
  type Window,
} from "@/lib/benefits-rules";

function subject(over: Partial<EligibilitySubject> = {}): EligibilitySubject {
  return {
    employmentType: "full_time",
    status: "active",
    tenureMonths: 18,
    departmentId: "dept-eng",
    ctcMinor: 120_000_000n,
    ...over,
  };
}

describe("isEligible", () => {
  it("admits everyone when a plan has no rules", () => {
    expect(isEligible(subject())).toBe(true);
    expect(isEligible(subject(), { rules: [] })).toBe(true);
  });

  it("requires every rule by default", () => {
    const rules = {
      rules: [
        { field: "employmentType", operator: "eq" as const, value: "full_time" },
        { field: "tenureMonths", operator: "gte" as const, value: 24 },
      ],
    };
    expect(isEligible(subject(), rules)).toBe(false);
    expect(isEligible(subject({ tenureMonths: 30 }), rules)).toBe(true);
  });

  it("requires only one rule when matching any", () => {
    const rules = {
      match: "any" as const,
      rules: [
        { field: "employmentType", operator: "eq" as const, value: "contract" },
        { field: "tenureMonths", operator: "gte" as const, value: 12 },
      ],
    };
    expect(isEligible(subject(), rules)).toBe(true);
  });

  it("excludes contractors from a full-time-only plan", () => {
    const rules = {
      rules: [
        {
          field: "employmentType",
          operator: "in" as const,
          value: ["full_time", "part_time"],
        },
      ],
    };
    expect(isEligible(subject({ employmentType: "contract" }), rules)).toBe(false);
    expect(isEligible(subject({ employmentType: "part_time" }), rules)).toBe(true);
  });

  it("compares CTC held as bigint against a plain number threshold", () => {
    // CTC is bigint minor units and thresholds are written as numbers; without
    // normalising, every comparison would silently fail.
    const rules = {
      rules: [{ field: "ctcMinor", operator: "gte" as const, value: 100_000_000 }],
    };
    expect(isEligible(subject(), rules)).toBe(true);
    expect(isEligible(subject({ ctcMinor: 50_000_000n }), rules)).toBe(false);
  });

  it("fails closed on a nonsensical comparison", () => {
    // A misconfigured rule must not enrol everyone.
    const rules = {
      rules: [{ field: "employmentType", operator: "gte" as const, value: 5 }],
    };
    expect(isEligible(subject(), rules)).toBe(false);
  });

  it("fails closed on an unknown field", () => {
    const rules = {
      rules: [{ field: "favouriteColour", operator: "eq" as const, value: "blue" }],
    };
    expect(isEligible(subject(), rules)).toBe(false);
  });
});

describe("windowFor", () => {
  const windows: Window[] = [
    {
      id: "w1",
      opensOn: "2026-04-01",
      closesOn: "2026-04-30",
      coverageStartsOn: "2026-05-01",
      planIds: ["plan-health"],
    },
    {
      id: "w2",
      opensOn: "2026-10-01",
      closesOn: "2026-10-31",
      coverageStartsOn: "2026-11-01",
      planIds: ["plan-health"],
    },
  ];

  it("opens inside the window, inclusive of both endpoints", () => {
    expect(windowFor("plan-health", windows, "2026-04-01")).toMatchObject({ open: true });
    expect(windowFor("plan-health", windows, "2026-04-15")).toMatchObject({ open: true });
    expect(windowFor("plan-health", windows, "2026-04-30")).toMatchObject({ open: true });
  });

  it("refuses election outside a window", () => {
    // This is what stops someone electing cover the week they need surgery.
    expect(windowFor("plan-health", windows, "2026-06-15")).toMatchObject({ open: false });
  });

  it("distinguishes not-yet-open from closed, and gives the date to wait for", () => {
    const before = windowFor("plan-health", windows, "2026-06-15");
    expect(before).toMatchObject({ reason: "not_yet_open", nextOpensOn: "2026-10-01" });

    const after = windowFor("plan-health", windows, "2026-12-01");
    expect(after).toMatchObject({ reason: "closed" });
  });

  it("reports a plan with no window at all", () => {
    expect(windowFor("plan-dental", windows, "2026-04-15")).toMatchObject({
      reason: "no_window",
    });
  });
});

describe("lifeEventWindowOpen", () => {
  it("allows an election within 30 days of the event", () => {
    // Someone who marries in June should not wait until the next annual window
    // to add a spouse.
    expect(lifeEventWindowOpen("2026-06-01", "2026-06-01")).toBe(true);
    expect(lifeEventWindowOpen("2026-06-01", "2026-06-30")).toBe(true);
  });

  it("closes after 30 days", () => {
    expect(lifeEventWindowOpen("2026-06-01", "2026-07-05")).toBe(false);
  });

  it("rejects a future-dated event", () => {
    expect(lifeEventWindowOpen("2026-08-01", "2026-06-01")).toBe(false);
  });

  it("rejects an unparseable date rather than opening the window", () => {
    expect(lifeEventWindowOpen("not-a-date", "2026-06-01")).toBe(false);
  });
});

describe("calculateCost", () => {
  const plan = {
    employerContributionMinor: 3_000_000n,
    employeeContributionMinor: 1_000_000n,
    perDependantMinor: 500_000n,
    employerDependantSharePercent: 50,
  };

  it("splits the base contribution with no dependants", () => {
    const cost = calculateCost(plan, 0);
    expect(cost.employeeAnnualMinor).toBe(1_000_000n);
    expect(cost.employerAnnualMinor).toBe(3_000_000n);
    expect(cost.totalAnnualMinor).toBe(4_000_000n);
  });

  it("shares dependant cost at the configured split", () => {
    const cost = calculateCost(plan, 2);
    // 2 x 500,000 = 1,000,000, split 50/50.
    expect(cost.employeeAnnualMinor).toBe(1_500_000n);
    expect(cost.employerAnnualMinor).toBe(3_500_000n);
  });

  it("gives the rounding remainder to the employee so shares sum exactly", () => {
    // An odd split must not lose a unit; the total has to reconcile.
    const cost = calculateCost(
      { ...plan, perDependantMinor: 101n, employerDependantSharePercent: 33 },
      1
    );
    const dependantTotal =
      cost.employeeAnnualMinor - plan.employeeContributionMinor +
      (cost.employerAnnualMinor - plan.employerContributionMinor);
    expect(dependantTotal).toBe(101n);
  });

  it("clamps a nonsensical employer share", () => {
    expect(
      calculateCost({ ...plan, employerDependantSharePercent: 150 }, 1).employeeAnnualMinor
    ).toBe(1_000_000n);
    expect(
      calculateCost({ ...plan, employerDependantSharePercent: -20 }, 1).employeeAnnualMinor
    ).toBe(1_500_000n);
  });

  it("rounds the monthly figure down", () => {
    // Payroll deducts this twelve times; rounding up would over-deduct.
    const cost = calculateCost(
      { employerContributionMinor: 0n, employeeContributionMinor: 100n },
      0
    );
    expect(cost.employeeMonthlyMinor).toBe(8n);
  });

  it("rejects a negative dependant count", () => {
    expect(() => calculateCost(plan, -1)).toThrow(/cannot be negative/);
  });

  it("handles a plan with no dependant charge", () => {
    const cost = calculateCost(
      { employerContributionMinor: 1_000n, employeeContributionMinor: 500n },
      3
    );
    expect(cost.employeeAnnualMinor).toBe(500n);
  });
});

describe("prorateContribution", () => {
  it("charges the full year for full coverage", () => {
    const result = prorateContribution(365_000n, "2026-04-01", "2027-03-31");
    expect(result).toBe(365_000n);
  });

  it("charges a mid-year joiner only for their months", () => {
    // 31 days of a 365-day year.
    const result = prorateContribution(365_000n, "2027-03-01", "2027-03-31");
    expect(result).toBe(31_000n);
  });

  it("counts both endpoints, since cover on the last day is a day of cover", () => {
    expect(prorateContribution(365n, "2026-04-01", "2026-04-01")).toBe(1n);
  });

  it("charges nothing when the period is inverted", () => {
    expect(prorateContribution(365_000n, "2027-03-31", "2026-04-01")).toBe(0n);
  });

  it("charges nothing for an unparseable date rather than a full year", () => {
    expect(prorateContribution(365_000n, "nonsense", "2027-03-31")).toBe(0n);
  });
});

describe("validateDependants", () => {
  const policy = {
    eligibleRelations: ["spouse", "child", "parent"],
    maxDependants: 4,
    childAgeLimit: 25,
  };

  it("accepts a valid family", () => {
    const issues = validateDependants(
      [
        { relation: "spouse" },
        { relation: "child", dateOfBirth: "2015-06-01" },
      ],
      policy,
      "2026-04-06"
    );
    expect(issues).toEqual([]);
  });

  it("rejects a relation the plan does not cover", () => {
    const issues = validateDependants([{ relation: "sibling" }], policy, "2026-04-06");
    expect(issues).toContainEqual({ code: "relation_not_eligible", relation: "sibling" });
  });

  it("enforces the dependant cap", () => {
    const issues = validateDependants(
      Array.from({ length: 5 }, () => ({ relation: "child", dateOfBirth: "2020-01-01" })),
      policy,
      "2026-04-06"
    );
    expect(issues).toContainEqual({ code: "too_many", max: 4 });
  });

  it("removes a child who has aged out", () => {
    const issues = validateDependants(
      [{ relation: "child", dateOfBirth: "2000-01-01" }],
      policy,
      "2026-04-06"
    );
    expect(issues).toContainEqual({ code: "child_over_age", limit: 25 });
  });

  it("keeps a child on the day before the age limit", () => {
    const issues = validateDependants(
      [{ relation: "child", dateOfBirth: "2001-06-01" }],
      policy,
      "2026-05-31"
    );
    expect(issues).toEqual([]);
  });

  it("requires nominee shares to total exactly 100", () => {
    // A shortfall leaves part of a death benefit unassigned, which a court
    // resolves rather than the policy.
    const issues = validateDependants(
      [
        { relation: "spouse", isNominee: true, nomineeSharePercent: 60 },
        { relation: "child", isNominee: true, nomineeSharePercent: 30 },
      ],
      policy,
      "2026-04-06"
    );
    expect(issues).toContainEqual({ code: "nominee_shares_invalid", total: 90 });
  });

  it("accepts nominee shares that total 100", () => {
    const issues = validateDependants(
      [
        { relation: "spouse", isNominee: true, nomineeSharePercent: 50 },
        { relation: "parent", isNominee: true, nomineeSharePercent: 50 },
      ],
      policy,
      "2026-04-06"
    );
    expect(issues).toEqual([]);
  });

  it("reports every problem at once", () => {
    // Someone adding four family members should not learn the rules one
    // submission at a time.
    const issues = validateDependants(
      [
        { relation: "sibling" },
        { relation: "cousin" },
        { relation: "child", dateOfBirth: "1990-01-01" },
      ],
      policy,
      "2026-04-06"
    );
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ageInYears", () => {
  it("computes age at a date", () => {
    expect(ageInYears("2000-04-06", "2026-04-06")).toBe(26);
  });

  it("does not count a birthday that has not happened yet", () => {
    expect(ageInYears("2000-04-07", "2026-04-06")).toBe(25);
  });

  it("handles a leap-day birthday", () => {
    expect(ageInYears("2000-02-29", "2026-03-01")).toBe(26);
    expect(ageInYears("2000-02-29", "2026-02-28")).toBe(25);
  });

  it("returns null rather than a negative age for a future birth date", () => {
    expect(ageInYears("2030-01-01", "2026-04-06")).toBeNull();
  });

  it("returns null for an unparseable date", () => {
    expect(ageInYears("nonsense", "2026-04-06")).toBeNull();
  });
});
