// ═══════════════════════════════════════════════════════════════
// BENEFITS REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Election, dependants and claims. The rules live in src/lib/benefits-rules.ts
// so they are testable without a database; this enforces them against real
// data and holds the locks that make concurrent elections safe.

import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { employees } from "@/db/schema/hrms";
import {
  benefitClaims,
  benefitEnrolments,
  benefitPlans,
  dependants,
  enrolmentDependants,
  enrolmentWindows,
} from "@/db/schema/talent";
import {
  calculateCost,
  isEligible,
  lifeEventWindowOpen,
  prorateContribution,
  validateDependants,
  windowFor,
  type DependantInput,
  type EligibilityRules,
  type EligibilitySubject,
  type LifeEvent,
  type Window,
} from "@/lib/benefits-rules";
import { NotFoundError, RepositoryError, type ListQuery, type Page } from "./types";

export interface PlanRecord {
  id: string;
  name: string;
  benefitType: string;
  provider?: string;
  description?: string;
  employerContribution: number;
  employeeContribution: number;
  coverageAmount?: number;
  currency: string;
  allowsDependants: boolean;
  eligibleRelations: string[];
  maxDependants?: number;
  isAutoEnrolled: boolean;
  /** Resolved per employee when listing available plans. */
  isEligible?: boolean;
  /** Why the plan cannot be elected right now, if it cannot. */
  unavailableReason?: string;
  documentUrl?: string;
}

export interface EnrolmentRecord {
  id: string;
  planId: string;
  planName?: string;
  employeeId: string;
  status: string;
  planYear: number;
  coverageFrom?: string;
  coverageTo?: string;
  employeeCost: number;
  employerCost: number;
  dependantIds: string[];
  electedAt: string;
}

export interface ElectRequest {
  employeeId: string;
  planId: string;
  planYear: number;
  dependantIds?: string[];
  /** Present when electing outside a window under a qualifying life event. */
  lifeEvent?: { type: LifeEvent; occurredOn: string };
}

function toMajor(minor: bigint | null): number {
  return minor === null ? 0 : Number(minor) / 100;
}

export class NeonBenefitsRepository {
  constructor(private readonly ctx: TenantContext) {}

  /**
   * Plans available to an employee, with eligibility already resolved.
   *
   * Resolving server-side matters: a plan an employee cannot elect should not
   * appear as a choice they can make and then have rejected.
   */
  async availablePlans(employeeId: string, today: string): Promise<PlanRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const subject = await this.eligibilitySubject(tx, employeeId, today);

      const plans = await tx
        .select()
        .from(benefitPlans)
        .where(eq(benefitPlans.isActive, true))
        .orderBy(asc(benefitPlans.benefitType), asc(benefitPlans.name));

      const windows = await tx.select().from(enrolmentWindows).where(eq(enrolmentWindows.isActive, true));

      const asWindows: Window[] = windows.map((w) => ({
        id: w.id,
        opensOn: w.opensOn,
        closesOn: w.closesOn,
        coverageStartsOn: w.coverageStartsOn,
        planIds: (w.planIds as string[]) ?? [],
      }));

      return plans.map((plan) => {
        const eligible = isEligible(
          subject,
          (plan.eligibilityRules as EligibilityRules) ?? undefined
        );

        const verdict = windowFor(plan.id, asWindows, today);
        let unavailableReason: string | undefined;

        if (!eligible) {
          unavailableReason = "You are not eligible for this plan";
        } else if (!plan.isAutoEnrolled && !verdict.open) {
          // Auto-enrolled plans have no election, so a closed window is
          // irrelevant to them.
          unavailableReason =
            verdict.reason === "not_yet_open"
              ? `Enrolment opens on ${verdict.nextOpensOn}`
              : verdict.reason === "closed"
                ? "Enrolment for this plan has closed for the year"
                : "No enrolment window is configured for this plan";
        }

        return {
          id: plan.id,
          name: plan.name,
          benefitType: plan.benefitType,
          provider: plan.provider ?? undefined,
          description: plan.description ?? undefined,
          employerContribution: toMajor(plan.employerContributionMinor),
          employeeContribution: toMajor(plan.employeeContributionMinor),
          coverageAmount: plan.coverageAmountMinor ? toMajor(plan.coverageAmountMinor) : undefined,
          currency: plan.currency,
          allowsDependants: plan.allowsDependants,
          eligibleRelations: (plan.eligibleRelations as string[]) ?? [],
          maxDependants: plan.maxDependants ?? undefined,
          isAutoEnrolled: plan.isAutoEnrolled,
          isEligible: eligible,
          unavailableReason,
          documentUrl: plan.documentUrl ?? undefined,
        };
      });
    });
  }

  /**
   * Elects a plan.
   *
   * Window, eligibility, dependant validity and cost are all resolved inside
   * one transaction with the enrolment row locked. Splitting them would let
   * two submissions from a double-clicked form both pass the "not already
   * enrolled" check and create two deductions.
   */
  async elect(request: ElectRequest, today: string): Promise<EnrolmentRecord> {
    return withTenant(this.ctx, async (tx) => {
      const plan = await tx
        .select()
        .from(benefitPlans)
        .where(and(eq(benefitPlans.id, request.planId), eq(benefitPlans.isActive, true)))
        .limit(1);

      if (!plan[0]) throw new NotFoundError("Benefit plan", request.planId);

      const subject = await this.eligibilitySubject(tx, request.employeeId, today);
      if (!isEligible(subject, (plan[0].eligibilityRules as EligibilityRules) ?? undefined)) {
        throw new RepositoryError("You are not eligible for this plan", 403);
      }

      // A qualifying life event opens an election outside the normal window,
      // because someone who marries in June needs cover then, not next April.
      const windows = await tx
        .select()
        .from(enrolmentWindows)
        .where(eq(enrolmentWindows.isActive, true));

      const verdict = windowFor(
        request.planId,
        windows.map((w) => ({
          id: w.id,
          opensOn: w.opensOn,
          closesOn: w.closesOn,
          coverageStartsOn: w.coverageStartsOn,
          planIds: (w.planIds as string[]) ?? [],
        })),
        today
      );

      const lifeEventOpens =
        request.lifeEvent && lifeEventWindowOpen(request.lifeEvent.occurredOn, today);

      if (!verdict.open && !lifeEventOpens) {
        throw new RepositoryError(
          verdict.open === false && verdict.reason === "not_yet_open"
            ? `Enrolment opens on ${verdict.nextOpensOn}`
            : "Enrolment is closed for this plan",
          409
        );
      }

      // Validated before the cost is computed, so a rejected dependant cannot
      // silently inflate the deduction.
      const chosen = request.dependantIds ?? [];
      if (chosen.length > 0 && !plan[0].allowsDependants) {
        throw new RepositoryError("This plan does not cover dependants", 400);
      }

      let dependantRows: (typeof dependants.$inferSelect)[] = [];
      if (chosen.length > 0) {
        dependantRows = await tx
          .select()
          .from(dependants)
          .where(
            and(
              eq(dependants.employeeId, request.employeeId),
              inArray(dependants.id, chosen)
            )
          );

        // A dependant id that belongs to someone else, or does not exist,
        // would otherwise be silently ignored and the employee would believe
        // their family was covered.
        if (dependantRows.length !== chosen.length) {
          throw new RepositoryError(
            "One or more dependants could not be found on your record",
            400
          );
        }

        const issues = validateDependants(
          dependantRows.map<DependantInput>((d) => ({
            relation: d.relation,
            dateOfBirth: d.dateOfBirth ?? undefined,
            isNominee: d.isNominee,
            nomineeSharePercent: d.nomineeSharePercent ?? undefined,
          })),
          {
            eligibleRelations: (plan[0].eligibleRelations as string[]) ?? [],
            maxDependants: plan[0].maxDependants ?? undefined,
          },
          today
        );

        if (issues.length > 0) {
          throw new RepositoryError(
            `Dependants are not valid for this plan: ${issues.map((i) => i.code).join(", ")}`,
            400
          );
        }
      }

      const cost = calculateCost(
        {
          employerContributionMinor: plan[0].employerContributionMinor,
          employeeContributionMinor: plan[0].employeeContributionMinor,
        },
        dependantRows.length
      );

      const coverageFrom = verdict.open ? verdict.window.coverageStartsOn : today;
      const planYearEnd = `${request.planYear + 1}-03-31`;
      // A mid-year joiner should not pay a full year's premium.
      const proratedEmployee = prorateContribution(
        cost.employeeAnnualMinor,
        coverageFrom,
        planYearEnd
      );

      const [row] = await tx
        .insert(benefitEnrolments)
        .values({
          orgId: this.ctx.orgId,
          employeeId: request.employeeId,
          planId: request.planId,
          windowId: verdict.open ? verdict.window.id : null,
          planYear: request.planYear,
          status: "elected",
          coverageFrom,
          coverageTo: planYearEnd,
          employeeCostMinor: proratedEmployee,
          employerCostMinor: cost.employerAnnualMinor,
        })
        .onConflictDoUpdate({
          // Re-electing is an update, not a second row; two rows would produce
          // two payroll deductions.
          target: [
            benefitEnrolments.employeeId,
            benefitEnrolments.planId,
            benefitEnrolments.planYear,
          ],
          set: {
            status: "elected",
            coverageFrom,
            coverageTo: planYearEnd,
            employeeCostMinor: proratedEmployee,
            employerCostMinor: cost.employerAnnualMinor,
            updatedAt: new Date(),
          },
        })
        .returning();

      // Replaced wholesale so removing a dependant actually removes them.
      await tx.delete(enrolmentDependants).where(eq(enrolmentDependants.enrolmentId, row.id));
      if (dependantRows.length > 0) {
        await tx.insert(enrolmentDependants).values(
          dependantRows.map((d) => ({
            orgId: this.ctx.orgId,
            enrolmentId: row.id,
            dependantId: d.id,
          }))
        );
      }

      return {
        id: row.id,
        planId: row.planId,
        employeeId: row.employeeId,
        status: row.status,
        planYear: row.planYear,
        coverageFrom: row.coverageFrom ?? undefined,
        coverageTo: row.coverageTo ?? undefined,
        employeeCost: toMajor(row.employeeCostMinor),
        employerCost: toMajor(row.employerCostMinor),
        dependantIds: dependantRows.map((d) => d.id),
        electedAt: row.electedAt.toISOString(),
      };
    });
  }

  /** Declines a plan for the year, which is a decision worth recording. */
  async waive(
    employeeId: string,
    planId: string,
    planYear: number,
    reason: string
  ): Promise<void> {
    await withTenant(this.ctx, async (tx) => {
      await tx
        .insert(benefitEnrolments)
        .values({
          orgId: this.ctx.orgId,
          employeeId,
          planId,
          planYear,
          status: "waived",
          waiverReason: reason,
          employeeCostMinor: 0n,
          employerCostMinor: 0n,
        })
        .onConflictDoUpdate({
          target: [
            benefitEnrolments.employeeId,
            benefitEnrolments.planId,
            benefitEnrolments.planYear,
          ],
          set: {
            status: "waived",
            waiverReason: reason,
            // Zeroed so payroll stops deducting for a plan that was dropped.
            employeeCostMinor: 0n,
            employerCostMinor: 0n,
            updatedAt: new Date(),
          },
        });
    });
  }

  async enrolmentsFor(employeeId: string, planYear?: number): Promise<EnrolmentRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({ enrolment: benefitEnrolments, planName: benefitPlans.name })
        .from(benefitEnrolments)
        .leftJoin(benefitPlans, eq(benefitPlans.id, benefitEnrolments.planId))
        .where(
          and(
            eq(benefitEnrolments.employeeId, employeeId),
            planYear ? eq(benefitEnrolments.planYear, planYear) : undefined
          )
        )
        .orderBy(desc(benefitEnrolments.planYear));

      const ids = rows.map((r) => r.enrolment.id);
      const links = ids.length
        ? await tx
            .select()
            .from(enrolmentDependants)
            .where(inArray(enrolmentDependants.enrolmentId, ids))
        : [];

      return rows.map((r) => ({
        id: r.enrolment.id,
        planId: r.enrolment.planId,
        planName: r.planName ?? undefined,
        employeeId: r.enrolment.employeeId,
        status: r.enrolment.status,
        planYear: r.enrolment.planYear,
        coverageFrom: r.enrolment.coverageFrom ?? undefined,
        coverageTo: r.enrolment.coverageTo ?? undefined,
        employeeCost: toMajor(r.enrolment.employeeCostMinor),
        employerCost: toMajor(r.enrolment.employerCostMinor),
        dependantIds: links
          .filter((l) => l.enrolmentId === r.enrolment.id)
          .map((l) => l.dependantId),
        electedAt: r.enrolment.electedAt.toISOString(),
      }));
    });
  }

  /**
   * Monthly deductions for a payroll run.
   *
   * Only active cover produces a deduction; a waived or terminated election
   * must not, which is the bug that quietly takes money from people who
   * dropped a plan.
   */
  async payrollDeductions(
    planYear: number
  ): Promise<{ employeeId: string; amountMinor: bigint }[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({
          employeeId: benefitEnrolments.employeeId,
          // Divided in SQL so the sum is exact rather than summing rounded
          // per-plan monthly figures.
          amountMinor: sql<string>`(sum(${benefitEnrolments.employeeCostMinor}) / 12)::text`,
        })
        .from(benefitEnrolments)
        .where(
          and(
            eq(benefitEnrolments.planYear, planYear),
            inArray(benefitEnrolments.status, ["elected", "active"])
          )
        )
        .groupBy(benefitEnrolments.employeeId);

      return rows.map((r) => ({
        employeeId: r.employeeId,
        amountMinor: BigInt(r.amountMinor ?? "0"),
      }));
    });
  }

  // ─── Dependants ────────────────────────────────────────────

  async addDependant(
    employeeId: string,
    input: DependantInput & { fullName: string; identifier?: string; gender?: string }
  ): Promise<string> {
    return withTenant(this.ctx, async (tx) => {
      if (input.isNominee && input.nomineeSharePercent !== undefined) {
        const existing = await tx
          .select({ share: dependants.nomineeSharePercent })
          .from(dependants)
          .where(
            and(eq(dependants.employeeId, employeeId), eq(dependants.isNominee, true))
          );

        const total =
          existing.reduce((sum, d) => sum + (d.share ?? 0), 0) + input.nomineeSharePercent;

        // Over-allocating leaves a death benefit disputed rather than paid.
        if (total > 100) {
          throw new RepositoryError(
            `Nominee shares would total ${total}%; they cannot exceed 100%`,
            400
          );
        }
      }

      const [row] = await tx
        .insert(dependants)
        .values({
          orgId: this.ctx.orgId,
          employeeId,
          fullName: input.fullName,
          relation: input.relation,
          dateOfBirth: input.dateOfBirth,
          gender: input.gender,
          identifier: input.identifier,
          isNominee: input.isNominee ?? false,
          nomineeSharePercent: input.nomineeSharePercent,
        })
        .returning({ id: dependants.id });

      return row.id;
    });
  }

  async listDependants(employeeId: string) {
    return withTenant(this.ctx, async (tx) => {
      return tx
        .select()
        .from(dependants)
        .where(eq(dependants.employeeId, employeeId))
        .orderBy(asc(dependants.relation), asc(dependants.fullName));
    });
  }

  // ─── Claims ────────────────────────────────────────────────

  async submitClaim(input: {
    enrolmentId: string;
    employeeId: string;
    dependantId?: string;
    claimedAmountMinor: bigint;
    incidentDate: string;
    description?: string;
    documents?: string[];
  }): Promise<string> {
    return withTenant(this.ctx, async (tx) => {
      const enrolment = await tx
        .select()
        .from(benefitEnrolments)
        .where(eq(benefitEnrolments.id, input.enrolmentId))
        .limit(1);

      if (!enrolment[0]) throw new NotFoundError("Enrolment", input.enrolmentId);
      if (enrolment[0].employeeId !== input.employeeId) {
        throw new RepositoryError("That enrolment is not yours", 403);
      }

      // A claim for a date outside the coverage period is the single most
      // common invalid claim, and paying it is a straight loss.
      const { coverageFrom, coverageTo } = enrolment[0];
      if (
        (coverageFrom && input.incidentDate < coverageFrom) ||
        (coverageTo && input.incidentDate > coverageTo)
      ) {
        throw new RepositoryError(
          `The incident date falls outside your coverage period (${coverageFrom} to ${coverageTo})`,
          400
        );
      }

      if (enrolment[0].status === "waived" || enrolment[0].status === "terminated") {
        throw new RepositoryError("You are not covered under this plan", 403);
      }

      const [{ value: existing }] = await tx
        .select({ value: count() })
        .from(benefitClaims)
        .where(eq(benefitClaims.orgId, this.ctx.orgId));

      const [row] = await tx
        .insert(benefitClaims)
        .values({
          orgId: this.ctx.orgId,
          enrolmentId: input.enrolmentId,
          employeeId: input.employeeId,
          dependantId: input.dependantId,
          claimNumber: `CLM-${String(existing + 1).padStart(6, "0")}`,
          claimedAmountMinor: input.claimedAmountMinor,
          incidentDate: input.incidentDate,
          description: input.description,
          documents: input.documents ?? [],
        })
        .returning({ id: benefitClaims.id });

      return row.id;
    });
  }

  async listClaims(q: ListQuery = {}): Promise<Page<typeof benefitClaims.$inferSelect>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));

    return withTenant(this.ctx, async (tx) => {
      const employeeId = q.filters?.employeeId as string | undefined;
      const where = employeeId ? eq(benefitClaims.employeeId, employeeId) : undefined;

      const rows = await tx
        .select()
        .from(benefitClaims)
        .where(where)
        .orderBy(desc(benefitClaims.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(benefitClaims)
        .where(where);

      return {
        items: rows,
        total,
        page,
        pageSize,
        hasMore: (page - 1) * pageSize + rows.length < total,
      };
    });
  }

  // ─── Internals ─────────────────────────────────────────────

  private async eligibilitySubject(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    employeeId: string,
    today: string
  ): Promise<EligibilitySubject> {
    const rows = await tx
      .select({
        employmentType: employees.employmentType,
        status: employees.status,
        joinDate: employees.joinDate,
        departmentId: employees.departmentId,
        locationId: employees.locationId,
        designation: employees.designation,
        ctcMinor: employees.ctcMinor,
      })
      .from(employees)
      .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundError("Employee", employeeId);

    const join = new Date(`${row.joinDate}T00:00:00Z`);
    const at = new Date(`${today}T00:00:00Z`);
    const tenureMonths = Math.max(
      0,
      (at.getUTCFullYear() - join.getUTCFullYear()) * 12 +
        (at.getUTCMonth() - join.getUTCMonth())
    );

    return {
      employmentType: row.employmentType,
      status: row.status,
      tenureMonths,
      departmentId: row.departmentId ?? undefined,
      locationId: row.locationId ?? undefined,
      designation: row.designation,
      ctcMinor: row.ctcMinor ?? undefined,
    };
  }
}
