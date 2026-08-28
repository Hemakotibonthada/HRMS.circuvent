// @vitest-environment node
//
// Anonymity in 360° feedback is a promise made to people before they answer
// honestly about their manager. These tests pin the cases where it can be
// broken — including by arithmetic rather than by disclosure — and the cases
// where a rating that decides pay would be produced from nothing.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISTRIBUTION,
  aggregateFeedback,
  analyseDistribution,
  canLink,
  checkAnonymity,
  findCycles,
  isEligibleForReview,
  monthsBetween,
  nineBox,
  rollUp,
  scoreReview,
  type FeedbackResponse,
  type GoalNode,
  type RatingScale,
} from "@/lib/performance";

function goal(over: Partial<GoalNode> = {}): GoalNode {
  return {
    id: "g1",
    ownerId: "e1",
    title: "Goal",
    progressPercent: 0,
    status: "active",
    ...over,
  };
}

describe("rollUp", () => {
  it("leaves a leaf goal's own progress alone", () => {
    const result = rollUp([goal({ progressPercent: 40 })]);
    expect(result[0].rolledUpPercent).toBe(40);
    expect(result[0].isStale).toBe(false);
  });

  it("averages children into the parent", () => {
    const goals = [
      goal({ id: "parent", progressPercent: 0 }),
      goal({ id: "a", parentId: "parent", progressPercent: 100 }),
      goal({ id: "b", parentId: "parent", progressPercent: 0 }),
    ];

    expect(rollUp(goals).find((r) => r.goalId === "parent")?.rolledUpPercent).toBe(50);
  });

  it("respects child weights", () => {
    const goals = [
      goal({ id: "parent" }),
      goal({ id: "a", parentId: "parent", progressPercent: 100, weight: 3 }),
      goal({ id: "b", parentId: "parent", progressPercent: 0, weight: 1 }),
    ];

    expect(rollUp(goals).find((r) => r.goalId === "parent")?.rolledUpPercent).toBe(75);
  });

  it("flags a parent whose stored progress disagrees with its children", () => {
    // A manager typing 80% while their team sits at 30% is the single most
    // common way an OKR system stops meaning anything.
    const goals = [
      goal({ id: "parent", progressPercent: 80 }),
      goal({ id: "a", parentId: "parent", progressPercent: 30 }),
    ];

    const parent = rollUp(goals).find((r) => r.goalId === "parent");
    expect(parent?.rolledUpPercent).toBe(30);
    expect(parent?.isStale).toBe(true);
  });

  it("excludes cancelled children rather than counting them as zero", () => {
    // A goal the company decided not to pursue should not drag down the
    // objective it hung from.
    const goals = [
      goal({ id: "parent" }),
      goal({ id: "a", parentId: "parent", progressPercent: 100 }),
      goal({ id: "b", parentId: "parent", progressPercent: 0, status: "cancelled" }),
    ];

    expect(rollUp(goals).find((r) => r.goalId === "parent")?.rolledUpPercent).toBe(100);
  });

  it("rolls up through several levels", () => {
    const goals = [
      goal({ id: "top" }),
      goal({ id: "mid", parentId: "top" }),
      goal({ id: "leaf1", parentId: "mid", progressPercent: 60 }),
      goal({ id: "leaf2", parentId: "mid", progressPercent: 40 }),
    ];

    expect(rollUp(goals).find((r) => r.goalId === "top")?.rolledUpPercent).toBe(50);
  });

  it("clamps nonsensical progress values", () => {
    expect(rollUp([goal({ progressPercent: 150 })])[0].rolledUpPercent).toBe(100);
    expect(rollUp([goal({ progressPercent: -20 })])[0].rolledUpPercent).toBe(0);
    expect(rollUp([goal({ progressPercent: NaN })])[0].rolledUpPercent).toBe(0);
  });

  it("terminates on a cycle rather than hanging", () => {
    // Recursing would hang the request; a bounded wrong answer is visible.
    const goals = [
      goal({ id: "a", parentId: "b", progressPercent: 10 }),
      goal({ id: "b", parentId: "a", progressPercent: 20 }),
    ];

    expect(() => rollUp(goals)).not.toThrow();
  });

  it("treats a parent whose children are all cancelled as a leaf", () => {
    const goals = [
      goal({ id: "parent", progressPercent: 70 }),
      goal({ id: "a", parentId: "parent", status: "cancelled" }),
    ];

    expect(rollUp(goals).find((r) => r.goalId === "parent")?.rolledUpPercent).toBe(70);
  });
});

describe("findCycles", () => {
  it("finds none in a well-formed tree", () => {
    expect(
      findCycles([goal({ id: "a" }), goal({ id: "b", parentId: "a" })])
    ).toEqual([]);
  });

  it("finds a two-goal cycle", () => {
    const cycles = findCycles([
      goal({ id: "a", parentId: "b" }),
      goal({ id: "b", parentId: "a" }),
    ]);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it("finds a self-referencing goal", () => {
    expect(findCycles([goal({ id: "a", parentId: "a" })]).length).toBeGreaterThan(0);
  });
});

describe("canLink", () => {
  const goals = [
    goal({ id: "top" }),
    goal({ id: "mid", parentId: "top" }),
    goal({ id: "leaf", parentId: "mid" }),
  ];

  it("allows a normal link", () => {
    expect(canLink(goals, "leaf", "top")).toEqual({ allowed: true });
  });

  it("refuses a goal parenting itself", () => {
    const verdict = canLink(goals, "top", "top");
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/own parent/);
  });

  it("refuses a link that would create a cycle", () => {
    // Refused before creation: a cycle produces a rollup that never
    // terminates, and that surfaces as a hung request.
    const verdict = canLink(goals, "top", "leaf");
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toMatch(/own ancestor/);
  });

  it("refuses an excessively deep tree", () => {
    const deep = Array.from({ length: 25 }, (_, i) =>
      goal({ id: `g${i}`, parentId: i > 0 ? `g${i - 1}` : undefined })
    );
    const verdict = canLink(deep, "new", "g24");
    expect(verdict.allowed).toBe(false);
  });
});

describe("scoreReview", () => {
  const competencies = [
    { competencyId: "c1", name: "Collaboration", weight: 1, rating: 4 as RatingScale },
    { competencyId: "c2", name: "Ownership", weight: 1, rating: 2 as RatingScale },
  ];

  it("combines goals and competencies by weight", () => {
    // 80% goals is 4.0; competencies average 3.0. At 0.7/0.3 that is 3.7.
    const result = scoreReview(80, competencies, 0.7);
    expect(result.goalScore).toBe(4);
    expect(result.competencyScore).toBe(3);
    expect(result.overallScore).toBe(3.7);
  });

  it("suggests a rating from the overall score", () => {
    expect(scoreReview(100, [], 0.7).suggestedRating).toBe(5);
    expect(scoreReview(60, [], 0.7).suggestedRating).toBe(3);
    expect(scoreReview(0, [], 0.7).suggestedRating).toBe(1);
  });

  it("lets goals carry the whole review when nothing else was assessed", () => {
    // Otherwise an unmeasured competency score of zero halves the result.
    expect(scoreReview(100, [], 0.7).overallScore).toBe(5);
  });

  it("respects competency weights", () => {
    const weighted = [
      { competencyId: "c1", name: "A", weight: 3, rating: 5 as RatingScale },
      { competencyId: "c2", name: "B", weight: 1, rating: 1 as RatingScale },
    ];
    expect(scoreReview(0, weighted, 0).competencyScore).toBe(4);
  });

  it("refuses a nonsensical goal weight", () => {
    expect(() => scoreReview(80, competencies, 1.5)).toThrow(/between 0 and 1/);
    expect(() => scoreReview(80, competencies, -0.1)).toThrow(/between 0 and 1/);
  });

  it("clamps goal achievement above 100%", () => {
    expect(scoreReview(150, [], 1).goalScore).toBe(5);
  });
});

describe("analyseDistribution", () => {
  function population(counts: Partial<Record<RatingScale, number>>): RatingScale[] {
    return Object.entries(counts).flatMap(([rating, n]) =>
      Array<RatingScale>(n as number).fill(Number(rating) as RatingScale)
    );
  }

  it("reports a balanced distribution", () => {
    const result = analyseDistribution(
      population({ 5: 10, 4: 20, 3: 50, 2: 15, 1: 5 })
    );
    expect(result.isBalanced).toBe(true);
    expect(result.total).toBe(100);
  });

  it("reports an unbalanced one without reshaping it", () => {
    // Forced distribution is contentious enough without software silently
    // moving someone down a band to make a curve fit.
    const result = analyseDistribution(population({ 5: 50, 3: 50 }));
    expect(result.isBalanced).toBe(false);
    expect(result.summary).toMatch(/rating 5/);
  });

  it("says how many people would have to move", () => {
    const result = analyseDistribution(population({ 5: 30, 3: 70 }));
    const top = result.rows.find((r) => r.rating === 5);
    expect(top?.movesToTarget).toBe(-20);
  });

  it("handles an empty population", () => {
    const result = analyseDistribution([]);
    expect(result.isBalanced).toBe(true);
    expect(result.summary).toMatch(/Nobody has been rated/);
  });

  it("accepts a custom target", () => {
    const flat = DEFAULT_DISTRIBUTION.map((d) => ({ ...d, tolerance: 1 }));
    expect(analyseDistribution(population({ 5: 100 }), flat).isBalanced).toBe(true);
  });

  it("counts ratings nobody gave as zero rather than omitting them", () => {
    const result = analyseDistribution(population({ 3: 10 }));
    expect(result.rows.find((r) => r.rating === 5)?.count).toBe(0);
  });
});

describe("nineBox", () => {
  it("places a star in the top-right", () => {
    expect(nineBox(5, 5).cell).toBe("star");
  });

  it("places a risk in the bottom-left", () => {
    expect(nineBox(1, 1).cell).toBe("risk");
  });

  it("distinguishes a high performer from a high potential", () => {
    // Treating a high performer as automatically high-potential is how
    // organisations promote their best individual contributors into
    // management they neither want nor are suited to.
    expect(nineBox(5, 2).cell).toBe("trusted_professional");
    expect(nineBox(2, 5).cell).toBe("rough_diamond");
  });

  it("suggests an action for every cell", () => {
    for (let p = 1; p <= 5; p++) {
      for (let q = 1; q <= 5; q++) {
        const position = nineBox(p as RatingScale, q as RatingScale);
        expect(position.suggestedAction.length).toBeGreaterThan(0);
      }
    }
  });

  it("bands a rating of 3 in the middle", () => {
    expect(nineBox(3, 3).cell).toBe("core");
  });
});

describe("checkAnonymity", () => {
  function responses(counts: Record<string, number>): FeedbackResponse[] {
    return Object.entries(counts).flatMap(([relationship, n]) =>
      Array.from({ length: n }, (_, i) => ({
        respondentId: `${relationship}-${i}`,
        relationship: relationship as FeedbackResponse["relationship"],
        ratings: { c1: 4 as RatingScale },
      }))
    );
  }

  it("releases a group with enough responses", () => {
    const verdict = checkAnonymity(responses({ peer: 5 }));
    expect(verdict.canRelease).toBe(true);
    expect(verdict.suppressed).toEqual([]);
  });

  it("suppresses a group too small to stay anonymous", () => {
    // A subject who knows they have two direct reports and reads two comments
    // has effectively been given attributed feedback.
    const verdict = checkAnonymity(responses({ direct_report: 2 }));
    expect(verdict.suppressed[0].relationship).toBe("direct_report");
    expect(verdict.suppressed[0].reason).toMatch(/at least 3/);
  });

  it("does not suppress the manager, whose view is attributable anyway", () => {
    // Suppressing it would withhold one of the two most useful views for no
    // protective benefit.
    const verdict = checkAnonymity(responses({ manager: 1 }));
    expect(verdict.releasable).toContain("manager");
    expect(verdict.suppressed).toEqual([]);
  });

  it("does not suppress self-assessment", () => {
    expect(checkAnonymity(responses({ self: 1 })).releasable).toContain("self");
  });

  it("cannot release a report that is only the subject's own view", () => {
    expect(checkAnonymity(responses({ self: 1 })).canRelease).toBe(false);
  });

  it("suppresses one group while releasing another", () => {
    const verdict = checkAnonymity(responses({ peer: 5, direct_report: 1 }));
    expect(verdict.releasable).toContain("peer");
    expect(verdict.suppressed.map((s) => s.relationship)).toEqual(["direct_report"]);
  });

  it("honours a stricter threshold", () => {
    expect(checkAnonymity(responses({ peer: 4 }), 5).suppressed).toHaveLength(1);
  });
});

describe("aggregateFeedback", () => {
  const mixed: FeedbackResponse[] = [
    { respondentId: "p1", relationship: "peer", ratings: { c1: 4 } },
    { respondentId: "p2", relationship: "peer", ratings: { c1: 4 } },
    { respondentId: "p3", relationship: "peer", ratings: { c1: 4 } },
    { respondentId: "d1", relationship: "direct_report", ratings: { c1: 1 } },
    { respondentId: "s1", relationship: "self", ratings: { c1: 5 } },
  ];

  it("breaks down only the groups anonymity allows", () => {
    const [result] = aggregateFeedback(mixed, ["c1"]);
    expect(result.byRelationship.peer).toBeDefined();
    expect(result.byRelationship.direct_report).toBeUndefined();
  });

  it("still counts a suppressed group in the overall average", () => {
    // Excluding it entirely would let the subject subtract the published
    // groups from the total and reconstruct the withheld one — the very
    // attack the suppression exists to prevent, arriving by arithmetic.
    const [result] = aggregateFeedback(mixed, ["c1"]);
    // Three peers at 4 and one direct report at 1 average 3.25.
    expect(result.overallAverage).toBe(3.25);
  });

  it("computes the self-awareness gap against others, not against itself", () => {
    const [result] = aggregateFeedback(mixed, ["c1"]);
    expect(result.selfAwarenessGap).toBe(round(5 - 3.25));
  });

  it("reports no gap when there is no self-assessment", () => {
    const withoutSelf = mixed.filter((r) => r.relationship !== "self");
    expect(aggregateFeedback(withoutSelf, ["c1"])[0].selfAwarenessGap).toBeNull();
  });

  it("ignores a competency a respondent did not rate", () => {
    const partial: FeedbackResponse[] = [
      { respondentId: "p1", relationship: "peer", ratings: { c1: 4 } },
      { respondentId: "p2", relationship: "peer", ratings: {} },
      { respondentId: "p3", relationship: "peer", ratings: { c1: 2 } },
    ];
    expect(aggregateFeedback(partial, ["c1"])[0].overallAverage).toBe(3);
  });

  it("handles a competency nobody rated", () => {
    expect(aggregateFeedback(mixed, ["unrated"])[0].overallAverage).toBe(0);
  });
});

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

describe("isEligibleForReview", () => {
  it("includes someone with enough service", () => {
    expect(isEligibleForReview({ joinDate: "2025-01-01" }, "2026-03-31")).toEqual({
      eligible: true,
    });
  });

  it("excludes a very recent joiner", () => {
    // A new starter with two weeks' service has nothing to be assessed on,
    // and rating them anyway produces a number that follows them into a pay
    // decision.
    const verdict = isEligibleForReview({ joinDate: "2026-03-15" }, "2026-03-31");
    expect(verdict.eligible).toBe(false);
    if (!verdict.eligible) expect(verdict.reason).toMatch(/service at the cycle end/);
  });

  it("excludes a leaver", () => {
    const verdict = isEligibleForReview(
      { joinDate: "2020-01-01", exitDate: "2026-02-01" },
      "2026-03-31"
    );
    expect(verdict.eligible).toBe(false);
  });

  it("excludes someone on long-term leave", () => {
    // Reviewing someone against goals they could not pursue is both unfair
    // and, in many jurisdictions, discriminatory.
    const verdict = isEligibleForReview(
      { joinDate: "2020-01-01", isOnLongLeave: true },
      "2026-03-31"
    );
    expect(verdict.eligible).toBe(false);
    if (!verdict.eligible) expect(verdict.reason).toMatch(/long-term leave/);
  });

  it("honours a custom tenure requirement", () => {
    expect(
      isEligibleForReview({ joinDate: "2026-01-01" }, "2026-03-31", 6).eligible
    ).toBe(false);
    expect(
      isEligibleForReview({ joinDate: "2026-01-01" }, "2026-03-31", 2).eligible
    ).toBe(true);
  });
});

describe("monthsBetween", () => {
  it("does not count a month until the day is reached", () => {
    expect(monthsBetween("2026-01-15", "2026-02-14")).toBe(0);
    expect(monthsBetween("2026-01-15", "2026-02-15")).toBe(1);
  });

  it("rejects a malformed date", () => {
    expect(() => monthsBetween("Jan 2026", "2026-02-01")).toThrow(/YYYY-MM-DD/);
  });
});
