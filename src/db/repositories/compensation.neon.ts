// ═══════════════════════════════════════════════════════════════
// COMPENSATION REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Merit cycles, budgets and salary history. The rules live in
// src/lib/compensation.ts so they test without a database.
//
// A merit cycle is the most politically sensitive process this system runs.
// Two things follow from that, and both are enforced here rather than left to
// the UI: every departure from the guideline needs a stated reason, and the
// budget is checked inside the transaction that commits against it.

import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { departments, employees } from "@/db/schema/hrms";
import {
  budgetPools,
  compensationCycles,
  compensationRecommendations,
  equityGrants,
  salaryBands,
  salaryHistory,
} from "@/db/schema/compensation";
import {
  DEFAULT_MERIT_MATRIX,
  checkBudget,
  monthsBetween,
  payGap,
  percentOf,
  position,
  recommend,
  vestingPosition,
  type MeritMatrix,
  type PerformanceRating,
  type SalaryBand,
} from "@/lib/compensation";
import { NotFoundError, RepositoryError } from "./types";

export interface RecommendationRecord {
  id: string;
  employeeId: string;
  employeeName?: string;
  currentSalaryMinor: string;
  compaRatio?: number;
  quartile?: number;
  rating?: string;
  systemPercent?: number;
  proposedPercent?: number;
  finalPercent?: number;
  proposedIncreaseMinor?: string;
  newSalaryMinor?: string;
  warnings: string[];
  rationale?: string;
  status: string;
  overrideReason?: string;
}

/** bigint is not JSON-serialisable, so amounts cross the wire as strings. */
function money(value: bigint | null | undefined): string | undefined {
  return value === null || value === undefined ? undefined : value.toString();
}

function toBand(row: typeof salaryBands.$inferSelect): SalaryBand {
  return {
    id: row.id,
    gradeCode: row.gradeCode,
    minMinor: row.minMinor,
    midMinor: row.midMinor,
    maxMinor: row.maxMinor,
    currency: row.currency,
  };
}

export class NeonCompensationRepository {
  constructor(private readonly ctx: TenantContext) {}

  // ─── Bands ─────────────────────────────────────────────────

  async listBands(): Promise<
    (SalaryBand & { name: string; locationId?: string; isActive: boolean })[]
  > {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(salaryBands)
        .orderBy(asc(salaryBands.gradeCode));

      return rows.map((r) => ({
        ...toBand(r),
        name: r.name,
        locationId: r.locationId ?? undefined,
        isActive: r.isActive,
      }));
    });
  }

  async saveBand(input: {
    gradeCode: string;
    name: string;
    minMinor: bigint;
    midMinor: bigint;
    maxMinor: bigint;
    currency?: string;
    locationId?: string;
    jobFamily?: string;
    benchmarkSource?: string;
    effectiveFrom: string;
  }): Promise<SalaryBand> {
    // Checked here as well as by a database constraint, so the caller gets a
    // sentence rather than a constraint name.
    if (input.minMinor > input.midMinor || input.midMinor > input.maxMinor) {
      throw new RepositoryError(
        "A band must run minimum ≤ midpoint ≤ maximum",
        400
      );
    }
    if (input.midMinor <= 0n) {
      throw new RepositoryError("A band midpoint must be positive", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .insert(salaryBands)
        .values({
          orgId: this.ctx.orgId,
          gradeCode: input.gradeCode,
          name: input.name,
          minMinor: input.minMinor,
          midMinor: input.midMinor,
          maxMinor: input.maxMinor,
          currency: input.currency ?? "INR",
          locationId: input.locationId,
          jobFamily: input.jobFamily,
          benchmarkSource: input.benchmarkSource,
          effectiveFrom: input.effectiveFrom,
        })
        .onConflictDoUpdate({
          target: [salaryBands.orgId, salaryBands.gradeCode, salaryBands.locationId],
          set: {
            name: input.name,
            minMinor: input.minMinor,
            midMinor: input.midMinor,
            maxMinor: input.maxMinor,
            benchmarkSource: input.benchmarkSource,
            updatedAt: new Date(),
          },
        })
        .returning();

      return toBand(row);
    });
  }

  // ─── Cycles ────────────────────────────────────────────────

  async createCycle(input: {
    name: string;
    periodStart: string;
    periodEnd: string;
    effectiveOn: string;
    minimumTenureMonths?: number;
    prorateNewJoiners?: boolean;
    meritMatrix?: MeritMatrix;
    createdById?: string;
  }): Promise<{ id: string; status: string }> {
    if (input.periodEnd < input.periodStart) {
      throw new RepositoryError("A cycle cannot end before it starts", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .insert(compensationCycles)
        .values({
          orgId: this.ctx.orgId,
          name: input.name,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          effectiveOn: input.effectiveOn,
          minimumTenureMonths: input.minimumTenureMonths ?? 0,
          prorateNewJoiners: input.prorateNewJoiners ?? true,
          // Snapshotted at creation: guidelines get retuned between cycles,
          // and a completed cycle must stay explicable against the rules it
          // ran under.
          meritMatrix: input.meritMatrix ?? DEFAULT_MERIT_MATRIX,
          createdById: input.createdById,
        })
        .returning({ id: compensationCycles.id, status: compensationCycles.status });

      return row;
    });
  }

  /**
   * Generates draft recommendations for everyone eligible.
   *
   * Eligibility, band, rating and proration are all resolved server-side. A
   * manager opening the cycle should find a defensible starting figure rather
   * than an empty box, because an empty box is filled in from memory and
   * memory is where bias lives.
   */
  async generateRecommendations(
    cycleId: string,
    ratings: Record<string, PerformanceRating>
  ): Promise<{ created: number; skipped: { employeeId: string; reason: string }[] }> {
    return withTenant(this.ctx, async (tx) => {
      const [cycle] = await tx
        .select()
        .from(compensationCycles)
        .where(eq(compensationCycles.id, cycleId))
        .for("update")
        .limit(1);

      if (!cycle) throw new NotFoundError("Cycle", cycleId);
      if (cycle.status !== "planning" && cycle.status !== "manager_input") {
        throw new RepositoryError(
          `Recommendations cannot be regenerated once a cycle reaches ${cycle.status}`,
          409
        );
      }

      const bands = (await tx.select().from(salaryBands).where(eq(salaryBands.isActive, true))).map(
        (r) => ({ row: r, band: toBand(r) })
      );

      const staff = await tx
        .select({
          id: employees.id,
          grade: employees.designation,
          locationId: employees.locationId,
          departmentId: employees.departmentId,
          joinDate: employees.joinDate,
          ctcMinor: employees.ctcMinor,
        })
        .from(employees)
        .where(eq(employees.status, "active"));

      const pools = await tx
        .select()
        .from(budgetPools)
        .where(eq(budgetPools.cycleId, cycleId));

      const matrix = (cycle.meritMatrix as MeritMatrix) ?? DEFAULT_MERIT_MATRIX;
      const skipped: { employeeId: string; reason: string }[] = [];
      const rows: (typeof compensationRecommendations.$inferInsert)[] = [];

      for (const person of staff) {
        if (!person.ctcMinor || person.ctcMinor <= 0n) {
          skipped.push({ employeeId: person.id, reason: "No salary on record" });
          continue;
        }

        const tenureMonths = monthsBetween(person.joinDate, cycle.effectiveOn);
        if (tenureMonths < cycle.minimumTenureMonths) {
          skipped.push({
            employeeId: person.id,
            reason: `${tenureMonths} months' service, cycle requires ${cycle.minimumTenureMonths}`,
          });
          continue;
        }

        // Location-specific band first: the same grade is not the same money
        // in every market, and falling back to a global band would understate
        // or overstate half the population.
        const match =
          bands.find(
            (b) => b.row.gradeCode === person.grade && b.row.locationId === person.locationId
          ) ?? bands.find((b) => b.row.gradeCode === person.grade && !b.row.locationId);

        if (!match) {
          skipped.push({ employeeId: person.id, reason: `No salary band for "${person.grade}"` });
          continue;
        }

        const rating = ratings[person.id];
        if (!rating) {
          skipped.push({ employeeId: person.id, reason: "No performance rating" });
          continue;
        }

        // Proration is measured against the period being rewarded, not the
        // whole year: someone who joined halfway through earned half of it.
        const periodMonths = Math.max(1, monthsBetween(cycle.periodStart, cycle.periodEnd));
        const monthsInPeriod =
          person.joinDate <= cycle.periodStart
            ? periodMonths
            : Math.max(0, monthsBetween(person.joinDate, cycle.periodEnd));

        const eligibleFraction = cycle.prorateNewJoiners
          ? Math.min(1, monthsInPeriod / periodMonths)
          : 1;

        const result = recommend(
          {
            employeeId: person.id,
            salaryMinor: person.ctcMinor,
            rating,
            band: match.band,
            eligibleFraction,
          },
          matrix
        );

        const pool =
          pools.find((p) => p.departmentId === person.departmentId && p.purpose === "merit") ??
          pools.find((p) => !p.departmentId && p.purpose === "merit");

        rows.push({
          orgId: this.ctx.orgId,
          cycleId,
          employeeId: person.id,
          poolId: pool?.id,
          currentSalaryMinor: person.ctcMinor,
          bandId: match.band.id,
          compaRatio: String(result.compaRatio),
          quartile: result.quartile,
          rating,
          systemPercent: String(result.recommendedPercent),
          systemIncreaseMinor: result.increaseMinor,
          proposedPercent: String(result.recommendedPercent),
          proposedIncreaseMinor: result.increaseMinor,
          warnings: result.warnings,
          rationale: result.rationale,
        });
      }

      // Replaced wholesale rather than merged: a partially regenerated cycle
      // would mix figures from two different matrix versions.
      await tx
        .delete(compensationRecommendations)
        .where(
          and(
            eq(compensationRecommendations.cycleId, cycleId),
            eq(compensationRecommendations.status, "draft")
          )
        );

      if (rows.length > 0) {
        await tx.insert(compensationRecommendations).values(rows);
      }

      await tx
        .update(compensationCycles)
        .set({ status: "manager_input", updatedAt: new Date() })
        .where(eq(compensationCycles.id, cycleId));

      return { created: rows.length, skipped };
    });
  }

  /**
   * A manager's proposal for one person.
   *
   * An override needs a reason. Not a UI nicety: at calibration somebody has
   * to defend why two similar people got different numbers, and an unexplained
   * override is exactly what an equal-pay claim is built from.
   */
  async propose(
    recommendationId: string,
    input: { percent: number; overrideReason?: string; promotionToGradeCode?: string },
    submittedById: string
  ): Promise<RecommendationRecord> {
    if (!Number.isFinite(input.percent) || input.percent < 0 || input.percent > 100) {
      throw new RepositoryError("A proposed increase must be between 0% and 100%", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(compensationRecommendations)
        .where(eq(compensationRecommendations.id, recommendationId))
        .for("update")
        .limit(1);

      if (!existing) throw new NotFoundError("Recommendation", recommendationId);
      if (existing.status === "approved" || existing.status === "applied") {
        throw new RepositoryError(`This recommendation is already ${existing.status}`, 409);
      }

      const systemPercent = Number(existing.systemPercent ?? 0);
      const differs = Math.abs(input.percent - systemPercent) > 0.001;

      if (differs && !input.overrideReason?.trim()) {
        throw new RepositoryError(
          `The guideline is ${systemPercent}%. Explain why you are proposing ${input.percent}%.`,
          422
        );
      }

      const increaseMinor = percentOf(existing.currentSalaryMinor, input.percent);

      const [updated] = await tx
        .update(compensationRecommendations)
        .set({
          proposedPercent: String(input.percent),
          proposedIncreaseMinor: increaseMinor,
          newSalaryMinor: existing.currentSalaryMinor + increaseMinor,
          overrideReason: differs ? input.overrideReason?.trim() : null,
          promotionToGradeCode: input.promotionToGradeCode,
          status: "submitted",
          submittedById,
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(compensationRecommendations.id, recommendationId))
        .returning();

      return this.toRecord(updated);
    });
  }

  /**
   * Approves a set of recommendations against their budget.
   *
   * The budget check and the commit happen in one transaction with the pool
   * row locked. Checking outside it lets two managers both read the same
   * remaining figure and both fit — and the overspend is only discovered when
   * finance reconciles, by which point the increases have been communicated.
   */
  async approve(
    cycleId: string,
    recommendationIds: string[],
    approvedById: string
  ): Promise<{ approved: number; committedMinor: string }> {
    if (recommendationIds.length === 0) {
      throw new RepositoryError("Nothing to approve", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(compensationRecommendations)
        .where(
          and(
            eq(compensationRecommendations.cycleId, cycleId),
            inArray(compensationRecommendations.id, recommendationIds)
          )
        )
        .for("update");

      if (rows.length !== recommendationIds.length) {
        throw new RepositoryError("Some recommendations were not found in this cycle", 404);
      }

      const alreadyDone = rows.filter(
        (r) => r.status === "approved" || r.status === "applied"
      );
      if (alreadyDone.length > 0) {
        throw new RepositoryError(
          `${alreadyDone.length} of these are already approved`,
          409
        );
      }

      const selfApproved = rows.filter((r) => r.submittedById === approvedById);
      if (selfApproved.length > 0) {
        // The same separation payroll and erasure use. A manager approving
        // their own proposals has no check on them at all.
        throw new RepositoryError(
          "You cannot approve recommendations you submitted yourself",
          403
        );
      }

      // Grouped by pool so each budget is checked against only what draws on it.
      const byPool = new Map<string | null, typeof rows>();
      for (const row of rows) {
        const key = row.poolId ?? null;
        byPool.set(key, [...(byPool.get(key) ?? []), row]);
      }

      let totalCommitted = 0n;

      for (const [poolId, group] of byPool) {
        const amount = group.reduce(
          (sum, r) => sum + (r.proposedIncreaseMinor ?? 0n),
          0n
        );

        if (poolId) {
          const [pool] = await tx
            .select()
            .from(budgetPools)
            .where(eq(budgetPools.id, poolId))
            .for("update")
            .limit(1);

          if (!pool) throw new NotFoundError("Budget pool", poolId);

          const verdict = checkBudget(
            {
              id: pool.id,
              name: pool.name,
              allocatedMinor: pool.allocatedMinor,
              committedMinor: pool.committedMinor,
            },
            group.map((r) => ({ increaseMinor: r.proposedIncreaseMinor ?? 0n }))
          );

          if (!verdict.withinBudget) {
            throw new RepositoryError(`${pool.name}: ${verdict.message}`, 422);
          }

          await tx
            .update(budgetPools)
            .set({
              committedMinor: pool.committedMinor + amount,
              updatedAt: new Date(),
            })
            .where(eq(budgetPools.id, poolId));
        }

        totalCommitted += amount;
      }

      await tx
        .update(compensationRecommendations)
        .set({
          status: "approved",
          finalPercent: sql`${compensationRecommendations.proposedPercent}`,
          finalIncreaseMinor: sql`${compensationRecommendations.proposedIncreaseMinor}`,
          approvedById,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(inArray(compensationRecommendations.id, recommendationIds));

      return { approved: rows.length, committedMinor: totalCommitted.toString() };
    });
  }

  /**
   * Applies approved increases to the employment record.
   *
   * Writes salary history in the same transaction. "What was this person paid
   * in March?" is asked by payroll reconciliation, by equal-pay analysis and
   * by litigation, and a salary column updated in place answers none of them.
   */
  async apply(cycleId: string, appliedById: string): Promise<{ applied: number }> {
    return withTenant(this.ctx, async (tx) => {
      const [cycle] = await tx
        .select()
        .from(compensationCycles)
        .where(eq(compensationCycles.id, cycleId))
        .for("update")
        .limit(1);

      if (!cycle) throw new NotFoundError("Cycle", cycleId);
      if (cycle.appliedAt) {
        // Applying twice would compound every increase.
        throw new RepositoryError("This cycle has already been applied", 409);
      }

      const approved = await tx
        .select()
        .from(compensationRecommendations)
        .where(
          and(
            eq(compensationRecommendations.cycleId, cycleId),
            eq(compensationRecommendations.status, "approved")
          )
        );

      if (approved.length === 0) {
        throw new RepositoryError("There are no approved recommendations to apply", 400);
      }

      for (const row of approved) {
        const increase = row.finalIncreaseMinor ?? 0n;
        const newSalary = row.currentSalaryMinor + increase;

        await tx
          .update(employees)
          .set({ ctcMinor: newSalary, updatedAt: new Date() })
          .where(eq(employees.id, row.employeeId));

        await tx.insert(salaryHistory).values({
          orgId: this.ctx.orgId,
          employeeId: row.employeeId,
          previousSalaryMinor: row.currentSalaryMinor,
          newSalaryMinor: newSalary,
          changePercent: row.finalPercent,
          reason: row.promotionToGradeCode ? "promotion" : "merit_increase",
          cycleId,
          recommendationId: row.id,
          effectiveOn: cycle.effectiveOn,
          approvedById: row.approvedById,
        });
      }

      await tx
        .update(compensationRecommendations)
        .set({ status: "applied", updatedAt: new Date() })
        .where(
          and(
            eq(compensationRecommendations.cycleId, cycleId),
            eq(compensationRecommendations.status, "approved")
          )
        );

      await tx
        .update(compensationCycles)
        .set({
          status: "applied",
          appliedAt: new Date(),
          approvedById: cycle.approvedById ?? appliedById,
          updatedAt: new Date(),
        })
        .where(eq(compensationCycles.id, cycleId));

      return { applied: approved.length };
    });
  }

  async listRecommendations(
    cycleId: string,
    options: { departmentId?: string; restrictToManagerId?: string } = {}
  ): Promise<RecommendationRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      let departmentId = options.departmentId;

      // A manager's scope is resolved from their own employment record, never
      // from a request parameter. Everyone's proposed increase is the most
      // sensitive list this system holds, and a query string is not a
      // permission.
      if (options.restrictToManagerId) {
        const [manager] = await tx
          .select({ departmentId: employees.departmentId })
          .from(employees)
          .where(eq(employees.id, options.restrictToManagerId))
          .limit(1);

        if (!manager?.departmentId) {
          throw new RepositoryError("You are not assigned to a department", 403);
        }
        departmentId = manager.departmentId;
      }

      const rows = await tx
        .select({ r: compensationRecommendations, first: employees.firstName, last: employees.lastName })
        .from(compensationRecommendations)
        .leftJoin(employees, eq(employees.id, compensationRecommendations.employeeId))
        .where(
          and(
            eq(compensationRecommendations.cycleId, cycleId),
            departmentId ? eq(employees.departmentId, departmentId) : undefined
          )
        )
        .orderBy(desc(compensationRecommendations.compaRatio));

      return rows.map((row) => ({
        ...this.toRecord(row.r),
        employeeName:
          row.first && row.last ? `${row.first} ${row.last}` : undefined,
      }));
    });
  }

  /** Budget position for a cycle, for the page that decides what to cut. */
  async budgetSummary(cycleId: string): Promise<
    {
      poolId: string;
      name: string;
      departmentName?: string;
      allocatedMinor: string;
      committedMinor: string;
      proposedMinor: string;
      remainingMinor: string;
      withinBudget: boolean;
    }[]
  > {
    return withTenant(this.ctx, async (tx) => {
      const pools = await tx
        .select({ p: budgetPools, departmentName: departments.name })
        .from(budgetPools)
        .leftJoin(departments, eq(departments.id, budgetPools.departmentId))
        .where(eq(budgetPools.cycleId, cycleId));

      const summary = [];

      for (const { p, departmentName } of pools) {
        const pending = await tx
          .select({ increase: compensationRecommendations.proposedIncreaseMinor })
          .from(compensationRecommendations)
          .where(
            and(
              eq(compensationRecommendations.poolId, p.id),
              inArray(compensationRecommendations.status, ["draft", "submitted", "calibrated"])
            )
          );

        const proposed = pending.reduce((sum, r) => sum + (r.increase ?? 0n), 0n);
        const remaining = p.allocatedMinor - p.committedMinor - proposed;

        summary.push({
          poolId: p.id,
          name: p.name,
          departmentName: departmentName ?? undefined,
          allocatedMinor: p.allocatedMinor.toString(),
          committedMinor: p.committedMinor.toString(),
          proposedMinor: proposed.toString(),
          remainingMinor: remaining.toString(),
          withinBudget: remaining >= 0n,
        });
      }

      return summary;
    });
  }

  // ─── Equity ────────────────────────────────────────────────

  async vestingFor(employeeId: string, asOf: string) {
    return withTenant(this.ctx, async (tx) => {
      const grants = await tx
        .select()
        .from(equityGrants)
        .where(eq(equityGrants.employeeId, employeeId))
        .orderBy(asc(equityGrants.grantDate));

      return grants.map((g) => {
        // Vesting stops at termination; anything unvested at that date lapses.
        const effectiveDate =
          g.terminationDate && g.terminationDate < asOf ? g.terminationDate : asOf;

        const state = vestingPosition(
          {
            totalUnits: g.totalUnits,
            grantDate: g.grantDate,
            cliffMonths: g.cliffMonths,
            vestingMonths: g.vestingMonths,
            cadenceMonths: g.cadenceMonths,
          },
          effectiveDate
        );

        return {
          id: g.id,
          grantNumber: g.grantNumber,
          instrument: g.instrument,
          totalUnits: g.totalUnits,
          grantDate: g.grantDate,
          strikePriceMinor: money(g.strikePriceMinor),
          exercisedUnits: g.exercisedUnits,
          exercisableUnits: Math.max(0, state.vestedUnits - g.exercisedUnits),
          ...state,
          lapsedOnTermination: Boolean(g.terminationDate && g.terminationDate < asOf),
        };
      });
    });
  }

  /**
   * Pay gap between two groups.
   *
   * Small groups are suppressed by the rules layer. Publishing a median for a
   * group of two publishes an individual's salary, and pay-equity analysis
   * that discloses pay defeats itself.
   */
  async payGapByDepartment(
    referenceDepartmentId: string,
    comparisonDepartmentId: string
  ) {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({ departmentId: employees.departmentId, ctc: employees.ctcMinor })
        .from(employees)
        .where(
          and(
            eq(employees.status, "active"),
            or(isNull(employees.ctcMinor), sql`${employees.ctcMinor} > 0`)
          )
        );

      const grouped: Record<string, bigint[]> = {};
      for (const row of rows) {
        if (!row.departmentId || !row.ctc) continue;
        grouped[row.departmentId] = [...(grouped[row.departmentId] ?? []), row.ctc];
      }

      const result = payGap(grouped, referenceDepartmentId, comparisonDepartmentId);

      return {
        ...result,
        rows: result.rows.map((r) => ({
          group: r.group,
          headcount: r.headcount,
          medianSalaryMinor: r.medianSalaryMinor.toString(),
          meanSalaryMinor: r.meanSalaryMinor.toString(),
        })),
      };
    });
  }

  /** Where every active employee sits in their band. */
  async bandDistribution() {
    return withTenant(this.ctx, async (tx) => {
      const bands = await tx.select().from(salaryBands).where(eq(salaryBands.isActive, true));
      const staff = await tx
        .select({
          id: employees.id,
          grade: employees.designation,
          locationId: employees.locationId,
          ctc: employees.ctcMinor,
        })
        .from(employees)
        .where(eq(employees.status, "active"));

      const out = [];

      for (const person of staff) {
        if (!person.ctc || person.ctc <= 0n) continue;

        const match =
          bands.find((b) => b.gradeCode === person.grade && b.locationId === person.locationId) ??
          bands.find((b) => b.gradeCode === person.grade && !b.locationId);

        if (!match) continue;

        out.push({
          employeeId: person.id,
          gradeCode: match.gradeCode,
          ...position(person.ctc, toBand(match)),
        });
      }

      return out;
    });
  }

  private toRecord(row: typeof compensationRecommendations.$inferSelect): RecommendationRecord {
    return {
      id: row.id,
      employeeId: row.employeeId,
      currentSalaryMinor: row.currentSalaryMinor.toString(),
      compaRatio: row.compaRatio ? Number(row.compaRatio) : undefined,
      quartile: row.quartile ?? undefined,
      rating: row.rating ?? undefined,
      systemPercent: row.systemPercent ? Number(row.systemPercent) : undefined,
      proposedPercent: row.proposedPercent ? Number(row.proposedPercent) : undefined,
      finalPercent: row.finalPercent ? Number(row.finalPercent) : undefined,
      proposedIncreaseMinor: money(row.proposedIncreaseMinor),
      newSalaryMinor: money(row.newSalaryMinor),
      warnings: (row.warnings as string[]) ?? [],
      rationale: row.rationale ?? undefined,
      status: row.status,
      overrideReason: row.overrideReason ?? undefined,
    };
  }
}
