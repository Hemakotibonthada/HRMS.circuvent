// @vitest-environment node
//
// These models drive decisions about people's careers and pay, so the tests
// pin both correctness and restraint: the scoring must be explainable, must
// not fire on ordinary data, and must not use protected characteristics.

import { describe, expect, it } from "vitest";
import {
  assessAttritionRisk,
  assessCohort,
  bandFor,
  type AttritionSignals,
} from "@/lib/intelligence/attrition";
import {
  detectDuplicateClaims,
  detectExpenseAnomalies,
  detectImpossibleTravel,
  detectPayrollAnomalies,
  median,
  medianAbsoluteDeviation,
  prioritise,
  robustZScore,
  type AttendancePunch,
} from "@/lib/intelligence/anomaly";

function signals(over: Partial<AttritionSignals> = {}): AttritionSignals {
  return {
    employeeId: "emp-1",
    tenureMonths: 36,
    monthsSinceLastPromotion: 12,
    monthsSinceLastRaise: 6,
    compaRatio: 1.0,
    engagementScore: 4,
    performanceRating: 4,
    managerChanges12m: 0,
    leaveDaysLast3m: 4,
    absencesLast3m: 0,
    avgWeeklyOvertimeHours: 1,
    ...over,
  };
}

describe("attrition risk", () => {
  it("scores a contented employee as low risk", () => {
    const result = assessAttritionRisk(signals());
    expect(result.band).toBe("low");
    expect(result.factors).toHaveLength(0);
  });

  it("always explains its score", () => {
    // A manager cannot act on "high risk" with no reason attached.
    const result = assessAttritionRisk(
      signals({ compaRatio: 0.7, engagementScore: 2, managerChanges12m: 3 })
    );
    expect(result.factors.length).toBeGreaterThan(0);
    for (const factor of result.factors) {
      expect(factor.description.length).toBeGreaterThan(10);
      expect(factor.weight).toBeGreaterThan(0);
    }
  });

  it("orders factors by contribution", () => {
    const result = assessAttritionRisk(
      signals({ compaRatio: 0.7, engagementScore: 2, avgWeeklyOvertimeHours: 12 })
    );
    const weights = result.factors.map((f) => f.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });

  it("flags pay well below market", () => {
    const result = assessAttritionRisk(signals({ compaRatio: 0.7 }));
    expect(result.factors.map((f) => f.code)).toContain("pay_well_below_median");
    expect(result.recommendations.join(" ")).toMatch(/compensation/i);
  });

  it("flags repeated manager changes", () => {
    // Among the strongest predictors, and invisible in a normal report.
    const result = assessAttritionRisk(signals({ managerChanges12m: 3 }));
    expect(result.factors.map((f) => f.code)).toContain("manager_churn");
  });

  it("does not flag a short-tenure employee for lack of promotion", () => {
    // Otherwise every recent hire appears at risk, and the list becomes noise.
    const result = assessAttritionRisk(
      signals({ tenureMonths: 8, monthsSinceLastPromotion: null })
    );
    expect(result.factors.map((f) => f.code)).not.toContain("career_stalled");
  });

  it("flags a long-tenure employee who has never been promoted", () => {
    const result = assessAttritionRisk(
      signals({ tenureMonths: 48, monthsSinceLastPromotion: null })
    );
    expect(result.factors.map((f) => f.code)).toContain("career_stalled");
  });

  it("singles out strong performers showing several signals", () => {
    const result = assessAttritionRisk(
      signals({ performanceRating: 5, compaRatio: 0.75, engagementScore: 2 })
    );
    expect(result.factors.map((f) => f.code)).toContain("high_performer_at_risk");
    expect(result.recommendations.join(" ")).toMatch(/retention/i);
  });

  it("short-circuits an employee already serving notice", () => {
    // They have left; scoring them only clutters the manager's queue.
    const result = assessAttritionRisk(signals({ isServingNotice: true }));
    expect(result.score).toBe(100);
    expect(result.factors).toHaveLength(1);
    expect(result.recommendations[0]).toMatch(/knowledge transfer/i);
  });

  it("caps the score at 100", () => {
    const result = assessAttritionRisk(
      signals({
        compaRatio: 0.5,
        monthsSinceLastRaise: 48,
        monthsSinceLastPromotion: 60,
        engagementScore: 1,
        managerChanges12m: 4,
        avgWeeklyOvertimeHours: 20,
        absencesLast3m: 8,
        performanceRating: 5,
        tenureMonths: 18,
      })
    );
    expect(result.score).toBe(100);
    expect(result.band).toBe("high");
  });

  it("reports lower confidence when signals are missing", () => {
    // A score built on two of nine signals must not look as certain as one
    // built on all of them.
    const complete = assessAttritionRisk(signals());
    const sparse = assessAttritionRisk(
      signals({
        compaRatio: null,
        engagementScore: null,
        performanceRating: null,
        monthsSinceLastPromotion: null,
        monthsSinceLastRaise: null,
      })
    );
    expect(complete.confidence).toBe(1);
    expect(sparse.confidence).toBeLessThan(0.6);
  });

  it("deduplicates recommendations", () => {
    const result = assessAttritionRisk(
      signals({ avgWeeklyOvertimeHours: 12, engagementScore: 2 })
    );
    expect(new Set(result.recommendations).size).toBe(result.recommendations.length);
  });

  it("maps scores to bands at the documented thresholds", () => {
    expect(bandFor(0)).toBe("low");
    expect(bandFor(29)).toBe("low");
    expect(bandFor(30)).toBe("moderate");
    expect(bandFor(50)).toBe("elevated");
    expect(bandFor(70)).toBe("high");
    expect(bandFor(100)).toBe("high");
  });
});

describe("assessCohort", () => {
  it("returns only employees worth attention, highest risk first", () => {
    // A list of everyone sorted by risk is not actionable.
    const cohort = [
      signals({ employeeId: "calm" }),
      signals({ employeeId: "at-risk", compaRatio: 0.7, engagementScore: 2, managerChanges12m: 3 }),
      signals({ employeeId: "slipping", engagementScore: 2, avgWeeklyOvertimeHours: 12 }),
    ];

    const result = assessCohort(cohort);
    expect(result.map((r) => r.employeeId)).not.toContain("calm");
    expect(result[0].score).toBeGreaterThanOrEqual(result[result.length - 1].score);
  });

  it("can be widened to include moderate risk", () => {
    const cohort = [signals({ employeeId: "mild", compaRatio: 0.85, monthsSinceLastRaise: 20 })];
    expect(assessCohort(cohort, "elevated")).toHaveLength(0);
    expect(assessCohort(cohort, "moderate")).toHaveLength(1);
  });
});

describe("robust statistics", () => {
  it("computes the median for odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("is not dragged by a single extreme value, unlike the mean", () => {
    // One director's salary would inflate a standard deviation enough to hide
    // every other outlier.
    const salaries = [50_000, 52_000, 51_000, 49_000, 5_000_000];
    expect(median(salaries)).toBe(51_000);
    expect(medianAbsoluteDeviation(salaries)).toBeLessThan(3_000);
  });

  it("returns infinity when the sample has no spread but the value differs", () => {
    expect(robustZScore(100, [50, 50, 50, 50])).toBe(Number.POSITIVE_INFINITY);
    expect(robustZScore(50, [50, 50, 50, 50])).toBe(0);
  });
});

describe("payroll anomalies", () => {
  const usual = [50_000, 51_000, 50_500, 49_800];

  it("passes a normal payslip", () => {
    expect(
      detectPayrollAnomalies({
        recordId: "p1",
        employeeId: "e1",
        netPay: 50_200,
        gross: 65_000,
        totalDeductions: 14_800,
        lopDays: 0,
        workingDays: 22,
        history: usual,
      })
    ).toHaveLength(0);
  });

  it("flags a payslip that pays nothing", () => {
    const found = detectPayrollAnomalies({
      recordId: "p1",
      employeeId: "e1",
      netPay: 0,
      gross: 65_000,
      totalDeductions: 65_000,
      lopDays: 0,
      workingDays: 22,
      history: usual,
    });
    expect(found.map((a) => a.code)).toContain("net_pay_zero");
    expect(found[0].severity).toBe("critical");
  });

  it("flags deductions larger than gross pay", () => {
    const found = detectPayrollAnomalies({
      recordId: "p1",
      employeeId: "e1",
      netPay: 0,
      gross: 50_000,
      totalDeductions: 60_000,
      lopDays: 0,
      workingDays: 22,
      history: usual,
    });
    expect(found.map((a) => a.code)).toContain("deductions_exceed_gross");
  });

  it("flags a large spike with the multiple in the message", () => {
    // "3.4x usual" is actionable; "unusual" is not.
    const found = detectPayrollAnomalies({
      recordId: "p1",
      employeeId: "e1",
      netPay: 170_000,
      gross: 200_000,
      totalDeductions: 30_000,
      lopDays: 0,
      workingDays: 22,
      history: usual,
    });
    const spike = found.find((a) => a.code === "net_pay_spike");
    expect(spike).toBeDefined();
    expect(spike!.message).toMatch(/3\.4x/);
  });

  it("flags halved pay when no unpaid days explain it", () => {
    const found = detectPayrollAnomalies({
      recordId: "p1",
      employeeId: "e1",
      netPay: 20_000,
      gross: 30_000,
      totalDeductions: 10_000,
      lopDays: 0,
      workingDays: 22,
      history: usual,
    });
    expect(found.map((a) => a.code)).toContain("net_pay_drop");
  });

  it("does not flag reduced pay that unpaid leave explains", () => {
    const found = detectPayrollAnomalies({
      recordId: "p1",
      employeeId: "e1",
      netPay: 25_000,
      gross: 32_000,
      totalDeductions: 7_000,
      lopDays: 10,
      workingDays: 22,
      history: usual,
    });
    expect(found.map((a) => a.code)).not.toContain("net_pay_drop");
  });

  it("does not compare against too little history", () => {
    // Two prior periods is not enough to call anything unusual.
    expect(
      detectPayrollAnomalies({
        recordId: "p1",
        employeeId: "e1",
        netPay: 500_000,
        gross: 600_000,
        totalDeductions: 100_000,
        lopDays: 0,
        workingDays: 22,
        history: [50_000, 51_000],
      })
    ).toHaveLength(0);
  });
});

describe("impossible travel", () => {
  const bangalore = { latitude: 12.9716, longitude: 77.5946 };
  const mumbai = { latitude: 19.076, longitude: 72.8777 };

  function punch(over: Partial<AttendancePunch>): AttendancePunch {
    return {
      recordId: "a1",
      employeeId: "e1",
      at: new Date("2026-04-06T09:00:00Z"),
      method: "mobile",
      ...bangalore,
      ...over,
    };
  }

  it("accepts punches from the same place", () => {
    expect(
      detectImpossibleTravel([
        punch({ recordId: "a1" }),
        punch({ recordId: "a2", at: new Date("2026-04-06T18:00:00Z") }),
      ])
    ).toHaveLength(0);
  });

  it("accepts a genuine flight between cities", () => {
    // 845 km in four hours is a normal journey and must not be flagged.
    expect(
      detectImpossibleTravel([
        punch({ recordId: "a1" }),
        punch({ recordId: "a2", at: new Date("2026-04-06T13:00:00Z"), ...mumbai }),
      ])
    ).toHaveLength(0);
  });

  it("flags travel faster than any aircraft", () => {
    const found = detectImpossibleTravel([
      punch({ recordId: "a1" }),
      punch({ recordId: "a2", at: new Date("2026-04-06T09:15:00Z"), ...mumbai }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].code).toBe("impossible_travel");
    expect(found[0].evidence?.impliedSpeedKmh).toBeGreaterThan(900);
  });

  it("flags two punches at the same instant from different cities", () => {
    const found = detectImpossibleTravel([
      punch({ recordId: "a1" }),
      punch({ recordId: "a2", ...mumbai }),
    ]);
    expect(found[0].code).toBe("simultaneous_punch");
  });

  it("ignores GPS drift", () => {
    // Metres of jitter between two punches is the receiver, not movement.
    expect(
      detectImpossibleTravel([
        punch({ recordId: "a1" }),
        punch({
          recordId: "a2",
          at: new Date("2026-04-06T09:00:30Z"),
          latitude: 12.9718,
          longitude: 77.5948,
        }),
      ])
    ).toHaveLength(0);
  });

  it("ignores punches with no location", () => {
    expect(
      detectImpossibleTravel([
        { recordId: "a1", employeeId: "e1", at: new Date(), method: "web" },
        { recordId: "a2", employeeId: "e1", at: new Date(), method: "web" },
      ])
    ).toHaveLength(0);
  });
});

describe("expense anomalies", () => {
  const peers = [1_200, 1_500, 1_100, 1_350];

  it("passes an ordinary claim", () => {
    expect(
      detectExpenseAnomalies({
        claimId: "c1",
        employeeId: "e1",
        amount: 1_247,
        category: "meals",
        expenseDate: "2026-04-06",
        hasReceipt: true,
        peerAmounts: peers,
      })
    ).toHaveLength(0);
  });

  it("flags a missing receipt above the trivial threshold", () => {
    const found = detectExpenseAnomalies({
      claimId: "c1",
      employeeId: "e1",
      amount: 4_500,
      category: "travel",
      expenseDate: "2026-04-06",
      hasReceipt: false,
      peerAmounts: peers,
    });
    expect(found.map((a) => a.code)).toContain("missing_receipt");
  });

  it("flags an amount just under an approval threshold", () => {
    // The signature of splitting a claim to stay below a limit.
    const found = detectExpenseAnomalies({
      claimId: "c1",
      employeeId: "e1",
      amount: 9_800,
      category: "travel",
      expenseDate: "2026-04-06",
      hasReceipt: true,
      peerAmounts: peers,
    });
    const flag = found.find((a) => a.code === "just_under_threshold");
    expect(flag?.evidence?.threshold).toBe(10_000);
  });

  it("notes an exactly round amount as information, not an accusation", () => {
    const found = detectExpenseAnomalies({
      claimId: "c1",
      employeeId: "e1",
      amount: 5_000,
      category: "travel",
      expenseDate: "2026-04-06",
      hasReceipt: true,
      peerAmounts: peers,
    });
    expect(found.find((a) => a.code === "suspiciously_round")?.severity).toBe("info");
  });

  it("flags a claim far larger than the employee's norm", () => {
    const found = detectExpenseAnomalies({
      claimId: "c1",
      employeeId: "e1",
      amount: 47_000,
      category: "travel",
      expenseDate: "2026-04-06",
      hasReceipt: true,
      peerAmounts: peers,
    });
    expect(found.map((a) => a.code)).toContain("unusually_large");
  });
});

describe("duplicate claims", () => {
  const base = {
    employeeId: "e1",
    amount: 2_500,
    category: "meals",
    expenseDate: "2026-04-06",
    merchant: "Blue Cafe",
    hasReceipt: true,
    peerAmounts: [],
  };

  it("flags the second of two identical claims", () => {
    const found = detectDuplicateClaims([
      { ...base, claimId: "c1" },
      { ...base, claimId: "c2" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].subjectId).toBe("c2");
    expect(found[0].evidence?.matchesClaimId).toBe("c1");
  });

  it("does not flag claims that differ", () => {
    expect(
      detectDuplicateClaims([
        { ...base, claimId: "c1" },
        { ...base, claimId: "c2", amount: 2_501 },
        { ...base, claimId: "c3", expenseDate: "2026-04-07" },
        { ...base, claimId: "c4", employeeId: "e2" },
        { ...base, claimId: "c5", merchant: "Red Cafe" },
      ])
    ).toHaveLength(0);
  });

  it("ignores merchant casing and surrounding spaces", () => {
    const found = detectDuplicateClaims([
      { ...base, claimId: "c1", merchant: "Blue Cafe" },
      { ...base, claimId: "c2", merchant: "  blue cafe " },
    ]);
    expect(found).toHaveLength(1);
  });
});

describe("prioritise", () => {
  it("puts critical findings first and informational last", () => {
    const sorted = prioritise([
      { code: "a", severity: "info", message: "", subjectId: "1" },
      { code: "b", severity: "critical", message: "", subjectId: "2" },
      { code: "c", severity: "warning", message: "", subjectId: "3" },
    ]);
    expect(sorted.map((a) => a.severity)).toEqual(["critical", "warning", "info"]);
  });
});
