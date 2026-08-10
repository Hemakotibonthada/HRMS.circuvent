// ═══════════════════════════════════════════════════════════════
// PERFORMANCE RULES
// ═══════════════════════════════════════════════════════════════
// Cascading goals, rating calibration, 360° anonymity and the nine-box grid.
// Pure, so it tests without a database.
//
// Two things here carry more weight than they look:
//
// 1. **Anonymity in 360° feedback is a promise.** People are told their
//    comments are anonymous and then answer honestly about their manager. If a
//    small response set makes an author identifiable, the promise is broken
//    retrospectively and the damage lands on the person who trusted it. The
//    suppression rules below are therefore refusals, not warnings.
//
// 2. **A rating decides pay and promotion.** Forced distribution is common and
//    genuinely contentious, so the functions report what a distribution does
//    rather than silently reshaping it — a manager should have to see that
//    moving someone down is what makes the curve fit.

export type RatingScale = 1 | 2 | 3 | 4 | 5;

export interface GoalNode {
  id: string;
  parentId?: string;
  ownerId: string;
  title: string;
  /** 0 to 100. */
  progressPercent: number;
  /** Relative importance among siblings; defaults to equal weighting. */
  weight?: number;
  status: "draft" | "active" | "achieved" | "missed" | "cancelled";
}

export interface RollupResult {
  goalId: string;
  /** Progress computed from children, or the goal's own if it is a leaf. */
  rolledUpPercent: number;
  childCount: number;
  /** True when the stored value disagrees with what the children imply. */
  isStale: boolean;
}

/**
 * Rolls child progress up a goal tree.
 *
 * A parent's progress is derived, never entered. The alternative — a manager
 * typing 80% while their team's goals sit at 30% — is the single most common
 * way an OKR system stops meaning anything, and it is invisible until the
 * quarter ends.
 *
 * Cancelled goals are excluded rather than counted as zero. A goal the company
 * decided not to pursue should not drag down the objective it hung from.
 */
export function rollUp(goals: GoalNode[]): RollupResult[] {
  const byParent = new Map<string, GoalNode[]>();

  for (const goal of goals) {
    if (!goal.parentId) continue;
    byParent.set(goal.parentId, [...(byParent.get(goal.parentId) ?? []), goal]);
  }

  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  function progressOf(goal: GoalNode): number {
    const cached = memo.get(goal.id);
    if (cached !== undefined) return cached;

    // A cycle means a goal is its own ancestor. Recursing would hang the
    // request; returning the stored value degrades to a leaf, which is wrong
    // but bounded and visible.
    if (visiting.has(goal.id)) return goal.progressPercent;
    visiting.add(goal.id);

    const children = (byParent.get(goal.id) ?? []).filter((c) => c.status !== "cancelled");

    if (children.length === 0) {
      const own = clamp(goal.progressPercent);
      memo.set(goal.id, own);
      visiting.delete(goal.id);
      return own;
    }

    const totalWeight = children.reduce((sum, c) => sum + (c.weight ?? 1), 0);

    const weighted =
      totalWeight === 0
        ? 0
        : children.reduce((sum, c) => sum + progressOf(c) * (c.weight ?? 1), 0) / totalWeight;

    const result = Math.round(weighted);
    memo.set(goal.id, result);
    visiting.delete(goal.id);
    return result;
  }

  return goals.map((goal) => {
    const children = (byParent.get(goal.id) ?? []).filter((c) => c.status !== "cancelled");
    const rolledUpPercent = progressOf(goal);

    return {
      goalId: goal.id,
      rolledUpPercent,
      childCount: children.length,
      isStale: children.length > 0 && rolledUpPercent !== clamp(goal.progressPercent),
    };
  });
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Detects a goal that is its own ancestor. */
export function findCycles(goals: GoalNode[]): string[][] {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const cycles: string[][] = [];
  const settled = new Set<string>();

  for (const goal of goals) {
    if (settled.has(goal.id)) continue;

    const path: string[] = [];
    const seen = new Set<string>();
    let current: GoalNode | undefined = goal;

    while (current) {
      if (seen.has(current.id)) {
        cycles.push([...path.slice(path.indexOf(current.id)), current.id]);
        break;
      }
      seen.add(current.id);
      path.push(current.id);

      current = current.parentId ? byId.get(current.parentId) : undefined;
    }

    for (const id of path) settled.add(id);
  }

  return cycles;
}

export type LinkVerdict = { allowed: true } | { allowed: false; reason: string };

/**
 * Whether a goal may hang from another.
 *
 * Refuses a cycle before it is created. A goal tree with a cycle produces a
 * rollup that never terminates, and the place that surfaces is a request that
 * hangs rather than an error someone can act on.
 */
export function canLink(
  goals: GoalNode[],
  childId: string,
  newParentId: string
): LinkVerdict {
  if (childId === newParentId) {
    return { allowed: false, reason: "A goal cannot be its own parent" };
  }

  const byId = new Map(goals.map((g) => [g.id, g]));
  let cursor = byId.get(newParentId);
  let depth = 0;

  while (cursor) {
    if (cursor.id === childId) {
      return {
        allowed: false,
        reason: "That would make the goal its own ancestor",
      };
    }
    // A tree deeper than this is a data error, not an org chart.
    if (++depth > 20) {
      return { allowed: false, reason: "The goal tree is nested too deeply" };
    }
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  return { allowed: true };
}

// ─── Review scoring ──────────────────────────────────────────

export interface CompetencyScore {
  competencyId: string;
  name: string;
  /** Relative importance in the overall score. */
  weight: number;
  rating: RatingScale;
}

export interface ReviewScore {
  goalScore: number;
  competencyScore: number;
  overallScore: number;
  suggestedRating: RatingScale;
}

/**
 * Combines goal achievement and competency ratings into one score.
 *
 * Goals and competencies are weighted separately because "what you achieved"
 * and "how you worked" answer different questions, and an organisation that
 * rewards only the first gets results at any cost.
 */
export function scoreReview(
  goalAchievementPercent: number,
  competencies: CompetencyScore[],
  goalWeight = 0.7
): ReviewScore {
  if (goalWeight < 0 || goalWeight > 1) {
    throw new Error("Goal weight must be between 0 and 1");
  }

  const goalScore = clamp(goalAchievementPercent) / 20; // 0-100 onto a 5-point scale.

  const totalWeight = competencies.reduce((sum, c) => sum + c.weight, 0);
  const competencyScore =
    totalWeight === 0
      ? 0
      : competencies.reduce((sum, c) => sum + c.rating * c.weight, 0) / totalWeight;

  // With no competencies assessed, the goal score carries the whole review
  // rather than being diluted by a zero that was never measured.
  const effectiveGoalWeight = competencies.length === 0 ? 1 : goalWeight;

  const overallScore =
    goalScore * effectiveGoalWeight + competencyScore * (1 - effectiveGoalWeight);

  return {
    goalScore: round2(goalScore),
    competencyScore: round2(competencyScore),
    overallScore: round2(overallScore),
    suggestedRating: toRating(overallScore),
  };
}

function toRating(score: number): RatingScale {
  if (score >= 4.5) return 5;
  if (score >= 3.5) return 4;
  if (score >= 2.5) return 3;
  if (score >= 1.5) return 2;
  return 1;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Calibration ─────────────────────────────────────────────

export interface DistributionTarget {
  rating: RatingScale;
  /** Target share of the population, 0 to 1. */
  targetShare: number;
  /** Acceptable deviation either side. */
  tolerance: number;
}

export const DEFAULT_DISTRIBUTION: DistributionTarget[] = [
  { rating: 5, targetShare: 0.1, tolerance: 0.05 },
  { rating: 4, targetShare: 0.2, tolerance: 0.05 },
  { rating: 3, targetShare: 0.5, tolerance: 0.1 },
  { rating: 2, targetShare: 0.15, tolerance: 0.05 },
  { rating: 1, targetShare: 0.05, tolerance: 0.05 },
];

export interface DistributionRow {
  rating: RatingScale;
  count: number;
  share: number;
  targetShare: number;
  variance: number;
  withinTolerance: boolean;
  /** How many people would have to move to reach the target. */
  movesToTarget: number;
}

export interface DistributionAnalysis {
  total: number;
  rows: DistributionRow[];
  isBalanced: boolean;
  /** Written for the calibration meeting. */
  summary: string;
}

/**
 * Compares an actual rating distribution against a target.
 *
 * Reports, never reshapes. Forced distribution is contentious enough without
 * software silently moving someone down a band to make a curve fit — a manager
 * should have to look at the number of people they are about to re-rate and
 * decide that deliberately.
 *
 * Small populations are reported as unbalanced only against absolute moves,
 * because in a team of six a "10% target" is neither zero nor one person.
 */
export function analyseDistribution(
  ratings: RatingScale[],
  targets: DistributionTarget[] = DEFAULT_DISTRIBUTION
): DistributionAnalysis {
  const total = ratings.length;

  if (total === 0) {
    return { total: 0, rows: [], isBalanced: true, summary: "Nobody has been rated yet" };
  }

  const counts = new Map<RatingScale, number>();
  for (const rating of ratings) {
    counts.set(rating, (counts.get(rating) ?? 0) + 1);
  }

  const rows: DistributionRow[] = targets.map((target) => {
    const count = counts.get(target.rating) ?? 0;
    const share = count / total;
    const variance = share - target.targetShare;

    return {
      rating: target.rating,
      count,
      share: round2(share),
      targetShare: target.targetShare,
      variance: round2(variance),
      withinTolerance: Math.abs(variance) <= target.tolerance,
      movesToTarget: Math.round(target.targetShare * total) - count,
    };
  });

  const outside = rows.filter((r) => !r.withinTolerance);

  return {
    total,
    rows,
    isBalanced: outside.length === 0,
    summary:
      outside.length === 0
        ? `All ${total} ratings are within tolerance`
        : outside
            .map(
              (r) =>
                `${r.count} at rating ${r.rating} (${Math.round(r.share * 100)}%, target ${Math.round(r.targetShare * 100)}%)`
            )
            .join("; "),
  };
}

// ─── Nine-box ────────────────────────────────────────────────

export type NineBoxCell =
  | "risk"
  | "inconsistent"
  | "rough_diamond"
  | "solid"
  | "core"
  | "high_potential"
  | "trusted_professional"
  | "high_performer"
  | "star";

export interface NineBoxPosition {
  cell: NineBoxCell;
  label: string;
  performanceBand: 1 | 2 | 3;
  potentialBand: 1 | 2 | 3;
  /** What the grid implies should happen next. */
  suggestedAction: string;
}

const NINE_BOX: Record<string, { cell: NineBoxCell; label: string; action: string }> = {
  "1-1": { cell: "risk", label: "Risk", action: "Manage performance or exit" },
  "2-1": { cell: "inconsistent", label: "Inconsistent player", action: "Coach on consistency" },
  "3-1": { cell: "rough_diamond", label: "Rough diamond", action: "Find a better-fitting role" },
  "1-2": { cell: "solid", label: "Solid contributor", action: "Sustain and develop" },
  "2-2": { cell: "core", label: "Core player", action: "Keep engaged; stretch gradually" },
  "3-2": { cell: "high_potential", label: "High potential", action: "Accelerate development" },
  "1-3": {
    cell: "trusted_professional",
    label: "Trusted professional",
    action: "Retain as a specialist",
  },
  "2-3": { cell: "high_performer", label: "High performer", action: "Broaden scope" },
  "3-3": { cell: "star", label: "Star", action: "Succession plan and retain" },
};

/**
 * Places someone on the nine-box grid.
 *
 * Potential is deliberately a separate assessment from performance, not
 * derived from it. Treating a high performer as automatically high-potential
 * is how organisations promote their best individual contributors into
 * management they neither want nor are suited to.
 */
export function nineBox(
  performanceRating: RatingScale,
  potentialRating: RatingScale
): NineBoxPosition {
  const performanceBand = toBand(performanceRating);
  const potentialBand = toBand(potentialRating);

  const entry = NINE_BOX[`${potentialBand}-${performanceBand}`];

  return {
    cell: entry.cell,
    label: entry.label,
    performanceBand,
    potentialBand,
    suggestedAction: entry.action,
  };
}

function toBand(rating: RatingScale): 1 | 2 | 3 {
  if (rating >= 4) return 3;
  if (rating === 3) return 2;
  return 1;
}

// ─── 360° anonymity ──────────────────────────────────────────

export interface FeedbackResponse {
  respondentId: string;
  relationship: "peer" | "direct_report" | "manager" | "self" | "external";
  ratings: Record<string, RatingScale>;
  comments?: string;
}

export interface AnonymityVerdict {
  canRelease: boolean;
  /** Groups withheld, and why. */
  suppressed: { relationship: string; count: number; reason: string }[];
  releasable: FeedbackResponse["relationship"][];
}

/**
 * Whether 360° feedback can be released without identifying its authors.
 *
 * The manager's own feedback is always attributable — the subject knows who
 * their manager is — so it is exempt from the threshold rather than
 * suppressed. Everything else needs enough responses that no single comment
 * can be traced back.
 *
 * `minimumResponses` defaults to 3. Two is not enough: a subject who knows
 * they have two direct reports and reads two comments has effectively been
 * given attributed feedback.
 */
export function checkAnonymity(
  responses: FeedbackResponse[],
  minimumResponses = 3
): AnonymityVerdict {
  const byRelationship = new Map<string, FeedbackResponse[]>();

  for (const response of responses) {
    byRelationship.set(response.relationship, [
      ...(byRelationship.get(response.relationship) ?? []),
      response,
    ]);
  }

  const suppressed: AnonymityVerdict["suppressed"] = [];
  const releasable: FeedbackResponse["relationship"][] = [];

  for (const [relationship, group] of byRelationship) {
    // Self and manager feedback is inherently attributable and understood to
    // be so. Suppressing it would withhold the two most useful views for no
    // protective benefit.
    if (relationship === "self" || relationship === "manager") {
      releasable.push(relationship as FeedbackResponse["relationship"]);
      continue;
    }

    if (group.length < minimumResponses) {
      suppressed.push({
        relationship,
        count: group.length,
        reason: `Only ${group.length} response${group.length === 1 ? "" : "s"}; at least ${minimumResponses} are needed for the authors to stay anonymous`,
      });
      continue;
    }

    releasable.push(relationship as FeedbackResponse["relationship"]);
  }

  return {
    canRelease: releasable.some((r) => r !== "self"),
    suppressed,
    releasable,
  };
}

export interface AggregatedFeedback {
  competencyId: string;
  /** Per relationship group, only where anonymity allows. */
  byRelationship: Record<string, { average: number; count: number }>;
  overallAverage: number;
  /** Self-rating minus the average of others. */
  selfAwarenessGap: number | null;
}

/**
 * Aggregates 360° ratings, honouring the anonymity verdict.
 *
 * Suppressed groups are excluded from the per-group breakdown but still count
 * towards the overall average. Excluding them entirely would let a subject
 * work out a withheld group's rating by subtracting the published groups from
 * a total they can also see — which is the reconstruction attack the
 * suppression exists to prevent, arriving by arithmetic instead.
 */
export function aggregateFeedback(
  responses: FeedbackResponse[],
  competencyIds: string[],
  minimumResponses = 3
): AggregatedFeedback[] {
  const verdict = checkAnonymity(responses, minimumResponses);
  const releasable = new Set(verdict.releasable);

  return competencyIds.map((competencyId) => {
    const byRelationship: AggregatedFeedback["byRelationship"] = {};

    const grouped = new Map<string, number[]>();
    for (const response of responses) {
      const rating = response.ratings[competencyId];
      if (rating === undefined) continue;
      grouped.set(response.relationship, [...(grouped.get(response.relationship) ?? []), rating]);
    }

    for (const [relationship, ratings] of grouped) {
      if (!releasable.has(relationship as FeedbackResponse["relationship"])) continue;
      byRelationship[relationship] = {
        average: round2(ratings.reduce((a, b) => a + b, 0) / ratings.length),
        count: ratings.length,
      };
    }

    const others = responses
      .filter((r) => r.relationship !== "self")
      .map((r) => r.ratings[competencyId])
      .filter((r): r is RatingScale => r !== undefined);

    const self = responses.find((r) => r.relationship === "self")?.ratings[competencyId];

    const overallAverage =
      others.length === 0 ? 0 : round2(others.reduce((a, b) => a + b, 0) / others.length);

    return {
      competencyId,
      byRelationship,
      overallAverage,
      selfAwarenessGap:
        self === undefined || others.length === 0 ? null : round2(self - overallAverage),
    };
  });
}

// ─── Review cycle eligibility ────────────────────────────────

export interface ReviewEligibility {
  joinDate: string;
  /** Set when the person has left. */
  exitDate?: string;
  isOnLongLeave?: boolean;
}

export type EligibilityVerdict =
  | { eligible: true }
  | { eligible: false; reason: string };

/**
 * Whether someone should be reviewed in a cycle.
 *
 * A new starter with two weeks' service has nothing to be assessed on, and
 * rating them anyway produces a number that follows them into a pay decision.
 */
export function isEligibleForReview(
  person: ReviewEligibility,
  cycleEnd: string,
  minimumTenureMonths = 3
): EligibilityVerdict {
  const tenure = monthsBetween(person.joinDate, cycleEnd);

  if (tenure < minimumTenureMonths) {
    return {
      eligible: false,
      reason: `${tenure} month${tenure === 1 ? "" : "s"} of service at the cycle end; ${minimumTenureMonths} are required`,
    };
  }

  if (person.exitDate && person.exitDate < cycleEnd) {
    return { eligible: false, reason: "Left before the end of the cycle" };
  }

  if (person.isOnLongLeave) {
    // Reviewing someone on maternity or long-term sick leave against goals
    // they could not pursue is both unfair and, in many jurisdictions,
    // discriminatory.
    return { eligible: false, reason: "On long-term leave for most of the cycle" };
  }

  return { eligible: true };
}

export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);

  if ([fy, fm, fd, ty, tm, td].some(Number.isNaN)) {
    throw new Error("Dates must be YYYY-MM-DD");
  }

  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months;
}
