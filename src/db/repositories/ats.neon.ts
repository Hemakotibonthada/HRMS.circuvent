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
import {
  applications,
  candidates,
  employees,
  interviews,
  jobPostings,
} from "@/db/schema/hrms";
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
import { minorToMajor, toMinor } from "@/lib/money/minor";

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

export interface JobPostingRecord {
  id: string;
  title: string;
  slug: string;
  departmentId?: string;
  locationId?: string;
  employmentType: string;
  experienceMinYears?: number;
  experienceMaxYears?: number;
  /** Major units for display; exact paise beside them. See lib/money/minor. */
  salaryMin?: number;
  salaryMax?: number;
  salaryMinMinor?: string;
  salaryMaxMinor?: string;
  description?: string;
  requirements: string[];
  skills: string[];
  openings: number;
  filled: number;
  status: string;
  isPublished: boolean;
  publishedAt?: string;
  closesOn?: string;
  createdAt: string;
}

export interface InterviewRecord {
  id: string;
  applicationId: string;
  candidateName?: string;
  jobTitle?: string;
  round: number;
  interviewType: string;
  scheduledAt: string;
  durationMinutes: number;
  meetingUrl?: string;
  panelistIds: string[];
  status: string;
  overallRating?: number;
  recommendation?: string;
  createdAt: string;
}

function toJobRecord(row: typeof jobPostings.$inferSelect): JobPostingRecord {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    departmentId: row.departmentId ?? undefined,
    locationId: row.locationId ?? undefined,
    employmentType: row.employmentType,
    experienceMinYears: row.experienceMinYears ?? undefined,
    experienceMaxYears: row.experienceMaxYears ?? undefined,
    salaryMin: row.salaryMinMinor === null ? undefined : minorToMajor(row.salaryMinMinor),
    salaryMax: row.salaryMaxMinor === null ? undefined : minorToMajor(row.salaryMaxMinor),
    salaryMinMinor: row.salaryMinMinor === null ? undefined : toMinor(row.salaryMinMinor),
    salaryMaxMinor: row.salaryMaxMinor === null ? undefined : toMinor(row.salaryMaxMinor),
    description: row.description ?? undefined,
    requirements: (row.requirements as string[]) ?? [],
    skills: (row.skills as string[]) ?? [],
    openings: row.openings,
    filled: row.filled,
    status: row.status,
    isPublished: row.isPublished,
    publishedAt: row.publishedAt?.toISOString(),
    closesOn: row.closesOn ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

function toInterviewRecord(
  row: typeof interviews.$inferSelect,
  extra: { candidateName?: string; jobTitle?: string } = {}
): InterviewRecord {
  return {
    id: row.id,
    applicationId: row.applicationId,
    candidateName: extra.candidateName,
    jobTitle: extra.jobTitle,
    round: row.round,
    interviewType: row.interviewType,
    scheduledAt: row.scheduledAt.toISOString(),
    durationMinutes: row.durationMinutes,
    meetingUrl: row.meetingUrl ?? undefined,
    panelistIds: (row.panelistIds as string[]) ?? [],
    status: row.status,
    overallRating: row.overallRating ?? undefined,
    recommendation: row.recommendation ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A URL-safe slug. Shared by the careers site, so it has to be readable. */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  // A title of only punctuation would otherwise produce an empty slug, and the
  // unique index would then collide on "" for every such job.
  return slug || "job";
}

/**
 * `base`, `base-2`, `base-3`… within an organization.
 *
 * A counter rather than a random suffix because the slug is the careers-site
 * URL: people share it, and `senior-engineer-2` reads as a second opening
 * where `senior-engineer-x7f2q` reads as a mistake.
 */
function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new RepositoryError("Too many jobs with this title", 409);
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
  /**
   * The application pipeline.
   *
   * There was no way to list applications at all: the repository could create
   * one, advance it, reject it and report on it, but never enumerate them, so
   * the route exposed POST and nothing else and the pipeline board had nothing
   * to read. Reports existed over data no screen could show.
   *
   * The candidate and job are joined rather than denormalised onto the
   * application, because a name copied at apply time goes stale the moment
   * someone corrects a spelling.
   */
  async listApplications(query: {
    page?: number;
    pageSize?: number;
    jobId?: string;
    stage?: string;
    status?: string;
    search?: string;
  } = {}): Promise<{
    items: {
      id: string;
      jobId: string;
      jobTitle: string;
      candidateId: string;
      candidateName: string;
      candidateEmail: string;
      stage: string;
      status: string;
      matchScore?: number;
      rating?: number;
      appliedAt: string;
      updatedAt: string;
    }[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));

    return withTenant(this.ctx, async (tx) => {
      const conditions = [];
      if (query.jobId) conditions.push(eq(applications.jobId, query.jobId));
      if (query.stage && query.stage !== "all") {
        conditions.push(eq(applications.stage, query.stage));
      }
      if (query.status && query.status !== "all") {
        conditions.push(eq(applications.status, query.status));
      }
      if (query.search?.trim()) {
        // Parameterised through Drizzle's template, so a search string cannot
        // become SQL. ILIKE over name and email is what a recruiter actually
        // types into a pipeline search.
        const term = `%${query.search.trim()}%`;
        conditions.push(
          sql`(${candidates.firstName} || ' ' || ${candidates.lastName} ILIKE ${term} OR ${candidates.email} ILIKE ${term})`
        );
      }

      const where = conditions.length ? and(...conditions) : undefined;

      const rows = await tx
        .select({
          id: applications.id,
          jobId: applications.jobId,
          jobTitle: jobPostings.title,
          candidateId: applications.candidateId,
          candidateFirstName: candidates.firstName,
          candidateLastName: candidates.lastName,
          candidateEmail: candidates.email,
          stage: applications.stage,
          status: applications.status,
          matchScore: applications.matchScore,
          rating: applications.rating,
          appliedAt: applications.appliedAt,
          updatedAt: applications.updatedAt,
        })
        .from(applications)
        .innerJoin(candidates, eq(candidates.id, applications.candidateId))
        .innerJoin(jobPostings, eq(jobPostings.id, applications.jobId))
        .where(where)
        .orderBy(desc(applications.appliedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(applications)
        .innerJoin(candidates, eq(candidates.id, applications.candidateId))
        .where(where);

      return {
        items: rows.map((r) => ({
          id: r.id,
          jobId: r.jobId,
          jobTitle: r.jobTitle,
          candidateId: r.candidateId,
          candidateName: `${r.candidateFirstName} ${r.candidateLastName}`.trim(),
          candidateEmail: r.candidateEmail,
          stage: r.stage,
          status: r.status,
          matchScore: r.matchScore ?? undefined,
          rating: r.rating ?? undefined,
          appliedAt: r.appliedAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        total,
        page,
        pageSize,
        hasMore: (page - 1) * pageSize + rows.length < total,
      };
    });
  }

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
  /**
   * Offers made, most recent first.
   *
   * There was no way to list them: an offer could be drafted, approved, sent
   * and responded to, but never enumerated — so nobody could see what the
   * company currently had outstanding, which is the one question a hiring
   * manager asks daily.
   */
  async listOffers(query: { status?: string; jobId?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));

    return withTenant(this.ctx, async (tx) => {
      const conditions = [];
      if (query.status && query.status !== "all") {
        conditions.push(eq(offers.status, query.status as never));
      }
      if (query.jobId) conditions.push(eq(applications.jobId, query.jobId));
      const where = conditions.length ? and(...conditions) : undefined;

      const rows = await tx
        .select({
          id: offers.id,
          applicationId: offers.applicationId,
          candidateId: offers.candidateId,
          candidateFirstName: candidates.firstName,
          candidateLastName: candidates.lastName,
          jobTitle: jobPostings.title,
          designation: offers.designation,
          annualCtcMinor: offers.annualCtcMinor,
          currency: offers.currency,
          status: offers.status,
          version: offers.version,
          proposedStartDate: offers.proposedStartDate,
          sentAt: offers.sentAt,
          createdAt: offers.createdAt,
        })
        .from(offers)
        .innerJoin(candidates, eq(candidates.id, offers.candidateId))
        .innerJoin(applications, eq(applications.id, offers.applicationId))
        .innerJoin(jobPostings, eq(jobPostings.id, applications.jobId))
        .where(where)
        .orderBy(desc(offers.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(offers)
        .innerJoin(applications, eq(applications.id, offers.applicationId))
        .where(where);

      return {
        items: rows.map((r) => ({
          id: r.id,
          applicationId: r.applicationId,
          candidateId: r.candidateId,
          candidateName: `${r.candidateFirstName} ${r.candidateLastName}`.trim(),
          jobTitle: r.jobTitle,
          designation: r.designation,
          // A string, not a number. These are bigint minor units and JSON has
          // no bigint; sending them as a float would round somebody's salary.
          annualCtcMinor: r.annualCtcMinor.toString(),
          currency: r.currency,
          status: r.status,
          version: r.version,
          proposedStartDate: r.proposedStartDate ?? undefined,
          sentAt: r.sentAt?.toISOString(),
          createdAt: r.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize,
        hasMore: (page - 1) * pageSize + rows.length < total,
      };
    });
  }

  // ─── Job postings ──────────────────────────────────────────
  // `job_postings` was read by the pipeline queries but nothing could create
  // one: the route that claimed to — `/api/recruitment` — returned
  // "Job posted successfully" and wrote nothing.

  async listJobs(
    query: { status?: string; page?: number; pageSize?: number } = {}
  ): Promise<{
    items: JobPostingRecord[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));

    return withTenant(this.ctx, async (tx) => {
      const where =
        query.status && query.status !== "all"
          ? eq(jobPostings.status, query.status)
          : undefined;

      const rows = await tx
        .select()
        .from(jobPostings)
        .where(where)
        .orderBy(desc(jobPostings.createdAt), asc(jobPostings.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(jobPostings)
        .where(where);

      return {
        items: rows.map(toJobRecord),
        total,
        page,
        pageSize,
        hasMore: (page - 1) * pageSize + rows.length < total,
      };
    });
  }

  async getJob(id: string): Promise<JobPostingRecord | null> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx.select().from(jobPostings).where(eq(jobPostings.id, id)).limit(1);
      return rows[0] ? toJobRecord(rows[0]) : null;
    });
  }

  /**
   * Posts a job.
   *
   * The slug is derived from the title and made unique within the org, because
   * `job_postings_org_slug_key` will otherwise reject the second "Senior
   * Engineer" of the year — and a careers-site URL is a thing people share, so
   * it cannot be a random string either.
   */
  async createJob(input: {
    title: string;
    departmentId?: string;
    locationId?: string;
    employmentType?: string;
    experienceMinYears?: number;
    experienceMaxYears?: number;
    salaryMinMinor?: string;
    salaryMaxMinor?: string;
    description?: string;
    requirements?: string[];
    skills?: string[];
    openings?: number;
    hiringManagerId?: string;
    recruiterId?: string;
    closesOn?: string;
  }): Promise<JobPostingRecord> {
    const title = input.title.trim();
    if (!title) throw new RepositoryError("A job needs a title", 400);

    if (
      input.experienceMinYears !== undefined &&
      input.experienceMaxYears !== undefined &&
      input.experienceMinYears > input.experienceMaxYears
    ) {
      throw new RepositoryError("Minimum experience is above the maximum", 400);
    }

    if (input.salaryMinMinor && input.salaryMaxMinor) {
      if (BigInt(input.salaryMinMinor) > BigInt(input.salaryMaxMinor)) {
        throw new RepositoryError("Minimum salary is above the maximum", 400);
      }
    }

    if (input.openings !== undefined && input.openings < 1) {
      throw new RepositoryError("A job needs at least one opening", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const base = slugify(title);

      // Read the taken slugs inside the transaction so two concurrent posts
      // cannot pick the same suffix.
      const taken = await tx
        .select({ slug: jobPostings.slug })
        .from(jobPostings)
        .where(sql`${jobPostings.slug} = ${base} or ${jobPostings.slug} like ${`${base}-%`}`);

      const inserted = await tx
        .insert(jobPostings)
        .values({
          orgId: this.ctx.orgId,
          title,
          slug: uniqueSlug(base, new Set(taken.map((t) => t.slug))),
          departmentId: input.departmentId ?? null,
          locationId: input.locationId ?? null,
          employmentType: (input.employmentType ?? "full_time") as never,
          experienceMinYears: input.experienceMinYears ?? null,
          experienceMaxYears: input.experienceMaxYears ?? null,
          salaryMinMinor: input.salaryMinMinor ? BigInt(input.salaryMinMinor) : null,
          salaryMaxMinor: input.salaryMaxMinor ? BigInt(input.salaryMaxMinor) : null,
          description: input.description?.trim() || null,
          requirements: input.requirements ?? [],
          skills: input.skills ?? [],
          openings: input.openings ?? 1,
          hiringManagerId: input.hiringManagerId ?? null,
          recruiterId: input.recruiterId ?? null,
          closesOn: input.closesOn ?? null,
          status: "draft",
        })
        .returning();

      return toJobRecord(inserted[0]);
    });
  }

  /**
   * Publishes or closes a job.
   *
   * Publishing stamps `published_at` the first time only — republishing after
   * a pause should not make the role look newly opened to anyone sorting by
   * it.
   */
  async setJobStatus(id: string, status: "draft" | "open" | "paused" | "closed") {
    return withTenant(this.ctx, async (tx) => {
      const existing = await tx
        .select()
        .from(jobPostings)
        .where(eq(jobPostings.id, id))
        .limit(1);

      if (!existing[0]) throw new NotFoundError("Job posting", id);

      const published = status === "open";
      const updated = await tx
        .update(jobPostings)
        .set({
          status,
          isPublished: published,
          publishedAt: published ? (existing[0].publishedAt ?? new Date()) : existing[0].publishedAt,
          updatedAt: new Date(),
        })
        .where(eq(jobPostings.id, id))
        .returning();

      return toJobRecord(updated[0]);
    });
  }

  // ─── Interviews ────────────────────────────────────────────
  // `hrms.interviews` had no repository at all: the table existed, the fake
  // route reported "Interview scheduled", and nothing was ever written to it.

  async listInterviews(
    query: { applicationId?: string; from?: string; to?: string; status?: string } = {}
  ): Promise<InterviewRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const conditions = [];
      if (query.applicationId) {
        conditions.push(eq(interviews.applicationId, query.applicationId));
      }
      if (query.status && query.status !== "all") {
        conditions.push(eq(interviews.status, query.status));
      }
      if (query.from) conditions.push(sql`${interviews.scheduledAt} >= ${query.from}`);
      if (query.to) conditions.push(sql`${interviews.scheduledAt} <= ${query.to}`);

      const rows = await tx
        .select({
          interview: interviews,
          candidateFirst: candidates.firstName,
          candidateLast: candidates.lastName,
          jobTitle: jobPostings.title,
        })
        .from(interviews)
        .leftJoin(applications, eq(applications.id, interviews.applicationId))
        .leftJoin(candidates, eq(candidates.id, applications.candidateId))
        .leftJoin(jobPostings, eq(jobPostings.id, applications.jobId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(interviews.scheduledAt))
        .limit(500);

      return rows.map((r) =>
        toInterviewRecord(r.interview, {
          candidateName:
            r.candidateFirst || r.candidateLast
              ? `${r.candidateFirst ?? ""} ${r.candidateLast ?? ""}`.trim()
              : undefined,
          jobTitle: r.jobTitle ?? undefined,
        })
      );
    });
  }

  /**
   * Books an interview against a live application.
   *
   * The application is checked rather than assumed: an interview attached to a
   * rejected or non-existent application is a calendar invitation nobody can
   * act on, and it is exactly what the fake route allowed by writing nothing
   * and validating nothing.
   */
  async scheduleInterview(input: {
    applicationId: string;
    scheduledAt: string;
    round?: number;
    interviewType?: string;
    durationMinutes?: number;
    meetingUrl?: string;
    panelistIds?: string[];
  }): Promise<InterviewRecord> {
    const when = new Date(input.scheduledAt);
    if (Number.isNaN(when.getTime())) {
      throw new RepositoryError("Interview time is not a valid date", 400);
    }
    if (input.durationMinutes !== undefined && input.durationMinutes <= 0) {
      throw new RepositoryError("An interview needs a positive duration", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const application = await tx
        .select({ id: applications.id, status: applications.status })
        .from(applications)
        .where(eq(applications.id, input.applicationId))
        .limit(1);

      if (!application[0]) throw new NotFoundError("Application", input.applicationId);
      if (application[0].status === "rejected" || application[0].status === "withdrawn") {
        throw new RepositoryError(
          `Cannot schedule an interview on a ${application[0].status} application`,
          409
        );
      }

      const inserted = await tx
        .insert(interviews)
        .values({
          orgId: this.ctx.orgId,
          applicationId: input.applicationId,
          round: input.round ?? 1,
          interviewType: input.interviewType ?? "technical",
          scheduledAt: when,
          durationMinutes: input.durationMinutes ?? 60,
          meetingUrl: input.meetingUrl ?? null,
          panelistIds: input.panelistIds ?? [],
          status: "scheduled",
        })
        .returning();

      return toInterviewRecord(inserted[0]);
    });
  }

  async recordInterviewOutcome(
    id: string,
    outcome: { status: string; overallRating?: number; recommendation?: string }
  ): Promise<InterviewRecord> {
    if (
      outcome.overallRating !== undefined &&
      (outcome.overallRating < 1 || outcome.overallRating > 5)
    ) {
      throw new RepositoryError("A rating must be between 1 and 5", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const updated = await tx
        .update(interviews)
        .set({
          status: outcome.status,
          overallRating: outcome.overallRating ?? null,
          recommendation: outcome.recommendation ?? null,
        })
        .where(eq(interviews.id, id))
        .returning();

      if (!updated[0]) throw new NotFoundError("Interview", id);
      return toInterviewRecord(updated[0]);
    });
  }
}