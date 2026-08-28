// ═══════════════════════════════════════════════════════════════
// PERFORMANCE REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Goals, reviews, 360° feedback and calibration. The rules live in
// src/lib/performance.ts so they test without a database.
//
// The anonymity path is the one to read carefully. `aggregateFor` never
// selects a respondent id, and never joins the table that holds one. That is
// not caution for its own sake: people were told their comments were anonymous
// before they wrote them, and a promise broken retrospectively lands on the
// person who trusted it.

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import {
  employees,
  performanceGoals,
  performanceReviews,
  reviewCycles,
} from "@/db/schema/hrms";
import {
  calibrationAdjustments,
  calibrationSessions,
  checkIns,
  competencies,
  competencyRatings,
  feedbackRequests,
  feedbackResponses,
} from "@/db/schema/performance";
import {
  DEFAULT_DISTRIBUTION,
  aggregateFeedback,
  analyseDistribution,
  canLink,
  checkAnonymity,
  isEligibleForReview,
  nineBox,
  rollUp,
  scoreReview,
  type FeedbackResponse,
  type GoalNode,
  type RatingScale,
} from "@/lib/performance";
import { NotFoundError, RepositoryError } from "./types";

export interface GoalRecord {
  id: string;
  title: string;
  ownerId: string;
  parentGoalId?: string;
  progressPercent: number;
  rolledUpPercent: number;
  isStale: boolean;
  childCount: number;
  status: string;
  dueDate?: string;
}

function toNode(row: typeof performanceGoals.$inferSelect): GoalNode {
  return {
    id: row.id,
    parentId: row.parentGoalId ?? undefined,
    ownerId: row.employeeId,
    title: row.title,
    progressPercent: row.progressPercent,
    weight: row.weightPercent > 0 ? row.weightPercent : undefined,
    status:
      row.status === "completed" || row.status === "achieved"
        ? "achieved"
        : row.status === "cancelled"
          ? "cancelled"
          : row.status === "missed"
            ? "missed"
            : "active",
  };
}

export class NeonPerformanceRepository {
  constructor(private readonly ctx: TenantContext) {}

  /**
   * The goal tree for a cycle, with progress rolled up.
   *
   * Progress is computed on read rather than stored on the parent. A stored
   * figure drifts the moment a child moves, and the drift is only noticed when
   * the quarter closes.
   */
  async goalTree(cycleId: string): Promise<GoalRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(performanceGoals)
        .where(eq(performanceGoals.cycleId, cycleId))
        .orderBy(asc(performanceGoals.createdAt));

      const rolled = new Map(rollUp(rows.map(toNode)).map((r) => [r.goalId, r]));

      return rows.map((row) => {
        const result = rolled.get(row.id);
        return {
          id: row.id,
          title: row.title,
          ownerId: row.employeeId,
          parentGoalId: row.parentGoalId ?? undefined,
          progressPercent: row.progressPercent,
          rolledUpPercent: result?.rolledUpPercent ?? row.progressPercent,
          isStale: result?.isStale ?? false,
          childCount: result?.childCount ?? 0,
          status: row.status,
          dueDate: row.dueDate ?? undefined,
        };
      });
    });
  }

  /**
   * Re-parents a goal.
   *
   * Refuses a cycle before it is created. A goal tree with a cycle produces a
   * rollup that never terminates, and that surfaces as a hung request rather
   * than an error anyone can act on.
   */
  async linkGoal(goalId: string, parentGoalId: string | null): Promise<void> {
    await withTenant(this.ctx, async (tx) => {
      const [goal] = await tx
        .select()
        .from(performanceGoals)
        .where(eq(performanceGoals.id, goalId))
        .limit(1);

      if (!goal) throw new NotFoundError("Goal", goalId);

      if (parentGoalId) {
        const siblings = await tx
          .select()
          .from(performanceGoals)
          .where(
            goal.cycleId ? eq(performanceGoals.cycleId, goal.cycleId) : sql`true`
          );

        const verdict = canLink(siblings.map(toNode), goalId, parentGoalId);
        if (!verdict.allowed) throw new RepositoryError(verdict.reason, 409);
      }

      await tx
        .update(performanceGoals)
        .set({ parentGoalId, updatedAt: new Date() })
        .where(eq(performanceGoals.id, goalId));
    });
  }

  /**
   * Opens reviews for everyone eligible in a cycle.
   *
   * The ineligible are returned with a reason rather than silently omitted. A
   * new starter who never appears in the cycle and never hears why is left
   * assuming they were forgotten — and someone on long-term leave being
   * quietly excluded looks like exactly the discrimination the exclusion
   * exists to avoid.
   */
  async openReviews(cycleId: string): Promise<{
    opened: number;
    skipped: { employeeId: string; reason: string }[];
  }> {
    return withTenant(this.ctx, async (tx) => {
      const [cycle] = await tx
        .select()
        .from(reviewCycles)
        .where(eq(reviewCycles.id, cycleId))
        .for("update")
        .limit(1);

      if (!cycle) throw new NotFoundError("Review cycle", cycleId);

      const staff = await tx
        .select({
          id: employees.id,
          joinDate: employees.joinDate,
          exitDate: employees.exitDate,
          reportingToId: employees.reportingToId,
        })
        .from(employees)
        .where(eq(employees.status, "active"));

      const existing = await tx
        .select({ employeeId: performanceReviews.employeeId })
        .from(performanceReviews)
        .where(eq(performanceReviews.cycleId, cycleId));

      const alreadyOpen = new Set(existing.map((e) => e.employeeId));
      const cycleEnd = cycle.periodEnd;

      const skipped: { employeeId: string; reason: string }[] = [];
      const toOpen: (typeof performanceReviews.$inferInsert)[] = [];

      for (const person of staff) {
        if (alreadyOpen.has(person.id)) continue;

        const verdict = isEligibleForReview(
          { joinDate: person.joinDate, exitDate: person.exitDate ?? undefined },
          cycleEnd
        );

        if (!verdict.eligible) {
          skipped.push({ employeeId: person.id, reason: verdict.reason });
          continue;
        }

        toOpen.push({
          orgId: this.ctx.orgId,
          cycleId,
          employeeId: person.id,
          reviewerId: person.reportingToId ?? undefined,
          reviewType: "manager",
        });
      }

      if (toOpen.length > 0) {
        await tx.insert(performanceReviews).values(toOpen);
      }

      return { opened: toOpen.length, skipped };
    });
  }

  /** Scores a review from its goals and competency ratings. */
  async scoreFor(reviewId: string, goalWeight = 0.7) {
    return withTenant(this.ctx, async (tx) => {
      const [review] = await tx
        .select()
        .from(performanceReviews)
        .where(eq(performanceReviews.id, reviewId))
        .limit(1);

      if (!review) throw new NotFoundError("Review", reviewId);

      const goals = await tx
        .select()
        .from(performanceGoals)
        .where(
          and(
            eq(performanceGoals.employeeId, review.employeeId),
            eq(performanceGoals.cycleId, review.cycleId)
          )
        );

      const live = goals.filter((g) => g.status !== "cancelled");

      // Weighted by the goal's own weight where set, so a headline objective
      // is not averaged flat against a minor one.
      const totalWeight = live.reduce((sum, g) => sum + (g.weightPercent || 1), 0);
      const goalAchievement =
        totalWeight === 0
          ? 0
          : live.reduce((sum, g) => sum + g.progressPercent * (g.weightPercent || 1), 0) /
            totalWeight;

      const ratings = await tx
        .select({ r: competencyRatings, name: competencies.name })
        .from(competencyRatings)
        .leftJoin(competencies, eq(competencies.id, competencyRatings.competencyId))
        .where(eq(competencyRatings.reviewId, reviewId));

      const score = scoreReview(
        goalAchievement,
        ratings.map((row) => ({
          competencyId: row.r.competencyId,
          name: row.name ?? "",
          weight: row.r.weight,
          rating: row.r.rating as RatingScale,
        })),
        goalWeight
      );

      return {
        reviewId,
        employeeId: review.employeeId,
        goalCount: live.length,
        competencyCount: ratings.length,
        ...score,
      };
    });
  }

  // ─── 360° ──────────────────────────────────────────────────

  async requestFeedback(input: {
    cycleId: string;
    subjectId: string;
    respondentIds: string[];
    relationship: FeedbackResponse["relationship"];
    dueOn?: string;
    isNominatedBySubject?: boolean;
  }): Promise<{ created: number }> {
    if (input.respondentIds.includes(input.subjectId) && input.relationship !== "self") {
      throw new RepositoryError(
        "Someone cannot be asked for peer feedback on themselves",
        400
      );
    }

    return withTenant(this.ctx, async (tx) => {
      const rows = input.respondentIds.map((respondentId) => ({
        orgId: this.ctx.orgId,
        cycleId: input.cycleId,
        subjectId: input.subjectId,
        respondentId,
        relationship: input.relationship,
        dueOn: input.dueOn,
        isNominatedBySubject: input.isNominatedBySubject ?? false,
        sentAt: new Date(),
      }));

      if (rows.length === 0) return { created: 0 };

      // Asking twice is a duplicate request, not a second opinion.
      const inserted = await tx
        .insert(feedbackRequests)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: feedbackRequests.id });

      return { created: inserted.length };
    });
  }

  async submitFeedback(
    requestId: string,
    respondentId: string,
    input: {
      ratings: Record<string, number>;
      strengths?: string;
      improvements?: string;
      comments?: string;
    }
  ): Promise<{ submitted: true }> {
    return withTenant(this.ctx, async (tx) => {
      const [request] = await tx
        .select()
        .from(feedbackRequests)
        .where(eq(feedbackRequests.id, requestId))
        .for("update")
        .limit(1);

      if (!request) throw new NotFoundError("Feedback request", requestId);
      if (request.respondentId !== respondentId) {
        throw new RepositoryError("This feedback request is not yours", 403);
      }
      if (request.completedAt) {
        // Allowing a rewrite would let someone be persuaded to revise what
        // they said, which is the pressure anonymity exists to remove.
        throw new RepositoryError("You have already submitted this feedback", 409);
      }
      if (request.declinedAt) {
        throw new RepositoryError("You declined this request", 409);
      }

      await tx.insert(feedbackResponses).values({
        orgId: this.ctx.orgId,
        requestId,
        subjectId: request.subjectId,
        relationship: request.relationship,
        ratings: input.ratings,
        strengths: input.strengths,
        improvements: input.improvements,
        comments: input.comments,
      });

      await tx
        .update(feedbackRequests)
        .set({ completedAt: new Date() })
        .where(eq(feedbackRequests.id, requestId));

      return { submitted: true };
    });
  }

  /**
   * Aggregated 360° results.
   *
   * Never selects a respondent id, and never joins `feedbackRequests`, which
   * holds one. Suppressed groups are excluded from the breakdown but still
   * counted in the overall average — publishing the total alongside only some
   * groups would let the subject reconstruct a withheld group by subtraction.
   */
  async aggregateFor(
    subjectId: string,
    cycleId: string,
    minimumResponses = 3
  ) {
    return withTenant(this.ctx, async (tx) => {
      const responses = await tx
        .select({
          relationship: feedbackResponses.relationship,
          ratings: feedbackResponses.ratings,
          strengths: feedbackResponses.strengths,
          improvements: feedbackResponses.improvements,
          comments: feedbackResponses.comments,
        })
        .from(feedbackResponses)
        .where(eq(feedbackResponses.subjectId, subjectId));

      const competencyRows = await tx
        .select({ id: competencies.id, name: competencies.name })
        .from(competencies)
        .where(eq(competencies.isActive, true));

      // A synthetic respondent id: the rules layer needs a distinguishable
      // value per response, and this deliberately is not the real one.
      const asRules: FeedbackResponse[] = responses.map((r, index) => ({
        respondentId: `anon-${index}`,
        relationship: r.relationship,
        ratings: r.ratings as Record<string, RatingScale>,
        comments: r.comments ?? undefined,
      }));

      const verdict = checkAnonymity(asRules, minimumResponses);
      const releasable = new Set(verdict.releasable);

      const aggregated = aggregateFeedback(
        asRules,
        competencyRows.map((c) => c.id),
        minimumResponses
      );

      // Comments are pooled and shuffled across releasable groups. Presented
      // grouped and in submission order, three peer comments read alongside a
      // known reply order are close to attributed.
      const comments = responses
        .filter((r) => releasable.has(r.relationship) && r.relationship !== "self")
        .flatMap((r) =>
          [r.strengths, r.improvements, r.comments].filter(
            (text): text is string => Boolean(text?.trim())
          )
        );

      return {
        subjectId,
        cycleId,
        responseCount: responses.length,
        canRelease: verdict.canRelease,
        suppressed: verdict.suppressed,
        competencies: aggregated.map((a) => ({
          ...a,
          name: competencyRows.find((c) => c.id === a.competencyId)?.name,
        })),
        comments: shuffle(comments),
      };
    });
  }

  // ─── Calibration ───────────────────────────────────────────

  /** The distribution a calibration session is working against. */
  async distributionFor(cycleId: string, departmentId?: string) {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({ rating: performanceReviews.finalRating })
        .from(performanceReviews)
        .leftJoin(employees, eq(employees.id, performanceReviews.employeeId))
        .where(
          and(
            eq(performanceReviews.cycleId, cycleId),
            departmentId ? eq(employees.departmentId, departmentId) : undefined
          )
        );

      const ratings = rows
        .map((r) => (r.rating === null ? null : Math.round(Number(r.rating))))
        .filter((r): r is number => r !== null && r >= 1 && r <= 5)
        .map((r) => r as RatingScale);

      return analyseDistribution(ratings, DEFAULT_DISTRIBUTION);
    });
  }

  /**
   * Records a rating change made at calibration.
   *
   * The justification is required by the schema as well as here. "My manager
   * rated me a 4 and I was given a 3" is a conversation that has to be
   * answerable with who changed it and why, and it is usually had months
   * later.
   */
  async adjustRating(input: {
    sessionId: string;
    reviewId: string;
    newRating: number;
    justification: string;
    adjustedById: string;
  }): Promise<{ before: number | null; after: number }> {
    if (!input.justification.trim()) {
      throw new RepositoryError("A rating change needs a justification", 422);
    }
    if (input.newRating < 1 || input.newRating > 5) {
      throw new RepositoryError("A rating must be between 1 and 5", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const [review] = await tx
        .select()
        .from(performanceReviews)
        .where(eq(performanceReviews.id, input.reviewId))
        .for("update")
        .limit(1);

      if (!review) throw new NotFoundError("Review", input.reviewId);

      const [session] = await tx
        .select()
        .from(calibrationSessions)
        .where(eq(calibrationSessions.id, input.sessionId))
        .limit(1);

      if (!session) throw new NotFoundError("Calibration session", input.sessionId);
      if (session.status === "completed") {
        throw new RepositoryError("This calibration session is closed", 409);
      }

      const before = review.finalRating === null ? null : Number(review.finalRating);

      await tx.insert(calibrationAdjustments).values({
        orgId: this.ctx.orgId,
        sessionId: input.sessionId,
        reviewId: input.reviewId,
        employeeId: review.employeeId,
        ratingBefore: review.finalRating,
        ratingAfter: String(input.newRating),
        justification: input.justification.trim(),
        adjustedById: input.adjustedById,
      });

      await tx
        .update(performanceReviews)
        .set({ finalRating: String(input.newRating) })
        .where(eq(performanceReviews.id, input.reviewId));

      return { before, after: input.newRating };
    });
  }

  /** Nine-box placement for a cycle. */
  async talentGrid(cycleId: string) {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({
          r: performanceReviews,
          first: employees.firstName,
          last: employees.lastName,
        })
        .from(performanceReviews)
        .leftJoin(employees, eq(employees.id, performanceReviews.employeeId))
        .where(eq(performanceReviews.cycleId, cycleId));

      return rows
        .filter((row) => row.r.finalRating !== null && row.r.potentialScore !== null)
        .map((row) => {
          const performance = Math.round(Number(row.r.finalRating)) as RatingScale;
          const potential = row.r.potentialScore as RatingScale;

          return {
            employeeId: row.r.employeeId,
            employeeName: row.first && row.last ? `${row.first} ${row.last}` : undefined,
            performanceRating: performance,
            potentialRating: potential,
            ...nineBox(performance, potential),
          };
        });
    });
  }

  // ─── Check-ins ─────────────────────────────────────────────

  async recordCheckIn(input: {
    employeeId: string;
    managerId?: string;
    heldOn: string;
    employeeNotes?: string;
    managerNotes?: string;
    privateNotes?: string;
    moodRating?: number;
    agreedActions?: { description: string; dueOn?: string }[];
  }): Promise<{ id: string }> {
    if (input.moodRating !== undefined && (input.moodRating < 1 || input.moodRating > 5)) {
      throw new RepositoryError("A mood rating must be between 1 and 5", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .insert(checkIns)
        .values({
          orgId: this.ctx.orgId,
          employeeId: input.employeeId,
          managerId: input.managerId,
          heldOn: input.heldOn,
          employeeNotes: input.employeeNotes,
          managerNotes: input.managerNotes,
          privateNotes: input.privateNotes,
          moodRating: input.moodRating,
          agreedActions: input.agreedActions ?? [],
        })
        .returning({ id: checkIns.id });

      return row;
    });
  }

  /**
   * Check-in history.
   *
   * `privateNotes` is stripped unless the caller is the manager who wrote it.
   * Selecting it and filtering afterwards would put it in a response body one
   * mistake away from being rendered.
   */
  async checkInHistory(employeeId: string, viewerId: string, isManager: boolean) {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(checkIns)
        .where(eq(checkIns.employeeId, employeeId))
        .orderBy(desc(checkIns.heldOn))
        .limit(100);

      return rows.map((row) => ({
        id: row.id,
        heldOn: row.heldOn,
        managerId: row.managerId ?? undefined,
        employeeNotes: row.employeeNotes ?? undefined,
        managerNotes: row.managerNotes ?? undefined,
        privateNotes:
          isManager && row.managerId === viewerId ? (row.privateNotes ?? undefined) : undefined,
        moodRating: row.moodRating ?? undefined,
        agreedActions: row.agreedActions,
      }));
    });
  }

  /** Outstanding 360° requests, for the reminder. */
  async pendingFeedbackFor(respondentId: string) {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({
          r: feedbackRequests,
          first: employees.firstName,
          last: employees.lastName,
        })
        .from(feedbackRequests)
        .leftJoin(employees, eq(employees.id, feedbackRequests.subjectId))
        .where(
          and(
            eq(feedbackRequests.respondentId, respondentId),
            isNull(feedbackRequests.completedAt),
            isNull(feedbackRequests.declinedAt)
          )
        )
        .orderBy(asc(feedbackRequests.dueOn));

      return rows.map(({ r, first, last }) => ({
        id: r.id,
        subjectName: first && last ? `${first} ${last}` : undefined,
        relationship: r.relationship,
        dueOn: r.dueOn ?? undefined,
      }));
    });
  }
}

/**
 * Shuffles comments so their order carries no information.
 *
 * Submission order is a channel: a subject who knows their manager replied
 * first can attribute the first comment. Fisher-Yates with a cryptographic
 * source, because Math.random is predictable enough to reverse given a few
 * samples.
 */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];

  for (let i = out.length - 1; i > 0; i--) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const j = bytes[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

