// @vitest-environment node
//
// A merit cycle applies a percentage to thousands of salaries and sums them
// against a budget. These tests pin the arithmetic that has to be exact, and
// the decisions that have to stay with a human rather than being made silently
// by the software.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MERIT_MATRIX,
  addMonths,
  checkBudget,
  mean,
  median,
  monthsBetween,
  payGap,
  percentOf,
  position,
  recommend,
  scaleToBudget,
  vestingPosition,
  type EquityGrant,
  type SalaryBand,
} from "@/lib/compensation";

const band: SalaryBand = {
  id: "b1",
  gradeCode: "L4",
  minMinor: 800_000_00n,
  midMinor: 1_000_000_00n,
  maxMinor: 1_200_000_00n,
  currency: "INR",
};

describe("position", () => {
  it("reports a compa-ratio of 1 at the midpoint", () => {
    const result = position(band.midMinor, band);
    expect(result.compaRatio).toBe(1);
    expect(result.status).toBe("at_midpoint");
  });

  it("reports below midpoint", () => {
    const result = position(900_000_00n, band);
    expect(result.compaRatio).toBe(0.9);
    expect(result.status).toBe("below_midpoint");
  });

  it("reports above the band", () => {
    expect(position(1_300_000_00n, band).status).toBe("above_band");
  });

  it("reports below the band", () => {
    expect(position(700_000_00n, band).status).toBe("below_band");
  });

  it("computes range penetration across the band", () => {
    expect(position(band.minMinor, band).rangePenetration).toBe(0);
    expect(position(band.maxMinor, band).rangePenetration).toBe(1);
    expect(position(band.midMinor, band).rangePenetration).toBe(0.5);
  });

  it("assigns quartiles by range penetration", () => {
    expect(position(850_000_00n, band).quartile).toBe(1);
    expect(position(950_000_00n, band).quartile).toBe(2);
    expect(position(1_050_000_00n, band).quartile).toBe(3);
    expect(position(1_150_000_00n, band).quartile).toBe(4);
  });

  it("clamps the quartile for someone outside the band", () => {
    expect(position(500_000_00n, band).quartile).toBe(1);
    expect(position(2_000_000_00n, band).quartile).toBe(4);
  });

  it("refuses a zero midpoint rather than returning Infinity", () => {
    // Infinity on a screen someone is about to have a difficult conversation
    // in front of is worse than an error.
    expect(() => position(100n, { ...band, midMinor: 0n })).toThrow(/positive midpoint/);
  });

  it("refuses an inverted band", () => {
    expect(() => position(100n, { ...band, maxMinor: 0n })).toThrow(/maximum below its minimum/);
  });

  it("treats a zero-width band as fully penetrated", () => {
    const point = { ...band, minMinor: 1_000_000_00n, maxMinor: 1_000_000_00n };
    expect(position(1_000_000_00n, point).rangePenetration).toBe(1);
  });
});

describe("percentOf", () => {
  it("computes a whole percentage exactly", () => {
    expect(percentOf(1_000_000_00n, 10)).toBe(10_000_000n);
  });

  it("computes a fractional percentage exactly", () => {
    // 7.25% of 1,000,000.00 is 72,500.00 — no float drift.
    expect(percentOf(1_000_000_00n, 7.25)).toBe(7_250_000n);
  });

  it("returns zero for a zero percentage", () => {
    expect(percentOf(1_000_000_00n, 0)).toBe(0n);
  });

  it("rounds half away from zero rather than systematically down", () => {
    // Rounding half down would favour the employer across thousands of
    // records, by a small amount each time.
    expect(percentOf(1n, 50)).toBe(1n);
  });

  it("handles a very large salary without losing precision", () => {
    const huge = 99_999_999_999_99n;
    expect(percentOf(huge, 10)).toBe(999_999_999_999n + 1n);
  });

  it("refuses a non-finite percentage", () => {
    expect(() => percentOf(100n, NaN)).toThrow(/finite/);
    expect(() => percentOf(100n, Infinity)).toThrow(/finite/);
  });
});

describe("recommend", () => {
  it("gives a larger increase in the first quartile than the fourth", () => {
    // Two people rated equally are not equally underpaid. Someone excellent in
    // Q1 is being paid below what the role is worth.
    const low = recommend({
      employeeId: "e1",
      salaryMinor: 850_000_00n,
      rating: "outstanding",
      band,
    });
    const high = recommend({
      employeeId: "e2",
      salaryMinor: 1_150_000_00n,
      rating: "outstanding",
      band,
    });

    expect(low.recommendedPercent).toBeGreaterThan(high.recommendedPercent);
  });

  it("gives no increase at a below rating", () => {
    // Awarding one anyway makes the rating meaningless and the process
    // indefensible.
    const result = recommend({
      employeeId: "e1",
      salaryMinor: 850_000_00n,
      rating: "below",
      band,
    });
    expect(result.recommendedPercent).toBe(0);
    expect(result.increaseMinor).toBe(0n);
    expect(result.rationale).toContain("No merit increase applies");
  });

  it("computes the new salary", () => {
    const result = recommend({
      employeeId: "e1",
      salaryMinor: 1_000_000_00n,
      rating: "meets",
      band,
    });
    // Q3 "meets" is 4%.
    expect(result.recommendedPercent).toBe(4);
    expect(result.increaseMinor).toBe(4_000_000n);
    expect(result.newSalaryMinor).toBe(1_040_000_00n);
  });

  it("prorates for someone who joined mid-cycle", () => {
    // A full increase for two months' service is a raise the rest of the team
    // funded.
    const result = recommend({
      employeeId: "e1",
      salaryMinor: 1_000_000_00n,
      rating: "meets",
      band,
      eligibleFraction: 0.5,
    });
    expect(result.recommendedPercent).toBe(2);
    expect(result.rationale).toContain("Prorated");
  });

  it("treats an absent eligible fraction as a full cycle", () => {
    const result = recommend({
      employeeId: "e1",
      salaryMinor: 1_000_000_00n,
      rating: "meets",
      band,
    });
    expect(result.rationale).not.toContain("Prorated");
  });

  it("clamps a nonsensical eligible fraction", () => {
    const over = recommend({
      employeeId: "e1",
      salaryMinor: 1_000_000_00n,
      rating: "meets",
      band,
      eligibleFraction: 5,
    });
    expect(over.recommendedPercent).toBe(4);
  });

  it("warns rather than silently capping at the band maximum", () => {
    // Capping hides a real problem and quietly gives the person less than the
    // matrix says they earned.
    const result = recommend({
      employeeId: "e1",
      salaryMinor: 1_190_000_00n,
      rating: "outstanding",
      band,
    });

    expect(result.newSalaryMinor).toBeGreaterThan(band.maxMinor);
    expect(result.warnings.join(" ")).toMatch(/above the band maximum/);
  });

  it("warns when the salary is below the band minimum", () => {
    const result = recommend({
      employeeId: "e1",
      salaryMinor: 600_000_00n,
      rating: "meets",
      band,
    });
    expect(result.warnings.join(" ")).toMatch(/below the band minimum/);
  });

  it("warns when someone is paid above band while rated below expectations", () => {
    const result = recommend({
      employeeId: "e1",
      salaryMinor: 1_300_000_00n,
      rating: "below",
      band,
    });
    expect(result.warnings.join(" ")).toMatch(/above band while rated below/);
  });

  it("produces a rationale that could be shown to the employee", () => {
    const result = recommend({
      employeeId: "e1",
      salaryMinor: 900_000_00n,
      rating: "exceeds",
      band,
    });

    expect(result.rationale).toContain("exceeds");
    expect(result.rationale).toContain("compa-ratio");
    expect(result.rationale).toContain("quartile");
  });

  it("accepts a custom matrix", () => {
    const flat = { ...DEFAULT_MERIT_MATRIX, meets: [1, 1, 1, 1] as [number, number, number, number] };
    const result = recommend(
      { employeeId: "e1", salaryMinor: 1_000_000_00n, rating: "meets", band },
      flat
    );
    expect(result.recommendedPercent).toBe(1);
  });
});

describe("checkBudget", () => {
  const pool = {
    id: "p1",
    name: "FY26 merit",
    allocatedMinor: 100_000_00n,
    committedMinor: 20_000_00n,
  };

  it("reports a request that fits", () => {
    const result = checkBudget(pool, [{ increaseMinor: 50_000_00n }]);
    expect(result.withinBudget).toBe(true);
    expect(result.remainingMinor).toBe(30_000_00n);
  });

  it("reports the overspend rather than trimming the request", () => {
    // Deciding whose raise to cut is a management decision; software that
    // silently scales everyone down has made it badly and invisibly.
    const result = checkBudget(pool, [{ increaseMinor: 100_000_00n }]);
    expect(result.withinBudget).toBe(false);
    expect(result.overspendMinor).toBe(20_000_00n);
    expect(result.message).toMatch(/Over budget by 20000.00/);
  });

  it("counts what is already committed", () => {
    const result = checkBudget(pool, [{ increaseMinor: 80_000_00n }]);
    expect(result.withinBudget).toBe(true);
    expect(result.remainingMinor).toBe(0n);
  });

  it("can ignore commitments for a what-if", () => {
    const result = checkBudget(pool, [{ increaseMinor: 100_000_00n }], true);
    expect(result.withinBudget).toBe(true);
  });

  it("treats exact exhaustion as within budget", () => {
    const result = checkBudget(pool, [{ increaseMinor: 80_000_00n }]);
    expect(result.withinBudget).toBe(true);
  });

  it("handles an empty set of recommendations", () => {
    const result = checkBudget(pool, []);
    expect(result.requestedMinor).toBe(0n);
    expect(result.withinBudget).toBe(true);
  });
});

describe("scaleToBudget", () => {
  it("leaves a request that already fits alone", () => {
    const result = scaleToBudget([{ increaseMinor: 100n }], 1_000n);
    expect(result[0].scaledIncreaseMinor).toBe(100n);
  });

  it("scales proportionally", () => {
    const result = scaleToBudget(
      [{ increaseMinor: 600n }, { increaseMinor: 400n }],
      500n
    );
    expect(result[0].scaledIncreaseMinor).toBe(300n);
    expect(result[1].scaledIncreaseMinor).toBe(200n);
  });

  it("sums to exactly the budget, remainder and all", () => {
    // Otherwise the pool is left a few units short or over and the
    // reconciliation never balances.
    const result = scaleToBudget(
      [{ increaseMinor: 333n }, { increaseMinor: 333n }, { increaseMinor: 334n }],
      1_000n
    );
    const total = result.reduce((sum, r) => sum + r.scaledIncreaseMinor, 0n);
    expect(total).toBe(1_000n);
  });

  it("handles a zero total without dividing by zero", () => {
    const result = scaleToBudget([{ increaseMinor: 0n }], 1_000n);
    expect(result[0].scaledIncreaseMinor).toBe(0n);
  });

  it("handles an empty list", () => {
    expect(scaleToBudget([], 1_000n)).toEqual([]);
  });
});

describe("vestingPosition", () => {
  const grant: EquityGrant = {
    totalUnits: 4_800,
    grantDate: "2026-01-01",
    cliffMonths: 12,
    vestingMonths: 48,
    cadenceMonths: 1,
  };

  it("vests nothing before the cliff", () => {
    // A leaver on day one before the cliff is entitled to nothing; accruing
    // gradually towards it creates a liability nobody agreed to.
    const result = vestingPosition(grant, "2026-12-31");
    expect(result.vestedUnits).toBe(0);
    expect(result.isCliffPassed).toBe(false);
    expect(result.nextVestDate).toBe("2027-01-01");
    expect(result.nextVestUnits).toBe(1_200);
  });

  it("vests the whole cliff amount at once when it passes", () => {
    const result = vestingPosition(grant, "2027-01-01");
    expect(result.vestedUnits).toBe(1_200);
    expect(result.isCliffPassed).toBe(true);
  });

  it("vests monthly after the cliff", () => {
    const result = vestingPosition(grant, "2027-02-01");
    expect(result.vestedUnits).toBe(1_300);
  });

  it("is fully vested at the end", () => {
    const result = vestingPosition(grant, "2030-01-01");
    expect(result.vestedUnits).toBe(4_800);
    expect(result.unvestedUnits).toBe(0);
    expect(result.nextVestDate).toBeUndefined();
  });

  it("stays fully vested after the end", () => {
    expect(vestingPosition(grant, "2035-01-01").vestedUnits).toBe(4_800);
  });

  it("does not vest part of a quarter on a quarterly grant", () => {
    const quarterly: EquityGrant = { ...grant, cadenceMonths: 3 };
    // 14 months in: 4 completed quarters, so 12 months' worth.
    const result = vestingPosition(quarterly, "2027-03-01");
    expect(result.vestedUnits).toBe(1_200);
  });

  it("sums to exactly the grant with an awkward unit count", () => {
    const awkward: EquityGrant = { ...grant, totalUnits: 1_000 };
    const final = vestingPosition(awkward, "2030-01-01");
    expect(final.vestedUnits).toBe(1_000);

    // And no tranche overshoots along the way.
    const midway = vestingPosition(awkward, "2028-01-01");
    expect(midway.vestedUnits).toBeLessThanOrEqual(1_000);
  });

  it("handles a grant with no cliff", () => {
    const immediate: EquityGrant = { ...grant, cliffMonths: 0 };
    expect(vestingPosition(immediate, "2026-02-01").vestedUnits).toBe(100);
  });

  it("refuses an invalid grant rather than producing nonsense", () => {
    expect(() => vestingPosition({ ...grant, vestingMonths: 0 }, "2027-01-01")).toThrow(
      /positive vesting period/
    );
    expect(() => vestingPosition({ ...grant, cadenceMonths: 0 }, "2027-01-01")).toThrow(
      /positive vesting cadence/
    );
    expect(() => vestingPosition({ ...grant, cliffMonths: 60 }, "2027-01-01")).toThrow(
      /cliff cannot be longer/
    );
  });
});

describe("monthsBetween", () => {
  it("counts whole months", () => {
    expect(monthsBetween("2026-01-01", "2026-04-01")).toBe(3);
  });

  it("does not count a month until the day is reached", () => {
    expect(monthsBetween("2026-01-15", "2026-02-14")).toBe(0);
    expect(monthsBetween("2026-01-15", "2026-02-15")).toBe(1);
  });

  it("crosses a year boundary", () => {
    expect(monthsBetween("2026-11-01", "2027-02-01")).toBe(3);
  });

  it("rejects a malformed date", () => {
    expect(() => monthsBetween("Jan 2026", "2026-02-01")).toThrow(/YYYY-MM-DD/);
  });
});

describe("addMonths", () => {
  it("clamps to a shorter month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("handles a leap year", () => {
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });
});

describe("payGap", () => {
  const groups = {
    men: Array(10).fill(1_000_000_00n),
    women: Array(10).fill(900_000_00n),
  };

  it("computes the median gap as a percentage", () => {
    const result = payGap(groups, "men", "women");
    expect(result.medianGapPercent).toBe(10);
  });

  it("computes the mean gap", () => {
    expect(payGap(groups, "men", "women").meanGapPercent).toBe(10);
  });

  it("reports a negative gap when the comparison group is paid more", () => {
    const result = payGap(
      { men: Array(10).fill(900_000_00n), women: Array(10).fill(1_000_000_00n) },
      "men",
      "women"
    );
    expect(result.medianGapPercent).toBeLessThan(0);
  });

  it("suppresses a group too small to report without identifying people", () => {
    // In a group of two, publishing a median is publishing an individual's
    // salary — and pay equity analysis that discloses pay is self-defeating.
    const result = payGap(
      { men: Array(10).fill(1_000_000_00n), women: [900_000_00n, 950_000_00n] },
      "men",
      "women"
    );

    expect(result.suppressed).toContain("women");
    expect(result.rows.map((r) => r.group)).not.toContain("women");
    expect(result.medianGapPercent).toBeNull();
  });

  it("honours a custom minimum group size", () => {
    const result = payGap(
      { men: Array(3).fill(1_000_000_00n), women: Array(3).fill(900_000_00n) },
      "men",
      "women",
      2
    );
    expect(result.suppressed).toEqual([]);
    expect(result.medianGapPercent).toBe(10);
  });

  it("returns nulls when a group is missing entirely", () => {
    const result = payGap({ men: Array(10).fill(1_000_000_00n) }, "men", "women");
    expect(result.medianGapPercent).toBeNull();
  });
});

describe("median and mean", () => {
  it("finds the median of an odd-length list", () => {
    expect(median([3n, 1n, 2n])).toBe(2n);
  });

  it("averages the middle two of an even-length list", () => {
    expect(median([1n, 2n, 3n, 4n])).toBe(2n);
  });

  it("returns zero for an empty list rather than NaN", () => {
    expect(median([])).toBe(0n);
    expect(mean([])).toBe(0n);
  });

  it("computes a mean", () => {
    expect(mean([1n, 2n, 3n])).toBe(2n);
  });

  it("does not mutate its input", () => {
    const values = [3n, 1n, 2n];
    median(values);
    expect(values).toEqual([3n, 1n, 2n]);
  });
});
