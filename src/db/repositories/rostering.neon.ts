// ═══════════════════════════════════════════════════════════════
// ROSTERING REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Shift patterns, roster generation, publication and swaps. The constraint
// logic lives in src/lib/rostering.ts so it is testable without a database;
// this loads the real inputs, enforces the verdicts and holds the locks that
// make concurrent swap approvals safe.

import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { employees } from "@/db/schema/hrms";
import {
  availability,
  coverageRequirements,
  openShifts,
  rosterAssignments,
  rosters,
  shiftEligibility,
  shiftPatterns,
  shiftSwapRequests,
} from "@/db/schema/scheduling";
import {
  DEFAULT_CONSTRAINTS,
  canSwap,
  generateRoster,
  isoWeekday,
  validateRoster,
  type AvailableEmployee,
  type CoverageRequirement,
  type RosterAssignment,
  type RosterConstraints,
  type ShiftPattern,
  type Violation,
} from "@/lib/rostering";
import { NotFoundError, RepositoryError } from "./types";

/**
 * A roster operation refused because it would break a scheduling rule.
 *
 * Carries the violations rather than flattening them into a message: the UI
 * has to highlight the offending shifts on the grid, and a manager cannot act
 * on "3 rules broken" without being told which ones and whose.
 */
export class RosterConstraintError extends RepositoryError {
  constructor(
    message: string,
    readonly violations: Violation[]
  ) {
    super(message, 422);
    this.name = "RosterConstraintError";
  }
}

export interface PatternRecord {
  id: string;
  name: string;
  code: string;
  description?: string;
  colour: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  crossesMidnight: boolean;
  weekdays: number[];
  payMultiplier: number;
  allowanceMinor: number;
  departmentId?: string;
  locationId?: string;
  isActive: boolean;
}

export interface AssignmentRecord {
  id: string;
  rosterId: string;
  employeeId: string;
  employeeName?: string;
  patternId: string;
  patternName?: string;
  patternColour?: string;
  shiftDate: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: string;
  note?: string;
}

export interface RosterRecord {
  id: string;
  name: string;
  departmentId?: string;
  locationId?: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  publishedAt?: string;
  assignments?: AssignmentRecord[];
  violations?: Violation[];
  unfilled?: { date: string; patternId: string; shortfall: number; reason: string }[];
}

export interface GenerateRequest {
  rosterId: string;
  /** Overrides the org defaults; absent means use the defaults. */
  constraints?: Partial<RosterConstraints>;
  /** Replaces any existing draft assignments rather than adding to them. */
  replaceExisting?: boolean;
}

/** `HH:MM:SS` from Postgres `time` down to the `HH:MM` the engine expects. */
function toClock(value: string): string {
  return value.slice(0, 5);
}

function toEngine(row: typeof shiftPatterns.$inferSelect): ShiftPattern {
  return {
    id: row.id,
    name: row.name,
    startTime: toClock(row.startTime),
    endTime: toClock(row.endTime),
    breakMinutes: row.breakMinutes,
    weekdays: (row.weekdays as number[]) ?? [],
    isNightShift: row.crossesMidnight,
  };
}

/** Every date in an inclusive range, as `YYYY-MM-DD`. */
function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);

  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) {
    throw new RepositoryError("Roster period dates must be YYYY-MM-DD", 400);
  }
  // A roster spanning years is almost certainly a typo, and expanding it would
  // build a list large enough to exhaust memory before anyone notices.
  if ((last.getTime() - cursor.getTime()) / 86_400_000 > 366) {
    throw new RepositoryError("A roster period cannot exceed one year", 400);
  }

  while (cursor <= last) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export class NeonRosteringRepository {
  constructor(private readonly ctx: TenantContext) {}

  // ─── Patterns ──────────────────────────────────────────────

  async listPatterns(includeInactive = false): Promise<PatternRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(shiftPatterns)
        .where(includeInactive ? undefined : eq(shiftPatterns.isActive, true))
        .orderBy(asc(shiftPatterns.startTime), asc(shiftPatterns.name));

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        description: r.description ?? undefined,
        colour: r.colour,
        startTime: toClock(r.startTime),
        endTime: toClock(r.endTime),
        breakMinutes: r.breakMinutes,
        crossesMidnight: r.crossesMidnight,
        weekdays: (r.weekdays as number[]) ?? [],
        payMultiplier: Number(r.payMultiplier),
        allowanceMinor: r.allowanceMinor,
        departmentId: r.departmentId ?? undefined,
        locationId: r.locationId ?? undefined,
        isActive: r.isActive,
      }));
    });
  }

  async createPattern(input: {
    name: string;
    code: string;
    startTime: string;
    endTime: string;
    breakMinutes?: number;
    crossesMidnight?: boolean;
    weekdays?: number[];
    colour?: string;
    payMultiplier?: number;
    allowanceMinor?: number;
    departmentId?: string;
    locationId?: string;
    description?: string;
  }): Promise<PatternRecord> {
    const weekdays = input.weekdays ?? [1, 2, 3, 4, 5];
    if (weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
      throw new RepositoryError("Weekdays must be ISO numbers 1-7", 400);
    }
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(input.startTime) || !/^\d{2}:\d{2}(:\d{2})?$/.test(input.endTime)) {
      throw new RepositoryError("Shift times must be HH:MM", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .insert(shiftPatterns)
        .values({
          orgId: this.ctx.orgId,
          name: input.name,
          code: input.code,
          description: input.description,
          colour: input.colour ?? "#64748b",
          startTime: input.startTime,
          endTime: input.endTime,
          breakMinutes: input.breakMinutes ?? 0,
          // Inferred when not stated, but a caller may need to say so
          // explicitly for a 24-hour shift, where the times are equal.
          crossesMidnight:
            input.crossesMidnight ?? toClock(input.endTime) <= toClock(input.startTime),
          weekdays,
          payMultiplier: String(input.payMultiplier ?? 1),
          allowanceMinor: input.allowanceMinor ?? 0,
          departmentId: input.departmentId,
          locationId: input.locationId,
        })
        .returning();

      return {
        id: row.id,
        name: row.name,
        code: row.code,
        description: row.description ?? undefined,
        colour: row.colour,
        startTime: toClock(row.startTime),
        endTime: toClock(row.endTime),
        breakMinutes: row.breakMinutes,
        crossesMidnight: row.crossesMidnight,
        weekdays: (row.weekdays as number[]) ?? [],
        payMultiplier: Number(row.payMultiplier),
        allowanceMinor: row.allowanceMinor,
        departmentId: row.departmentId ?? undefined,
        locationId: row.locationId ?? undefined,
        isActive: row.isActive,
      };
    });
  }

  // ─── Rosters ───────────────────────────────────────────────

  async createRoster(input: {
    name: string;
    periodStart: string;
    periodEnd: string;
    departmentId?: string;
    locationId?: string;
    createdById?: string;
  }): Promise<RosterRecord> {
    if (input.periodEnd < input.periodStart) {
      throw new RepositoryError("A roster cannot end before it starts", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .insert(rosters)
        .values({
          orgId: this.ctx.orgId,
          name: input.name,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          departmentId: input.departmentId,
          locationId: input.locationId,
          createdById: input.createdById,
        })
        .returning();

      return {
        id: row.id,
        name: row.name,
        departmentId: row.departmentId ?? undefined,
        locationId: row.locationId ?? undefined,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        status: row.status,
      };
    });
  }

  async getRoster(id: string): Promise<RosterRecord | null> {
    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx.select().from(rosters).where(eq(rosters.id, id)).limit(1);
      if (!row) return null;

      const assignments = await tx
        .select({
          a: rosterAssignments,
          employeeFirst: employees.firstName,
          employeeLast: employees.lastName,
          patternName: shiftPatterns.name,
          patternColour: shiftPatterns.colour,
        })
        .from(rosterAssignments)
        .leftJoin(employees, eq(employees.id, rosterAssignments.employeeId))
        .leftJoin(shiftPatterns, eq(shiftPatterns.id, rosterAssignments.patternId))
        .where(eq(rosterAssignments.rosterId, id))
        .orderBy(asc(rosterAssignments.shiftDate), asc(rosterAssignments.startsAt));

      const gaps = await tx.select().from(openShifts).where(eq(openShifts.rosterId, id));

      const mapped: AssignmentRecord[] = assignments.map((r) => ({
        id: r.a.id,
        rosterId: r.a.rosterId,
        employeeId: r.a.employeeId,
        employeeName:
          r.employeeFirst && r.employeeLast
            ? `${r.employeeFirst} ${r.employeeLast}`
            : undefined,
        patternId: r.a.patternId,
        patternName: r.patternName ?? undefined,
        patternColour: r.patternColour ?? undefined,
        shiftDate: r.a.shiftDate,
        startsAt: r.a.startsAt.toISOString(),
        endsAt: r.a.endsAt.toISOString(),
        durationMinutes: r.a.durationMinutes,
        status: r.a.status,
        note: r.a.note ?? undefined,
      }));

      // Validated against the snapshot for a published roster, so it stays
      // explicable against the rules it was published under.
      const constraints: RosterConstraints = {
        ...DEFAULT_CONSTRAINTS,
        ...(row.constraintsSnapshot ?? {}),
      };

      return {
        id: row.id,
        name: row.name,
        departmentId: row.departmentId ?? undefined,
        locationId: row.locationId ?? undefined,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        status: row.status,
        publishedAt: row.publishedAt?.toISOString(),
        assignments: mapped,
        violations: validateRoster(
          mapped
            .filter((a) => a.status !== "cancelled" && a.status !== "swapped_out")
            .map(toEngineAssignment),
          constraints
        ),
        unfilled: gaps.map((g) => ({
          date: g.shiftDate,
          patternId: g.patternId,
          shortfall: g.headcountNeeded,
          reason: g.reason ?? "Unfilled",
        })),
      };
    });
  }

  /**
   * Generates draft assignments for a roster.
   *
   * Everything the generator needs is loaded first — patterns, eligibility,
   * availability and existing commitments outside this roster — because a
   * roster built without knowing about someone's approved leave is the single
   * most common scheduling complaint.
   */
  async generate(request: GenerateRequest): Promise<RosterRecord> {
    return withTenant(this.ctx, async (tx) => {
      const [roster] = await tx
        .select()
        .from(rosters)
        .where(eq(rosters.id, request.rosterId))
        .limit(1);

      if (!roster) throw new NotFoundError("Roster", request.rosterId);
      if (roster.status === "published" || roster.status === "archived") {
        // Regenerating a published roster would silently change shifts people
        // have already arranged their lives around.
        throw new RepositoryError(
          "A published roster cannot be regenerated; create a new version instead",
          409
        );
      }

      const constraints: RosterConstraints = { ...DEFAULT_CONSTRAINTS, ...request.constraints };
      const period = datesBetween(roster.periodStart, roster.periodEnd);

      const patternRows = await tx
        .select()
        .from(shiftPatterns)
        .where(
          and(
            eq(shiftPatterns.isActive, true),
            roster.departmentId
              ? or(
                  eq(shiftPatterns.departmentId, roster.departmentId),
                  isNull(shiftPatterns.departmentId)
                )
              : undefined
          )
        );

      const patterns = patternRows.map(toEngine);
      const patternIds = new Set(patterns.map((p) => p.id));

      // ── Coverage ──
      const rules = await tx
        .select()
        .from(coverageRequirements)
        .where(
          and(
            lte(coverageRequirements.effectiveFrom, roster.periodEnd),
            or(
              isNull(coverageRequirements.effectiveUntil),
              gte(coverageRequirements.effectiveUntil, roster.periodStart)
            )
          )
        );

      const requirements: CoverageRequirement[] = [];
      for (const date of period) {
        const weekday = isoWeekday(date);
        for (const rule of rules) {
          if (!patternIds.has(rule.patternId)) continue;
          if (rule.weekday !== null && rule.weekday !== weekday) continue;
          if (date < rule.effectiveFrom) continue;
          if (rule.effectiveUntil && date > rule.effectiveUntil) continue;

          // The pattern's own weekday list still governs: a rule cannot
          // conjure a Sunday shift out of a weekday-only pattern.
          const pattern = patterns.find((p) => p.id === rule.patternId);
          if (!pattern || !pattern.weekdays.includes(weekday)) continue;

          requirements.push({ date, patternId: rule.patternId, headcount: rule.headcount });
        }
      }

      // ── People ──
      const staffRows = await tx
        .select({
          id: employees.id,
          contractedHours: employees.contractedHoursPerWeek,
        })
        .from(employees)
        .where(
          and(
            eq(employees.status, "active"),
            roster.departmentId ? eq(employees.departmentId, roster.departmentId) : undefined
          )
        );

      const staffIds = staffRows.map((s) => s.id);

      const eligibilityRows = staffIds.length
        ? await tx
            .select()
            .from(shiftEligibility)
            .where(inArray(shiftEligibility.employeeId, staffIds))
        : [];

      const unavailableRows = staffIds.length
        ? await tx
            .select()
            .from(availability)
            .where(
              and(
                inArray(availability.employeeId, staffIds),
                inArray(availability.kind, ["unavailable", "leave", "training", "holiday"]),
                lte(availability.startDate, roster.periodEnd),
                gte(availability.endDate, roster.periodStart)
              )
            )
        : [];

      const unavailableByEmployee = new Map<string, Set<string>>();
      for (const row of unavailableRows) {
        const set = unavailableByEmployee.get(row.employeeId) ?? new Set<string>();
        for (const date of datesBetween(row.startDate, row.endDate)) set.add(date);
        unavailableByEmployee.set(row.employeeId, set);
      }

      const staff: AvailableEmployee[] = staffRows.map((s) => ({
        employeeId: s.id,
        eligiblePatternIds: eligibilityRows
          .filter((e) => e.employeeId === s.id)
          .filter((e) => !e.validUntil || e.validUntil >= roster.periodStart)
          .map((e) => e.patternId),
        unavailableDates: [...(unavailableByEmployee.get(s.id) ?? [])],
        // Someone with no contracted hours recorded would divide by zero in
        // the fairness sort and never be picked.
        contractedHoursPerWeek: Number(s.contractedHours ?? 40) || 40,
      }));

      const result = generateRoster(requirements, staff, patterns, constraints);

      if (request.replaceExisting !== false) {
        await tx.delete(rosterAssignments).where(eq(rosterAssignments.rosterId, roster.id));
        await tx.delete(openShifts).where(eq(openShifts.rosterId, roster.id));
      }

      if (result.assignments.length > 0) {
        await tx.insert(rosterAssignments).values(
          result.assignments.map((a) => ({
            orgId: this.ctx.orgId,
            rosterId: roster.id,
            employeeId: a.employeeId,
            patternId: a.patternId,
            shiftDate: a.date,
            startsAt: a.startsAt,
            endsAt: a.endsAt,
            durationMinutes: a.durationMinutes,
          }))
        );
      }

      if (result.unfilled.length > 0) {
        await tx.insert(openShifts).values(
          result.unfilled.map((u) => ({
            orgId: this.ctx.orgId,
            rosterId: roster.id,
            patternId: u.patternId,
            shiftDate: u.date,
            headcountNeeded: u.shortfall,
            reason: u.reason,
          }))
        );
      }

      await tx
        .update(rosters)
        .set({ updatedAt: new Date() })
        .where(eq(rosters.id, roster.id));

      const saved = await this.getRosterIn(tx, roster.id);
      return saved!;
    });
  }

  /**
   * Publishes a roster, which is the point it becomes a commitment.
   *
   * Blocking violations refuse publication outright. Warnings may be accepted,
   * but the manager has to justify each one — an override with no reason
   * recorded is indistinguishable from an oversight when it is reviewed later.
   */
  async publish(
    rosterId: string,
    publishedById: string,
    acceptedWarnings: { code: string; employeeId: string; date: string; justification: string }[] = []
  ): Promise<RosterRecord> {
    return withTenant(this.ctx, async (tx) => {
      const [roster] = await tx
        .select()
        .from(rosters)
        .where(eq(rosters.id, rosterId))
        .for("update")
        .limit(1);

      if (!roster) throw new NotFoundError("Roster", rosterId);
      if (roster.status === "published") {
        throw new RepositoryError("This roster is already published", 409);
      }
      if (roster.status === "archived") {
        throw new RepositoryError("An archived roster cannot be published", 409);
      }

      const rows = await tx
        .select()
        .from(rosterAssignments)
        .where(eq(rosterAssignments.rosterId, rosterId));

      if (rows.length === 0) {
        throw new RepositoryError("A roster with no shifts cannot be published", 400);
      }

      const constraints: RosterConstraints = {
        ...DEFAULT_CONSTRAINTS,
        ...(roster.constraintsSnapshot ?? {}),
      };

      const violations = validateRoster(
        rows.map((r) => ({
          employeeId: r.employeeId,
          date: r.shiftDate,
          patternId: r.patternId,
          startsAt: r.startsAt,
          endsAt: r.endsAt,
          durationMinutes: r.durationMinutes,
        })),
        constraints
      );

      const blocking = violations.filter((v) => v.severity === "blocking");
      if (blocking.length > 0) {
        throw new RosterConstraintError(
          `This roster breaks ${blocking.length} rule${blocking.length === 1 ? "" : "s"} and cannot be published`,
          blocking
        );
      }

      const warnings = violations.filter((v) => v.severity === "warning");
      const unjustified = warnings.filter(
        (w) =>
          !acceptedWarnings.some(
            (a) =>
              a.code === w.code &&
              a.employeeId === w.employeeId &&
              a.date === w.date &&
              a.justification.trim().length > 0
          )
      );

      if (unjustified.length > 0) {
        throw new RosterConstraintError(
          "Each warning must be acknowledged with a justification before publishing",
          unjustified
        );
      }

      await tx
        .update(rosters)
        .set({
          status: "published",
          publishedById,
          publishedAt: new Date(),
          constraintsSnapshot: constraints,
          acceptedWarnings,
          updatedAt: new Date(),
        })
        .where(eq(rosters.id, rosterId));

      return (await this.getRosterIn(tx, rosterId))!;
    });
  }

  // ─── Swaps ─────────────────────────────────────────────────

  async requestSwap(input: {
    assignmentId: string;
    requestedById: string;
    targetEmployeeId?: string;
    reason?: string;
  }): Promise<{ id: string; status: string }> {
    return withTenant(this.ctx, async (tx) => {
      const [assignment] = await tx
        .select()
        .from(rosterAssignments)
        .where(eq(rosterAssignments.id, input.assignmentId))
        .limit(1);

      if (!assignment) throw new NotFoundError("Assignment", input.assignmentId);
      if (assignment.employeeId !== input.requestedById) {
        throw new RepositoryError("You can only give away your own shift", 403);
      }
      if (assignment.startsAt <= new Date()) {
        throw new RepositoryError("This shift has already started", 400);
      }
      if (assignment.status !== "scheduled" && assignment.status !== "confirmed") {
        throw new RepositoryError(`This shift is ${assignment.status}`, 409);
      }

      const [existing] = await tx
        .select({ id: shiftSwapRequests.id })
        .from(shiftSwapRequests)
        .where(
          and(
            eq(shiftSwapRequests.assignmentId, input.assignmentId),
            inArray(shiftSwapRequests.status, ["open", "accepted", "pending_approval"])
          )
        )
        .limit(1);

      if (existing) {
        throw new RepositoryError("A swap is already open for this shift", 409);
      }

      const [row] = await tx
        .insert(shiftSwapRequests)
        .values({
          orgId: this.ctx.orgId,
          assignmentId: input.assignmentId,
          requestedById: input.requestedById,
          targetEmployeeId: input.targetEmployeeId,
          reason: input.reason,
          // An open offer for a shift that has started is noise on everyone's
          // list, so it lapses at the moment it stops being actionable.
          expiresAt: assignment.startsAt,
        })
        .returning();

      return { id: row.id, status: row.status };
    });
  }

  /**
   * A colleague accepts an offered shift.
   *
   * The constraint check runs here and again at approval. Between the two, the
   * accepter's own schedule may change — and their agreement does not make an
   * illegal roster legal.
   */
  async acceptSwap(swapId: string, acceptedById: string): Promise<{ status: string }> {
    return withTenant(this.ctx, async (tx) => {
      const [swap] = await tx
        .select()
        .from(shiftSwapRequests)
        .where(eq(shiftSwapRequests.id, swapId))
        .for("update")
        .limit(1);

      if (!swap) throw new NotFoundError("Swap request", swapId);
      if (swap.status !== "open") {
        throw new RepositoryError(`This swap is ${swap.status}`, 409);
      }
      if (swap.targetEmployeeId && swap.targetEmployeeId !== acceptedById) {
        throw new RepositoryError("This shift was offered to someone else", 403);
      }
      if (swap.requestedById === acceptedById) {
        throw new RepositoryError("You cannot take your own shift", 400);
      }

      const verdict = await this.checkSwapIn(tx, swap.assignmentId, acceptedById);
      if (!verdict.allowed) {
        throw new RosterConstraintError(verdict.reason, verdict.violations);
      }

      await tx
        .update(shiftSwapRequests)
        .set({ status: "pending_approval", acceptedById, updatedAt: new Date() })
        .where(eq(shiftSwapRequests.id, swapId));

      return { status: "pending_approval" };
    });
  }

  async approveSwap(
    swapId: string,
    approvedById: string,
    approve: boolean,
    rejectionReason?: string
  ): Promise<{ status: string }> {
    return withTenant(this.ctx, async (tx) => {
      const [swap] = await tx
        .select()
        .from(shiftSwapRequests)
        .where(eq(shiftSwapRequests.id, swapId))
        .for("update")
        .limit(1);

      if (!swap) throw new NotFoundError("Swap request", swapId);
      if (swap.status !== "pending_approval") {
        throw new RepositoryError(`This swap is ${swap.status}`, 409);
      }

      if (!approve) {
        await tx
          .update(shiftSwapRequests)
          .set({
            status: "rejected",
            approvedById,
            rejectionReason: rejectionReason ?? "Not approved",
            updatedAt: new Date(),
          })
          .where(eq(shiftSwapRequests.id, swapId));
        return { status: "rejected" };
      }

      if (!swap.acceptedById) {
        throw new RepositoryError("Nobody has accepted this shift", 409);
      }

      // Re-checked at approval: the accepter may have picked up other shifts
      // since, and approving a swap that breaches their rest is still illegal
      // however willing both parties are.
      const verdict = await this.checkSwapIn(tx, swap.assignmentId, swap.acceptedById);
      if (!verdict.allowed) {
        await tx
          .update(shiftSwapRequests)
          .set({
            status: "rejected",
            approvedById,
            rejectionReason: verdict.reason,
            updatedAt: new Date(),
          })
          .where(eq(shiftSwapRequests.id, swapId));

        throw new RosterConstraintError(verdict.reason, verdict.violations);
      }

      const [original] = await tx
        .select()
        .from(rosterAssignments)
        .where(eq(rosterAssignments.id, swap.assignmentId))
        .for("update")
        .limit(1);

      if (!original) throw new NotFoundError("Assignment", swap.assignmentId);

      // The original is retained rather than reassigned, so the roster keeps a
      // record of who was originally due to work and who actually did.
      await tx
        .update(rosterAssignments)
        .set({ status: "swapped_out", updatedAt: new Date() })
        .where(eq(rosterAssignments.id, original.id));

      await tx.insert(rosterAssignments).values({
        orgId: this.ctx.orgId,
        rosterId: original.rosterId,
        employeeId: swap.acceptedById,
        patternId: original.patternId,
        shiftDate: original.shiftDate,
        startsAt: original.startsAt,
        endsAt: original.endsAt,
        durationMinutes: original.durationMinutes,
        status: "scheduled",
        replacesAssignmentId: original.id,
      });

      await tx
        .update(shiftSwapRequests)
        .set({
          status: "approved",
          approvedById,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(shiftSwapRequests.id, swapId));

      return { status: "approved" };
    });
  }

  /** An employee's own shifts, which is what the mobile app asks for. */
  async myShifts(employeeId: string, from: string, to: string): Promise<AssignmentRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({
          a: rosterAssignments,
          patternName: shiftPatterns.name,
          patternColour: shiftPatterns.colour,
          rosterStatus: rosters.status,
        })
        .from(rosterAssignments)
        .leftJoin(shiftPatterns, eq(shiftPatterns.id, rosterAssignments.patternId))
        .innerJoin(rosters, eq(rosters.id, rosterAssignments.rosterId))
        .where(
          and(
            eq(rosterAssignments.employeeId, employeeId),
            gte(rosterAssignments.shiftDate, from),
            lte(rosterAssignments.shiftDate, to),
            // Draft rosters change; showing them would have people planning
            // around shifts that may never happen.
            eq(rosters.status, "published")
          )
        )
        .orderBy(asc(rosterAssignments.startsAt));

      return rows
        .filter((r) => r.a.status !== "swapped_out" && r.a.status !== "cancelled")
        .map((r) => ({
          id: r.a.id,
          rosterId: r.a.rosterId,
          employeeId: r.a.employeeId,
          patternId: r.a.patternId,
          patternName: r.patternName ?? undefined,
          patternColour: r.patternColour ?? undefined,
          shiftDate: r.a.shiftDate,
          startsAt: r.a.startsAt.toISOString(),
          endsAt: r.a.endsAt.toISOString(),
          durationMinutes: r.a.durationMinutes,
          status: r.a.status,
          note: r.a.note ?? undefined,
        }));
    });
  }

  // ─── Internals ─────────────────────────────────────────────

  private async checkSwapIn(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    assignmentId: string,
    toEmployeeId: string
  ): Promise<{ allowed: true } | { allowed: false; reason: string; violations: Violation[] }> {
    const [assignment] = await tx
      .select()
      .from(rosterAssignments)
      .where(eq(rosterAssignments.id, assignmentId))
      .limit(1);

    if (!assignment) throw new NotFoundError("Assignment", assignmentId);

    const [eligible] = await tx
      .select({ id: shiftEligibility.id })
      .from(shiftEligibility)
      .where(
        and(
          eq(shiftEligibility.employeeId, toEmployeeId),
          eq(shiftEligibility.patternId, assignment.patternId)
        )
      )
      .limit(1);

    if (!eligible) {
      return {
        allowed: false,
        reason: "They are not signed off to work this shift pattern",
        violations: [],
      };
    }

    // A fortnight either side is enough to see rest and rolling-week breaches
    // without loading the accepter's entire schedule.
    const windowStart = shiftDate(assignment.shiftDate, -14);
    const windowEnd = shiftDate(assignment.shiftDate, 14);

    const nearby = await tx
      .select()
      .from(rosterAssignments)
      .where(
        and(
          inArray(rosterAssignments.employeeId, [assignment.employeeId, toEmployeeId]),
          gte(rosterAssignments.shiftDate, windowStart),
          lte(rosterAssignments.shiftDate, windowEnd),
          inArray(rosterAssignments.status, ["scheduled", "confirmed", "completed"])
        )
      );

    const unavailableRows = await tx
      .select()
      .from(availability)
      .where(
        and(
          eq(availability.employeeId, toEmployeeId),
          inArray(availability.kind, ["unavailable", "leave", "training", "holiday"]),
          lte(availability.startDate, windowEnd),
          gte(availability.endDate, windowStart)
        )
      );

    const unavailable = unavailableRows.flatMap((row) =>
      datesBetween(row.startDate, row.endDate).map((date) => ({
        employeeId: toEmployeeId,
        date,
        reason: row.reason ?? row.kind,
      }))
    );

    const engineAssignments = nearby.map((r) => ({
      employeeId: r.employeeId,
      date: r.shiftDate,
      patternId: r.patternId,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      durationMinutes: r.durationMinutes,
    }));

    const target = engineAssignments.find(
      (a) =>
        a.employeeId === assignment.employeeId &&
        a.date === assignment.shiftDate &&
        a.patternId === assignment.patternId
    );

    if (!target) {
      return { allowed: false, reason: "This shift is no longer on the roster", violations: [] };
    }

    return canSwap(engineAssignments, target, toEmployeeId, DEFAULT_CONSTRAINTS, unavailable);
  }

  private async getRosterIn(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    id: string
  ): Promise<RosterRecord | null> {
    const [row] = await tx.select().from(rosters).where(eq(rosters.id, id)).limit(1);
    if (!row) return null;

    const assignments = await tx
      .select()
      .from(rosterAssignments)
      .where(eq(rosterAssignments.rosterId, id))
      .orderBy(asc(rosterAssignments.startsAt));

    const gaps = await tx.select().from(openShifts).where(eq(openShifts.rosterId, id));

    const constraints: RosterConstraints = {
      ...DEFAULT_CONSTRAINTS,
      ...(row.constraintsSnapshot ?? {}),
    };

    const mapped: AssignmentRecord[] = assignments.map((a) => ({
      id: a.id,
      rosterId: a.rosterId,
      employeeId: a.employeeId,
      patternId: a.patternId,
      shiftDate: a.shiftDate,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      durationMinutes: a.durationMinutes,
      status: a.status,
      note: a.note ?? undefined,
    }));

    return {
      id: row.id,
      name: row.name,
      departmentId: row.departmentId ?? undefined,
      locationId: row.locationId ?? undefined,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      status: row.status,
      publishedAt: row.publishedAt?.toISOString(),
      assignments: mapped,
      violations: validateRoster(
        mapped
          .filter((a) => a.status !== "cancelled" && a.status !== "swapped_out")
          .map(toEngineAssignment),
        constraints
      ),
      unfilled: gaps.map((g) => ({
        date: g.shiftDate,
        patternId: g.patternId,
        shortfall: g.headcountNeeded,
        reason: g.reason ?? "Unfilled",
      })),
    };
  }

  /**
   * Rosters for a period.
   *
   * Only a single roster could be fetched, by id. Nothing could list them, so
   * there was no way to find the id of the roster you wanted.
   */
  async listRosters(query: { from?: string; to?: string; status?: string } = {}) {
    return withTenant(this.ctx, async (tx) => {
      const conditions = [];
      // Overlap, not containment: a roster that starts before the window and
      // ends inside it is still one you are asking about.
      if (query.from) conditions.push(gte(rosters.periodEnd, query.from));
      if (query.to) conditions.push(lte(rosters.periodStart, query.to));
      if (query.status && query.status !== "all") {
        conditions.push(eq(rosters.status, query.status as never));
      }

      const rows = await tx
        .select()
        .from(rosters)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(rosters.periodStart));

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        departmentId: r.departmentId ?? undefined,
        locationId: r.locationId ?? undefined,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        status: r.status,
      }));
    });
  }

  /**
   * Swap requests.
   *
   * A swap could be requested, accepted and approved, but never listed — so
   * an approver had no queue to work from, and the person who asked could not
   * see whether anybody had picked it up.
   */
  async listSwaps(query: { status?: string; employeeId?: string } = {}) {
    return withTenant(this.ctx, async (tx) => {
      const conditions = [];
      if (query.status && query.status !== "all") {
        conditions.push(eq(shiftSwapRequests.status, query.status as never));
      }
      if (query.employeeId) {
        // Either side of the swap: the person who asked, and the person asked.
        conditions.push(
          or(
            eq(shiftSwapRequests.requestedById, query.employeeId),
            eq(shiftSwapRequests.targetEmployeeId, query.employeeId)
          )
        );
      }

      const rows = await tx
        .select()
        .from(shiftSwapRequests)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(shiftSwapRequests.status));

      return rows.map((r) => ({
        id: r.id,
        assignmentId: r.assignmentId,
        requestedById: r.requestedById,
        targetEmployeeId: r.targetEmployeeId ?? undefined,
        acceptedById: r.acceptedById ?? undefined,
        status: r.status,
        reason: r.reason ?? undefined,
        rejectionReason: r.rejectionReason ?? undefined,
      }));
    });
  }
}

function toEngineAssignment(a: AssignmentRecord): RosterAssignment {
  return {
    employeeId: a.employeeId,
    date: a.shiftDate,
    patternId: a.patternId,
    startsAt: new Date(a.startsAt),
    endsAt: new Date(a.endsAt),
    durationMinutes: a.durationMinutes,
  };
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
