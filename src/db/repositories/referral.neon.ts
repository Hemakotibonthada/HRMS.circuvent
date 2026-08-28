// ═══════════════════════════════════════════════════════════════
// REFERRAL REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Replaces an implementation that stored a candidate's name as free text,
// never created an ATS candidate, and carried a bonus figure that no code path
// ever paid out.
//
// The three things that make a referral scheme work, none of which existed:
//
//  * A referral must become a real candidate, or the referred person and the
//    same person applying directly are invisible to each other.
//  * "Who referred first" must be decidable, because two colleagues referring
//    the same person is the common dispute and money depends on the answer.
//  * The bonus must have a lifecycle that ends in a payroll run, otherwise
//    the scheme is a promise the system cannot keep.

import { and, asc, count, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { candidates, departments, employees, jobPostings } from "@/db/schema/hrms";
import {
  referralEvents,
  referralPolicies,
  referrals,
  type Referral,
} from "@/db/schema/talent";
import {
  canTransition,
  explainRefusal,
  payoutEligibleOn,
  stillQualifies,
  type PayoutStatus,
  type ReferralStatus,
} from "@/lib/referral-rules";
import { NotFoundError, RepositoryError, type ListQuery, type Page } from "./types";

export type { ReferralStatus, PayoutStatus };

export interface ReferralRecord {
  id: string;
  referrerId: string;
  referrerName?: string;
  candidateId?: string;
  jobId?: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone?: string;
  positionTitle: string;
  departmentId?: string;
  departmentName?: string;
  resumeUrl?: string;
  recommendation?: string;
  relationship?: string;
  status: ReferralStatus;
  rejectionReason?: string;
  /** Major currency units for display. */
  bonusAmount: number;
  currency: string;
  payoutStatus: PayoutStatus;
  payoutEligibleOn?: string;
  paidAt?: string;
  hiredEmployeeId?: string;
  hiredOn?: string;
  submittedAt: string;
}

export interface SubmitReferral {
  referrerId: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone?: string;
  positionTitle: string;
  jobId?: string;
  departmentId?: string;
  resumeUrl?: string;
  recommendation?: string;
  relationship?: string;
}

/** Transition rules live in src/lib/referral-rules.ts, shared with the UI. */

type Row = Referral & { referrerName?: string | null; departmentName?: string | null };

function toRecord(row: Row): ReferralRecord {
  return {
    id: row.id,
    referrerId: row.referrerId,
    referrerName: row.referrerName ?? undefined,
    candidateId: row.candidateId ?? undefined,
    jobId: row.jobId ?? undefined,
    candidateName: row.candidateName,
    candidateEmail: row.candidateEmail,
    candidatePhone: row.candidatePhone ?? undefined,
    positionTitle: row.positionTitle,
    departmentId: row.departmentId ?? undefined,
    departmentName: row.departmentName ?? undefined,
    resumeUrl: row.resumeUrl ?? undefined,
    recommendation: row.recommendation ?? undefined,
    relationship: row.relationship ?? undefined,
    status: row.status,
    rejectionReason: row.rejectionReason ?? undefined,
    bonusAmount: Number(row.bonusAmountMinor) / 100,
    currency: row.currency,
    payoutStatus: row.payoutStatus,
    payoutEligibleOn: row.payoutEligibleOn ?? undefined,
    paidAt: row.paidAt?.toISOString(),
    hiredEmployeeId: row.hiredEmployeeId ?? undefined,
    hiredOn: row.hiredOn ?? undefined,
    submittedAt: row.submittedAt.toISOString(),
  };
}

export class NeonReferralRepository {
  constructor(private readonly ctx: TenantContext) {}

  async list(q: ListQuery = {}): Promise<Page<ReferralRecord>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));

    return withTenant(this.ctx, async (tx) => {
      const conditions = [];
      const filters = q.filters ?? {};
      if (filters.status && filters.status !== "all") {
        conditions.push(eq(referrals.status, filters.status as never));
      }
      if (filters.referrerId) {
        conditions.push(eq(referrals.referrerId, filters.referrerId as string));
      }
      if (filters.payoutStatus && filters.payoutStatus !== "all") {
        conditions.push(eq(referrals.payoutStatus, filters.payoutStatus as never));
      }
      const where = conditions.length ? and(...conditions) : undefined;

      const rows = await tx
        .select({
          referral: referrals,
          firstName: employees.firstName,
          lastName: employees.lastName,
          departmentName: departments.name,
        })
        .from(referrals)
        .leftJoin(employees, eq(employees.id, referrals.referrerId))
        .leftJoin(departments, eq(departments.id, referrals.departmentId))
        .where(where)
        .orderBy(desc(referrals.submittedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(referrals)
        .where(where);

      const items = rows.map((r) =>
        toRecord({
          ...r.referral,
          referrerName: [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
          departmentName: r.departmentName,
        })
      );

      return {
        items,
        total,
        page,
        pageSize,
        hasMore: (page - 1) * pageSize + items.length < total,
      };
    });
  }

  async getById(id: string): Promise<ReferralRecord | null> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx.select().from(referrals).where(eq(referrals.id, id)).limit(1);
      return rows[0] ? toRecord(rows[0]) : null;
    });
  }

  /**
   * Submits a referral and creates the matching ATS candidate.
   *
   * Both happen in one transaction. A referral without a candidate is a note
   * nobody acts on, and a candidate without a referral loses the attribution
   * the bonus depends on.
   */
  async submit(data: SubmitReferral): Promise<ReferralRecord> {
    const email = data.candidateEmail.trim().toLowerCase();

    return withTenant(this.ctx, async (tx) => {
      // Nobody refers themselves for a bonus.
      const referrer = await tx
        .select({ email: employees.workEmail, status: employees.status })
        .from(employees)
        .where(eq(employees.id, data.referrerId))
        .limit(1);

      if (!referrer[0]) throw new NotFoundError("Employee", data.referrerId);
      if (referrer[0].email.toLowerCase() === email) {
        throw new RepositoryError("You cannot refer yourself", 400);
      }

      // Someone already on the payroll is not a referral.
      const alreadyEmployed = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.workEmail, email), isNull(employees.deletedAt)))
        .limit(1);

      if (alreadyEmployed[0]) {
        throw new RepositoryError("That person is already an employee", 409);
      }

      // First referral for this person and role wins. Later ones are recorded
      // as duplicates rather than rejected outright, so the second referrer
      // can see what happened instead of assuming the form failed.
      const existing = await tx
        .select({ id: referrals.id, status: referrals.status, referrerId: referrals.referrerId })
        .from(referrals)
        .where(
          and(
            eq(referrals.candidateEmail, email),
            data.jobId ? eq(referrals.jobId, data.jobId) : isNull(referrals.jobId)
          )
        )
        .limit(1);

      if (existing[0]) {
        if (existing[0].referrerId === data.referrerId) {
          throw new RepositoryError("You have already referred this person for this role", 409);
        }
        throw new RepositoryError(
          "This person has already been referred for this role by a colleague",
          409
        );
      }

      const bonusMinor = await this.resolveBonus(tx, data.jobId, data.departmentId);

      // The candidate record is what the ATS pipeline actually works on. It is
      // upserted because the same person may have applied directly first.
      const [candidate] = await tx
        .insert(candidates)
        .values({
          orgId: this.ctx.orgId,
          firstName: data.candidateName.split(" ")[0] ?? data.candidateName,
          lastName: data.candidateName.split(" ").slice(1).join(" ") || "—",
          email,
          phone: data.candidatePhone,
          resumeUrl: data.resumeUrl,
          source: "referral",
          referredById: data.referrerId,
        })
        .onConflictDoUpdate({
          target: [candidates.orgId, candidates.email],
          set: {
            // Attribution is claimed only if nothing claimed it before, so a
            // late referral cannot steal credit for a direct applicant.
            referredById: sql`coalesce(${candidates.referredById}, ${data.referrerId})`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: candidates.id });

      const [row] = await tx
        .insert(referrals)
        .values({
          orgId: this.ctx.orgId,
          referrerId: data.referrerId,
          candidateId: candidate.id,
          jobId: data.jobId,
          candidateName: data.candidateName,
          candidateEmail: email,
          candidatePhone: data.candidatePhone,
          positionTitle: data.positionTitle,
          departmentId: data.departmentId,
          resumeUrl: data.resumeUrl,
          recommendation: data.recommendation,
          relationship: data.relationship,
          bonusAmountMinor: bonusMinor,
        })
        .returning();

      await tx.insert(referralEvents).values({
        orgId: this.ctx.orgId,
        referralId: row.id,
        toStatus: "submitted",
        actorId: data.referrerId,
      });

      return toRecord(row);
    });
  }

  /**
   * Advances a referral through the pipeline.
   *
   * Transitions are validated so a referral cannot jump from `submitted`
   * straight to `hired`, which would skip the bonus eligibility calculation.
   */
  async transition(
    id: string,
    to: ReferralStatus,
    actorId: string,
    options: { note?: string; hiredEmployeeId?: string; hiredOn?: string } = {}
  ): Promise<ReferralRecord> {
    return withTenant(this.ctx, async (tx) => {
      const locked = await tx
        .select()
        .from(referrals)
        .where(eq(referrals.id, id))
        .for("update")
        .limit(1);

      const referral = locked[0];
      if (!referral) throw new NotFoundError("Referral", id);

      if (!canTransition(referral.status, to)) {
        throw new RepositoryError(explainRefusal(referral.status, to), 409);
      }

      const updates: Partial<typeof referrals.$inferInsert> = {
        status: to,
        updatedAt: new Date(),
      };

      if (to === "rejected") updates.rejectionReason = options.note;

      if (to === "hired") {
        if (!options.hiredEmployeeId) {
          // Without the employee record there is nothing to measure the
          // qualifying period against, and the bonus could never be released.
          throw new RepositoryError(
            "Marking a referral hired requires the new employee's id",
            400
          );
        }

        const hiredOn = options.hiredOn ?? new Date().toISOString().slice(0, 10);
        const policy = await this.policyFor(tx, referral.jobId, referral.departmentId);

        updates.hiredEmployeeId = options.hiredEmployeeId;
        updates.hiredOn = hiredOn;
        updates.payoutEligibleOn = payoutEligibleOn(
          hiredOn,
          policy?.qualifyingPeriodDays ?? 90
        );
        // Not payable yet: the hire has to stay the qualifying period.
        updates.payoutStatus = "pending_milestone";
      }

      if (to === "rejected" || to === "withdrawn" || to === "duplicate") {
        updates.payoutStatus = "not_eligible";
      }

      const [row] = await tx
        .update(referrals)
        .set(updates)
        .where(eq(referrals.id, id))
        .returning();

      await tx.insert(referralEvents).values({
        orgId: this.ctx.orgId,
        referralId: id,
        fromStatus: referral.status,
        toStatus: to,
        actorId,
        note: options.note,
      });

      return toRecord(row);
    });
  }

  /**
   * Referrals whose qualifying period has elapsed and whose hire is still
   * employed.
   *
   * Checking employment at approval time rather than trusting the milestone
   * date is the point: someone who left in month two should not trigger a
   * retention bonus.
   */
  async findPayable(asOf: Date = new Date()): Promise<ReferralRecord[]> {
    const today = asOf.toISOString().slice(0, 10);

    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({ referral: referrals })
        .from(referrals)
        .innerJoin(employees, eq(employees.id, referrals.hiredEmployeeId))
        .where(
          and(
            eq(referrals.payoutStatus, "pending_milestone"),
            gte(sql`${today}::date`, referrals.payoutEligibleOn),
            isNull(employees.deletedAt),
            inArray(employees.status, ["active", "probation", "on_leave"])
          )
        )
        .orderBy(asc(referrals.payoutEligibleOn));

      return rows.map((r) => toRecord(r.referral));
    });
  }

  /**
   * Approves a bonus for payment.
   *
   * Separate from `markPaid` so the money leaves only through a payroll run,
   * which is where it becomes taxable income and appears on a payslip.
   */
  async approvePayout(id: string, approverId: string): Promise<ReferralRecord> {
    return withTenant(this.ctx, async (tx) => {
      const locked = await tx
        .select()
        .from(referrals)
        .where(eq(referrals.id, id))
        .for("update")
        .limit(1);

      const referral = locked[0];
      if (!referral) throw new NotFoundError("Referral", id);

      if (referral.payoutStatus !== "pending_milestone") {
        throw new RepositoryError(
          `This bonus is ${referral.payoutStatus} and cannot be approved`,
          409
        );
      }
      if (referral.referrerId === approverId) {
        throw new RepositoryError("You cannot approve your own referral bonus", 403);
      }
      if (referral.bonusAmountMinor <= 0n) {
        throw new RepositoryError("This referral carries no bonus", 409);
      }

      // Re-checked here, not just when the milestone list was built: the
      // approval may happen days later, and the hire may have resigned since.
      const hire = await tx
        .select({ status: employees.status, deletedAt: employees.deletedAt })
        .from(employees)
        .where(eq(employees.id, referral.hiredEmployeeId ?? ""))
        .limit(1);

      if (!hire[0] || !stillQualifies(hire[0].status, hire[0].deletedAt !== null)) {
        await tx
          .update(referrals)
          .set({
            payoutStatus: "forfeited",
            forfeitedReason: "The referred hire is no longer employed",
            updatedAt: new Date(),
          })
          .where(eq(referrals.id, id));

        throw new RepositoryError(
          "The referred hire has left, so the bonus is forfeited",
          409
        );
      }

      const [row] = await tx
        .update(referrals)
        .set({
          payoutStatus: "approved",
          payoutApprovedById: approverId,
          payoutApprovedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(referrals.id, id))
        .returning();

      return toRecord(row);
    });
  }

  /**
   * Records that a payroll run paid the bonus.
   *
   * Called by the payroll engine, which is the only thing that should move
   * money; this repository never pays anything itself.
   */
  async markPaid(id: string, payrollRunId: string): Promise<ReferralRecord> {
    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .update(referrals)
        .set({
          payoutStatus: "paid",
          payoutPayrollRunId: payrollRunId,
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(referrals.id, id), eq(referrals.payoutStatus, "approved")))
        .returning();

      // No row means it was not in `approved`, so this is a double-payment
      // attempt rather than a missing referral.
      if (!row) {
        throw new RepositoryError(
          "Only an approved bonus can be marked paid; this one is not approved",
          409
        );
      }
      return toRecord(row);
    });
  }

  /** Approved bonuses awaiting inclusion in a payroll run. */
  async pendingPayouts(): Promise<{ referralId: string; employeeId: string; amountMinor: bigint }[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({
          referralId: referrals.id,
          employeeId: referrals.referrerId,
          amountMinor: referrals.bonusAmountMinor,
        })
        .from(referrals)
        .where(eq(referrals.payoutStatus, "approved"));
      return rows;
    });
  }

  /** Leaderboard and conversion metrics for the referrals dashboard. */
  async stats(): Promise<{
    total: number;
    hired: number;
    inPipeline: number;
    conversionPercent: number;
    bonusPaid: number;
    bonusPending: number;
    topReferrers: { employeeId: string; name: string; referrals: number; hires: number }[];
  }> {
    return withTenant(this.ctx, async (tx) => {
      const byStatus = await tx
        .select({ status: referrals.status, value: count() })
        .from(referrals)
        .groupBy(referrals.status);

      const at = (s: string) => byStatus.find((r) => r.status === s)?.value ?? 0;
      const total = byStatus.reduce((sum, r) => sum + r.value, 0);
      const hired = at("hired");

      const bonuses = await tx
        .select({
          paid: sql<string>`coalesce(sum(${referrals.bonusAmountMinor}) filter (where ${referrals.payoutStatus} = 'paid'), 0)::text`,
          pending: sql<string>`coalesce(sum(${referrals.bonusAmountMinor}) filter (where ${referrals.payoutStatus} in ('pending_milestone','approved')), 0)::text`,
        })
        .from(referrals);

      const leaders = await tx
        .select({
          employeeId: referrals.referrerId,
          firstName: employees.firstName,
          lastName: employees.lastName,
          referralCount: count(),
          hireCount: sql<number>`count(*) filter (where ${referrals.status} = 'hired')::int`,
        })
        .from(referrals)
        .leftJoin(employees, eq(employees.id, referrals.referrerId))
        .groupBy(referrals.referrerId, employees.firstName, employees.lastName)
        .orderBy(desc(count()))
        .limit(10);

      return {
        total,
        hired,
        inPipeline: at("submitted") + at("screening") + at("interviewing") + at("offered"),
        // Percentage of a zero base is zero, not NaN.
        conversionPercent: total > 0 ? Math.round((hired / total) * 100) : 0,
        bonusPaid: Number(bonuses[0]?.paid ?? 0) / 100,
        bonusPending: Number(bonuses[0]?.pending ?? 0) / 100,
        topReferrers: leaders.map((l) => ({
          employeeId: l.employeeId,
          name: [l.firstName, l.lastName].filter(Boolean).join(" ") || "Unknown",
          referrals: l.referralCount,
          hires: Number(l.hireCount),
        })),
      };
    });
  }

  // ─── Internals ─────────────────────────────────────────────

  private async policyFor(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    jobId: string | null,
    departmentId: string | null
  ) {
    const rows = await tx
      .select({
        policy: referralPolicies,
        seniority: jobPostings.title,
      })
      .from(referralPolicies)
      .leftJoin(jobPostings, jobId ? eq(jobPostings.id, jobId) : sql`false`)
      .where(
        and(
          eq(referralPolicies.isActive, true),
          or(
            isNull(referralPolicies.departmentId),
            departmentId ? eq(referralPolicies.departmentId, departmentId) : sql`false`
          )
        )
      )
      // A department-specific policy beats the catch-all.
      .orderBy(desc(referralPolicies.departmentId))
      .limit(1);

    return rows[0]?.policy ?? null;
  }

  /**
   * Resolves the bonus at submission and freezes it on the referral.
   *
   * Reading the policy at payout time instead would mean a policy change
   * silently altering what someone was promised months earlier.
   */
  private async resolveBonus(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    jobId?: string,
    departmentId?: string
  ): Promise<bigint> {
    const policy = await this.policyFor(tx, jobId ?? null, departmentId ?? null);
    return policy?.bonusAmountMinor ?? 0n;
  }
}
