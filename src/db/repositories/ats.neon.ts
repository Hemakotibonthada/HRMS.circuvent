// ═══════════════════════════════════════════════════════════════
// ATS REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Pipeline movement, scorecards and offers. The rules live in src/lib/ats.ts
// so they test without a database.
//
// The scorecard read path is the one to look at. `panelFor` refuses to return
// anyone else's assessment to an interviewer who has not submitted their own,
// and the refusal happens before the rows leave the database rather than while
// building the response.

import { and, asc, count, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { applications, candidates, employees, jobPostings } from "@/db/schema/hrms";
import {
  applicationEvents,
  applicationSources,
  interviewScorecards,
  offers,
  pipelineStages,
} from "@/db/schema/ats";
import {
  canAcceptOffer,
  canAdvance,
  canSeeOtherScorecards,
  canSendOffer,
  findDuplicates,
  funnel,
  normaliseEmail,
  sourceEffectiveness,
  summarisePanel,
  timeToHire,
  type PipelineStage,
  type Scorecard,
} from "@/lib/ats";
import { NotFoundError, RepositoryError } from "./types";

function toStage(row: typeof pipelineStages.$inferSelect): PipelineStage {
  return {
    id: row.id,
    name: row.name,
    sequence: row.sequence,
    kind: row.kind,
    requiredScorecards: row.requiredScorecards,
    autoRejectBelow: row.autoRejectBelow ?? undefined,
  };
}

export class NeonAtsRepository {
  constructor(private readonly ctx: TenantContext) {}

  /** The pipeline for a job, falling back to the org default. */
  private async stagesFor(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    jobId: string
  ): Promise<PipelineStage[]> {
    const specific = await tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.jobId, jobId), eq(pipelineStages.isActive, true)))
      .orderBy(asc(pipelineStages.sequence));

    if (specific.length > 0) return specific.map(toStage);

    const fallback = await tx
      .select()
      .from(pipelineStages)
      .where(and(isNull(pipelineStages.jobId), eq(pipelineStages.isActive, true)))
      .orderBy(asc(pipelineStages.sequence));

    return fallback.map(toStage);
  }

  /**
   * Registers an application, detecting a repeat applicant.
   *
   * A duplicate is reported rather than blocked: people legitimately apply
   * again after a year, or for a different role. But an unnoticed duplicate
   * means a previous rejection — and the reason for it — is invisible to the
   * person about to interview them.
   */
  async apply(input: {
    jobId: string;
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    resumeUrl?: string;
    source?: string;
    referrerId?: string;
  }): Promise<{
    applicationId: string;
    candidateId: string;
    duplicates: { candidateId: string; confidence: string }[];
  }> {
    return withTenant(this.ctx, async (tx) => {
      const email = normaliseEmail(input.email);

      const existing = await tx
        .select({ id: candidates.id, email: candidates.email, phone: candidates.phone })
        .from(candidates)
        .limit(5000);

      const duplicates = findDuplicates(
        { email: input.email, phone: input.phone },
        existing.map((c) => ({ id: c.id, email: c.email, phone: c.phone ?? undefined }))
      );

      const certain = duplicates.find((d) => d.confidence === "certain");

      let candidateId = certain?.candidateId;

      if (!candidateId) {
        const [created] = await tx
          .insert(candidates)
          .values({
            orgId: this.ctx.orgId,
            firstName: input.firstName,
            lastName: input.lastName,
            email,
            phone: input.phone,
            resumeUrl: input.resumeUrl,
            source: input.source,
          })
          .returning({ id: candidates.id });
        candidateId = created.id;
      }

      const [alreadyApplied] = await tx
        .select({ id: applications.id })
        .from(applications)
        .where(
          and(eq(applications.jobId, input.jobId), eq(applications.candidateId, candidateId))
        )
        .limit(1);

      if (alreadyApplied) {
        throw new RepositoryError(
          "This candidate has already applied for this role",
          409
        );
      }

      const stages = await this.stagesFor(tx, input.jobId);
      const first = stages[0];

      const [application] = await tx
        .insert(applications)
        .values({
          orgId: this.ctx.orgId,
          jobId: input.jobId,
          candidateId,
          stage: first?.id ?? "applied",
        })
        .returning({ id: applications.id });

      if (input.source) {
        await tx.insert(applicationSources).values({
          orgId: this.ctx.orgId,
          applicationId: application.id,
          source: input.source,
          referrerId: input.referrerId,
        });
      }

      await tx.insert(applicationEvents).values({
        orgId: this.ctx.orgId,
        applicationId: application.id,
        eventType: "applied",
        toStageId: first?.id,
      });

      return {
        applicationId: application.id,
        candidateId,
        duplicates: duplicates.map((d) => ({
          candidateId: d.candidateId,
          confidence: d.confidence,
        })),
      };
    });
  }

  /**
   * Advances an application one stage.
   *
   * The scorecard count is read inside the same transaction as the move, so a
   * concurrent submission cannot let two people advance a candidate who only
   * qualified once.
   */
  async advance(
    applicationId: string,
    actorId: string,
    toStageId?: string
  ): Promise<{ fromStageId: string; toStageId: string }> {
    return withTenant(this.ctx, async (tx) => {
      const [application] = await tx
        .select()
        .from(applications)
        .where(eq(applications.id, applicationId))
        .for("update")
        .limit(1);

      if (!application) throw new NotFoundError("Application", applicationId);

      const stages = await this.stagesFor(tx, application.jobId);

      const submitted = await tx
        .select({ scores: interviewScorecards.scores })
        .from(interviewScorecards)
        .where(
          and(
            eq(interviewScorecards.applicationId, applicationId),
            sql`${interviewScorecards.submittedAt} is not null`
          )
        );

      const allScores = submitted.flatMap((s) => Object.values(s.scores as Record<string, number>));

      const verdict = canAdvance(
        {
          stageId: application.stage,
          status: application.status as "active" | "hired" | "rejected" | "withdrawn" | "on_hold",
          scorecardCount: submitted.length,
          averageScore:
            allScores.length === 0
              ? undefined
              : allScores.reduce((a, b) => a + b, 0) / allScores.length,
        },
        stages,
        toStageId
      );

      if (!verdict.allowed) throw new RepositoryError(verdict.reason, 409);

      const target = stages.find((s) => s.id === verdict.toStageId);

      await tx
        .update(applications)
        .set({
          stage: verdict.toStageId,
          status: target?.kind === "hired" ? "hired" : application.status,
          updatedAt: new Date(),
        })
        .where(eq(applications.id, applicationId));

      await tx.insert(applicationEvents).values({
        orgId: this.ctx.orgId,
        applicationId,
        eventType: "advanced",
        fromStageId: application.stage,
        toStageId: verdict.toStageId,
        actorId,
      });

      return { fromStageId: application.stage, toStageId: verdict.toStageId };
    });
  }

  /**
   * Rejects an application.
   *
   * A reason is required. "Rejected" with no basis is exactly what a
   * discrimination claim looks for, and the absence of one is read as its own
   * kind of answer.
   */
  async reject(
    applicationId: string,
    actorId: string,
    reason: string
  ): Promise<{ status: string }> {
    if (!reason.trim()) {
      throw new RepositoryError("A rejection needs a reason", 422);
    }

    return withTenant(this.ctx, async (tx) => {
      const [application] = await tx
        .select()
        .from(applications)
        .where(eq(applications.id, applicationId))
        .for("update")
        .limit(1);

      if (!application) throw new NotFoundError("Application", applicationId);
      if (application.status !== "active") {
        throw new RepositoryError(`This application is already ${application.status}`, 409);
      }

      await tx
        .update(applications)
        .set({ status: "rejected", rejectionReason: reason.trim(), updatedAt: new Date() })
        .where(eq(applications.id, applicationId));

      await tx.insert(applicationEvents).values({
        orgId: this.ctx.orgId,
        applicationId,
        eventType: "rejected",
        fromStageId: application.stage,
        actorId,
        reason: reason.trim(),
      });

      return { status: "rejected" };
    });
  }

  /**
   * The panel's scorecards, if the caller is entitled to them.
   *
   * An interviewer who has not submitted gets their own card back and nothing
   * else. The filter is in the query, not in the response builder: a panel
   * fetched and then trimmed is one refactor from leaking, and what leaks is
   * the thing that makes the other assessments worthless.
   */
  async panelFor(
    applicationId: string,
    viewerId: string,
    isHiringManager: boolean
  ) {
    return withTenant(this.ctx, async (tx) => {
      const own = await tx
        .select()
        .from(interviewScorecards)
        .where(
          and(
            eq(interviewScorecards.applicationId, applicationId),
            eq(interviewScorecards.interviewerId, viewerId)
          )
        )
        .limit(1);

      const asRules: Scorecard[] = own.map((s) => ({
        interviewerId: s.interviewerId,
        submittedAt: s.submittedAt?.toISOString(),
        scores: s.scores as Record<string, number>,
        recommendation: s.recommendation ?? "no_hire",
      }));

      const visibility = canSeeOtherScorecards(viewerId, asRules, isHiringManager);

      if (!visibility.canSee) {
        return {
          canSeeOthers: false,
          reason: visibility.reason,
          own: own[0]
            ? {
                scores: own[0].scores,
                recommendation: own[0].recommendation ?? undefined,
                submittedAt: own[0].submittedAt?.toISOString(),
              }
            : undefined,
          panel: [],
          verdict: undefined,
        };
      }

      const all = await tx
        .select({
          s: interviewScorecards,
          first: employees.firstName,
          last: employees.lastName,
        })
        .from(interviewScorecards)
        .leftJoin(employees, eq(employees.id, interviewScorecards.interviewerId))
        .where(eq(interviewScorecards.applicationId, applicationId));

      const cards: Scorecard[] = all.map(({ s }) => ({
        interviewerId: s.interviewerId,
        submittedAt: s.submittedAt?.toISOString(),
        scores: s.scores as Record<string, number>,
        recommendation: s.recommendation ?? "no_hire",
      }));

      return {
        canSeeOthers: true,
        own: own[0]
          ? {
              scores: own[0].scores,
              recommendation: own[0].recommendation ?? undefined,
              submittedAt: own[0].submittedAt?.toISOString(),
            }
          : undefined,
        panel: all
          .filter(({ s }) => s.submittedAt)
          .map(({ s, first, last }) => ({
            interviewerId: s.interviewerId,
            interviewerName: first && last ? `${first} ${last}` : undefined,
            scores: s.scores,
            recommendation: s.recommendation ?? undefined,
            strengths: s.strengths ?? undefined,
            concerns: s.concerns ?? undefined,
            submittedAt: s.submittedAt?.toISOString(),
          })),
        verdict: summarisePanel(cards),
      };
    });
  }

  /** Submits a scorecard. Written once. */
  async submitScorecard(input: {
    applicationId: string;
    interviewerId: string;
    interviewId?: string;
    scores: Record<string, number>;
    recommendation: "strong_hire" | "hire" | "no_hire" | "strong_no_hire";
    strengths?: string;
    concerns?: string;
    notes?: string;
  }): Promise<{ submitted: true }> {
    return withTenant(this.ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(interviewScorecards)
        .where(
          and(
            eq(interviewScorecards.applicationId, input.applicationId),
            eq(interviewScorecards.interviewerId, input.interviewerId)
          )
        )
        .for("update")
        .limit(1);

      if (existing?.submittedAt) {
        // A revision after reading the panel is exactly the convergence the
        // visibility rule exists to prevent.
        throw new RepositoryError("You have already submitted this assessment", 409);
      }

      if (existing) {
        await tx
          .update(interviewScorecards)
          .set({
            scores: input.scores,
            recommendation: input.recommendation,
            strengths: input.strengths,
            concerns: input.concerns,
            notes: input.notes,
            submittedAt: new Date(),
          })
          .where(eq(interviewScorecards.id, existing.id));
      } else {
        await tx.insert(interviewScorecards).values({
          orgId: this.ctx.orgId,
          applicationId: input.applicationId,
          interviewId: input.interviewId,
          interviewerId: input.interviewerId,
          scores: input.scores,
          recommendation: input.recommendation,
          strengths: input.strengths,
          concerns: input.concerns,
          notes: input.notes,
          submittedAt: new Date(),
        });
      }

      await tx.insert(applicationEvents).values({
        orgId: this.ctx.orgId,
        applicationId: input.applicationId,
        eventType: "scorecard_submitted",
        actorId: input.interviewerId,
      });

      return { submitted: true };
    });
  }

  // ─── Offers ────────────────────────────────────────────────

  async createOffer(input: {
    applicationId: string;
    designation: string;
    annualCtcMinor: bigint;
    gradeCode?: string;
    joiningBonusMinor?: bigint;
    equityUnits?: number;
    proposedStartDate?: string;
    expiresInDays?: number;
    createdById: string;
  }): Promise<{ id: string; version: number }> {
    return withTenant(this.ctx, async (tx) => {
      const [application] = await tx
        .select()
        .from(applications)
        .where(eq(applications.id, input.applicationId))
        .limit(1);

      if (!application) throw new NotFoundError("Application", input.applicationId);

      const [{ existing }] = await tx
        .select({ existing: count() })
        .from(offers)
        .where(eq(offers.applicationId, input.applicationId));

      const [created] = await tx
        .insert(offers)
        .values({
          orgId: this.ctx.orgId,
          applicationId: input.applicationId,
          candidateId: application.candidateId,
          // A revision is a new row, so a renegotiation keeps both figures and
          // the record shows what was first proposed.
          version: existing + 1,
          designation: input.designation,
          gradeCode: input.gradeCode,
          annualCtcMinor: input.annualCtcMinor,
          joiningBonusMinor: input.joiningBonusMinor,
          equityUnits: input.equityUnits,
          proposedStartDate: input.proposedStartDate,
          expiresAt: input.expiresInDays
            ? new Date(Date.now() + input.expiresInDays * 86_400_000)
            : undefined,
          createdById: input.createdById,
        })
        .returning({ id: offers.id, version: offers.version });

      return created;
    });
  }

  /**
   * Approves an offer.
   *
   * The approver must differ from the author. An offer commits the company to
   * a salary; one person drafting and approving it has no check on it at all.
   */
  async approveOffer(offerId: string, approvedById: string): Promise<{ status: string }> {
    return withTenant(this.ctx, async (tx) => {
      const [offer] = await tx
        .select()
        .from(offers)
        .where(eq(offers.id, offerId))
        .for("update")
        .limit(1);

      if (!offer) throw new NotFoundError("Offer", offerId);
      if (offer.createdById === approvedById) {
        throw new RepositoryError(
          "An offer must be approved by someone other than the person who drafted it",
          403
        );
      }
      if (offer.status !== "draft" && offer.status !== "pending_approval") {
        throw new RepositoryError(`This offer is ${offer.status}`, 409);
      }

      await tx
        .update(offers)
        .set({
          status: "approved",
          approvedById,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(offers.id, offerId));

      return { status: "approved" };
    });
  }

  async sendOffer(offerId: string): Promise<{ status: string }> {
    return withTenant(this.ctx, async (tx) => {
      const [offer] = await tx
        .select()
        .from(offers)
        .where(eq(offers.id, offerId))
        .for("update")
        .limit(1);

      if (!offer) throw new NotFoundError("Offer", offerId);

      const verdict = canSendOffer({
        status: offer.status,
        expiresAt: offer.expiresAt?.toISOString(),
        approvedById: offer.approvedById ?? undefined,
        createdById: offer.createdById ?? undefined,
      });

      if (!verdict.allowed) throw new RepositoryError(verdict.reason, 409);

      // Any earlier offer on the same application is superseded, so a
      // candidate is never holding two live offers with different numbers.
      await tx
        .update(offers)
        .set({ status: "withdrawn", updatedAt: new Date() })
        .where(
          and(
            eq(offers.applicationId, offer.applicationId),
            ne(offers.id, offerId),
            sql`${offers.status} in ('sent', 'approved')`
          )
        );

      await tx
        .update(offers)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(offers.id, offerId));

      return { status: "sent" };
    });
  }

  async respondToOffer(
    offerId: string,
    accepted: boolean,
    declineReason?: string
  ): Promise<{ status: string }> {
    return withTenant(this.ctx, async (tx) => {
      const [offer] = await tx
        .select()
        .from(offers)
        .where(eq(offers.id, offerId))
        .for("update")
        .limit(1);

      if (!offer) throw new NotFoundError("Offer", offerId);

      const verdict = canAcceptOffer({
        status: offer.status,
        expiresAt: offer.expiresAt?.toISOString(),
      });

      // Expiry is enforced even on a decline, so the record shows the offer
      // lapsed rather than that it was refused.
      if (!verdict.allowed) throw new RepositoryError(verdict.reason, 409);

      await tx
        .update(offers)
        .set({
          status: accepted ? "accepted" : "declined",
          respondedAt: new Date(),
          declineReason: accepted ? null : declineReason,
          updatedAt: new Date(),
        })
        .where(eq(offers.id, offerId));

      if (accepted) {
        await tx
          .update(applications)
          .set({ status: "hired", updatedAt: new Date() })
          .where(eq(applications.id, offer.applicationId));
      }

      await tx.insert(applicationEvents).values({
        orgId: this.ctx.orgId,
        applicationId: offer.applicationId,
        eventType: accepted ? "offer_accepted" : "offer_declined",
        reason: accepted ? undefined : declineReason,
      });

      return { status: accepted ? "accepted" : "declined" };
    });
  }

  // ─── Reporting ─────────────────────────────────────────────

  /** Conversion through the pipeline for one job, or all of them. */
  async funnelFor(jobId?: string) {
    return withTenant(this.ctx, async (tx) => {
      const stages = jobId
        ? await this.stagesFor(tx, jobId)
        : (
            await tx
              .select()
              .from(pipelineStages)
              .where(and(isNull(pipelineStages.jobId), eq(pipelineStages.isActive, true)))
              .orderBy(asc(pipelineStages.sequence))
          ).map(toStage);

      // Counted from the event log rather than from current stage, so someone
      // who reached interview and was then rejected still counts as having
      // reached it. Counting current stage alone makes every funnel look like
      // a cliff at the last stage anyone happens to be sitting in.
      const reached = await tx
        .select({
          stageId: applicationEvents.toStageId,
          n: sql<number>`count(distinct ${applicationEvents.applicationId})::int`,
        })
        .from(applicationEvents)
        .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
        .where(jobId ? eq(applications.jobId, jobId) : undefined)
        .groupBy(applicationEvents.toStageId);

      const byStage = new Map(reached.map((r) => [r.stageId, r.n]));

      return funnel(
        stages.map((s) => ({
          stageId: s.id,
          name: s.name,
          sequence: s.sequence,
          entered: byStage.get(s.id) ?? 0,
        }))
      );
    });
  }

  /** Time from application to acceptance, for hires. */
  async timeToHireFor(jobId?: string) {
    return withTenant(this.ctx, async (tx) => {
      const hires = await tx
        .select({ appliedAt: applications.appliedAt, respondedAt: offers.respondedAt })
        .from(offers)
        .innerJoin(applications, eq(applications.id, offers.applicationId))
        .where(
          and(
            eq(offers.status, "accepted"),
            jobId ? eq(applications.jobId, jobId) : undefined
          )
        );

      const durations = hires
        .filter((h) => h.respondedAt)
        .map(
          (h) =>
            (h.respondedAt!.getTime() - h.appliedAt.getTime()) / 86_400_000
        );

      return timeToHire(durations);
    });
  }

  /** Which channels actually produce hires. */
  async sourceReport() {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({
          source: applicationSources.source,
          applications: sql<number>`count(*)::int`,
          hires: sql<number>`count(*) filter (where ${applications.status} = 'hired')::int`,
        })
        .from(applicationSources)
        .innerJoin(applications, eq(applications.id, applicationSources.applicationId))
        .where(eq(applicationSources.isPrimary, true))
        .groupBy(applicationSources.source);

      return sourceEffectiveness(rows).map((r) => ({
        ...r,
        costPerHireMinor: r.costPerHireMinor?.toString(),
      }));
    });
  }

  /** Applications sitting in a stage past its stale threshold. */
  async stalled() {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({
          a: applications,
          stageName: pipelineStages.name,
          staleAfterDays: pipelineStages.staleAfterDays,
          jobTitle: jobPostings.title,
          candidateFirst: candidates.firstName,
          candidateLast: candidates.lastName,
        })
        .from(applications)
        .leftJoin(pipelineStages, eq(pipelineStages.id, applications.stage))
        .leftJoin(jobPostings, eq(jobPostings.id, applications.jobId))
        .leftJoin(candidates, eq(candidates.id, applications.candidateId))
        .where(eq(applications.status, "active"))
        .orderBy(asc(applications.updatedAt))
        .limit(1000);

      const now = Date.now();

      return rows
        .filter((r) => r.staleAfterDays && r.staleAfterDays > 0)
        .map((r) => ({
          applicationId: r.a.id,
          candidateName:
            r.candidateFirst && r.candidateLast
              ? `${r.candidateFirst} ${r.candidateLast}`
              : undefined,
          jobTitle: r.jobTitle ?? undefined,
          stageName: r.stageName ?? r.a.stage,
          daysInStage: Math.floor((now - r.a.updatedAt.getTime()) / 86_400_000),
          staleAfterDays: r.staleAfterDays!,
        }))
        .filter((r) => r.daysInStage > r.staleAfterDays);
    });
  }

  /** An application's full history, for the record a challenge asks for. */
  async history(applicationId: string) {
    return withTenant(this.ctx, async (tx) => {
      const events = await tx
        .select({
          e: applicationEvents,
          first: employees.firstName,
          last: employees.lastName,
        })
        .from(applicationEvents)
        .leftJoin(employees, eq(employees.id, applicationEvents.actorId))
        .where(eq(applicationEvents.applicationId, applicationId))
        .orderBy(desc(applicationEvents.occurredAt));

      return events.map(({ e, first, last }) => ({
        eventType: e.eventType,
        fromStageId: e.fromStageId ?? undefined,
        toStageId: e.toStageId ?? undefined,
        actorName: first && last ? `${first} ${last}` : undefined,
        reason: e.reason ?? undefined,
        occurredAt: e.occurredAt.toISOString(),
      }));
    });
  }
}
