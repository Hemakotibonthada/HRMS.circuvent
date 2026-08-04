// ═══════════════════════════════════════════════════════════════
// ATTRITION RISK SCORING
// ═══════════════════════════════════════════════════════════════
// Predicts who is likely to resign, so a manager can have a conversation
// before a resignation letter rather than after.
//
// This is a transparent additive model, not a black box, and that is a
// deliberate choice. An HR system that tells a manager "Priya is high risk"
// without saying why is unusable: the manager cannot act on it, cannot judge
// whether it is wrong, and the organisation cannot defend the decision if
// challenged. Every score here carries the factors that produced it.
//
// The weights encode well-documented drivers of voluntary turnover:
// compensation position, time since last promotion or raise, manager churn,
// engagement, and tenure. They are starting points to be calibrated against a
// tenant's own exit data, not universal truths.
//
// Deliberate exclusions: age, gender, marital status, ethnicity and anything
// derived from them. Beyond being unlawful grounds for employment decisions in
// most jurisdictions, a model built on them mostly learns to reproduce
// existing bias.

export interface AttritionSignals {
  employeeId: string;
  /** Whole months of service. */
  tenureMonths: number;
  /** Months since the last promotion. Null when never promoted. */
  monthsSinceLastPromotion: number | null;
  /** Months since the last salary revision. Null when never revised. */
  monthsSinceLastRaise: number | null;
  /**
   * Pay relative to the median for the same designation, where 1.0 is the
   * median. Null when there are too few comparators to be meaningful.
   */
  compaRatio: number | null;
  /** Latest engagement survey score, 1-5. */
  engagementScore: number | null;
  /** Latest performance rating, 1-5. */
  performanceRating: number | null;
  /** Reporting-manager changes in the last twelve months. */
  managerChanges12m: number;
  /** Approved leave days in the last three months. */
  leaveDaysLast3m: number;
  /** Unplanned absences in the last three months. */
  absencesLast3m: number;
  /** Average weekly overtime hours over the last three months. */
  avgWeeklyOvertimeHours: number;
  /** Whether the employee is currently serving notice. */
  isServingNotice?: boolean;
}

export type RiskBand = "low" | "moderate" | "elevated" | "high";

export interface RiskFactor {
  code: string;
  /** Shown to the manager. Phrased as an observation, not a judgement. */
  description: string;
  /** Contribution to the score, 0-100. */
  weight: number;
}

export interface AttritionAssessment {
  employeeId: string;
  /** 0-100. Higher means more likely to leave. */
  score: number;
  band: RiskBand;
  factors: RiskFactor[];
  /** Suggested interventions, most impactful first. */
  recommendations: string[];
  /**
   * How much of the model could be evaluated, 0-1. A score built on two of
   * eight signals should not be presented with the same confidence as one
   * built on all of them.
   */
  confidence: number;
}

const BANDS: { band: RiskBand; min: number }[] = [
  { band: "high", min: 70 },
  { band: "elevated", min: 50 },
  { band: "moderate", min: 30 },
  { band: "low", min: 0 },
];

export function bandFor(score: number): RiskBand {
  return BANDS.find((b) => score >= b.min)!.band;
}

/** Signals that were available, for the confidence calculation. */
function countAvailable(signals: AttritionSignals): { available: number; total: number } {
  const optional = [
    signals.monthsSinceLastPromotion,
    signals.monthsSinceLastRaise,
    signals.compaRatio,
    signals.engagementScore,
    signals.performanceRating,
  ];
  // Tenure, manager changes, leave and overtime are always present.
  return { available: 4 + optional.filter((v) => v !== null).length, total: 9 };
}

export function assessAttritionRisk(signals: AttritionSignals): AttritionAssessment {
  const factors: RiskFactor[] = [];

  // Someone already serving notice has left; scoring them is noise in the
  // manager's queue.
  if (signals.isServingNotice) {
    return {
      employeeId: signals.employeeId,
      score: 100,
      band: "high",
      factors: [
        { code: "serving_notice", description: "Currently serving notice period", weight: 100 },
      ],
      recommendations: ["Begin knowledge transfer and backfill planning"],
      confidence: 1,
    };
  }

  // ── Compensation position ──
  if (signals.compaRatio !== null) {
    if (signals.compaRatio < 0.8) {
      factors.push({
        code: "pay_well_below_median",
        description: `Paid ${Math.round((1 - signals.compaRatio) * 100)}% below the median for this role`,
        weight: 25,
      });
    } else if (signals.compaRatio < 0.92) {
      factors.push({
        code: "pay_below_median",
        description: "Paid below the median for this role",
        weight: 12,
      });
    }
  }

  // ── Time since last raise ──
  if (signals.monthsSinceLastRaise !== null && signals.monthsSinceLastRaise >= 18) {
    factors.push({
      code: "no_recent_raise",
      description: `No salary revision in ${signals.monthsSinceLastRaise} months`,
      weight: signals.monthsSinceLastRaise >= 30 ? 18 : 10,
    });
  }

  // ── Career progression ──
  // Only meaningful once someone has been in role long enough to expect
  // movement; flagging a six-month hire as "not promoted" is noise.
  if (signals.tenureMonths >= 24) {
    const stalled = signals.monthsSinceLastPromotion ?? signals.tenureMonths;
    if (stalled >= 36) {
      factors.push({
        code: "career_stalled",
        description: `No promotion in ${stalled} months`,
        weight: 18,
      });
    } else if (stalled >= 24) {
      factors.push({
        code: "promotion_due",
        description: `No promotion in ${stalled} months`,
        weight: 9,
      });
    }
  }

  // ── Engagement ──
  if (signals.engagementScore !== null) {
    if (signals.engagementScore <= 2) {
      factors.push({
        code: "low_engagement",
        description: `Engagement score of ${signals.engagementScore} out of 5`,
        weight: 22,
      });
    } else if (signals.engagementScore <= 3) {
      factors.push({
        code: "moderate_engagement",
        description: `Engagement score of ${signals.engagementScore} out of 5`,
        weight: 10,
      });
    }
  }

  // ── Manager churn ──
  // Repeated manager changes are among the strongest predictors of voluntary
  // exit, and are usually invisible in a normal report.
  if (signals.managerChanges12m >= 2) {
    factors.push({
      code: "manager_churn",
      description: `${signals.managerChanges12m} reporting-manager changes in the last year`,
      weight: 15,
    });
  }

  // ── Sustained overtime ──
  if (signals.avgWeeklyOvertimeHours >= 10) {
    factors.push({
      code: "sustained_overtime",
      description: `Averaging ${Math.round(signals.avgWeeklyOvertimeHours)} hours of overtime per week`,
      weight: 16,
    });
  } else if (signals.avgWeeklyOvertimeHours >= 6) {
    factors.push({
      code: "elevated_overtime",
      description: "Consistently working beyond scheduled hours",
      weight: 8,
    });
  }

  // ── Absence pattern ──
  if (signals.absencesLast3m >= 5) {
    factors.push({
      code: "frequent_absence",
      description: `${signals.absencesLast3m} unplanned absences in the last quarter`,
      weight: 12,
    });
  }

  // ── High performer at risk ──
  // Scored separately because losing a strong performer costs far more than
  // losing an average one, and the intervention is different.
  if (
    signals.performanceRating !== null &&
    signals.performanceRating >= 4 &&
    factors.length >= 2
  ) {
    factors.push({
      code: "high_performer_at_risk",
      description: "Strong performer showing several risk indicators",
      weight: 12,
    });
  }

  // ── Tenure shape ──
  // The 12-24 month window is when people who joined for the wrong reasons
  // tend to leave; beyond five years, attachment costs rise.
  if (signals.tenureMonths >= 12 && signals.tenureMonths <= 24) {
    factors.push({
      code: "tenure_risk_window",
      description: "In the 1-2 year window where voluntary exits cluster",
      weight: 8,
    });
  }

  const raw = factors.reduce((sum, f) => sum + f.weight, 0);
  // Capped rather than normalised: four serious problems is not meaningfully
  // different from five, and a raw sum would let minor factors push everyone
  // into the top band.
  const score = Math.min(100, raw);

  const { available, total } = countAvailable(signals);

  return {
    employeeId: signals.employeeId,
    score,
    band: bandFor(score),
    factors: [...factors].sort((a, b) => b.weight - a.weight),
    recommendations: recommendationsFor(factors),
    confidence: Number((available / total).toFixed(2)),
  };
}

/** Actions matched to the factors actually present, most impactful first. */
function recommendationsFor(factors: RiskFactor[]): string[] {
  const codes = new Set(factors.map((f) => f.code));
  const actions: { code: string; action: string }[] = [
    { code: "pay_well_below_median", action: "Review compensation against the market band for this role" },
    { code: "pay_below_median", action: "Review compensation against the market band for this role" },
    { code: "no_recent_raise", action: "Consider an off-cycle salary review" },
    { code: "career_stalled", action: "Agree a development plan with a defined progression path" },
    { code: "promotion_due", action: "Discuss career progression at the next check-in" },
    { code: "low_engagement", action: "Hold a one-to-one to understand what has changed" },
    { code: "moderate_engagement", action: "Hold a one-to-one to understand what has changed" },
    { code: "manager_churn", action: "Keep the reporting line stable for the next two quarters" },
    { code: "sustained_overtime", action: "Review workload and redistribute where possible" },
    { code: "elevated_overtime", action: "Review workload and redistribute where possible" },
    { code: "frequent_absence", action: "Check in on wellbeing and any support needed" },
    { code: "high_performer_at_risk", action: "Prioritise a retention conversation this week" },
  ];

  return [
    ...new Set(actions.filter((a) => codes.has(a.code)).map((a) => a.action)),
  ];
}

/**
 * Scores a cohort, returning only those worth a manager's attention.
 *
 * A list of everyone sorted by risk is not actionable; a manager with forty
 * reports will read the top few and ignore the rest. Low-risk entries are
 * dropped so the list stays short enough to act on.
 */
export function assessCohort(
  cohort: AttritionSignals[],
  minimumBand: RiskBand = "elevated"
): AttritionAssessment[] {
  const order: RiskBand[] = ["low", "moderate", "elevated", "high"];
  const threshold = order.indexOf(minimumBand);

  return cohort
    .map(assessAttritionRisk)
    .filter((a) => order.indexOf(a.band) >= threshold)
    .sort((a, b) => b.score - a.score);
}
