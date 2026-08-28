// ═══════════════════════════════════════════════════════════════
// RESIGNATION REPOSITORY — Neon implementation
// ═══════════════════════════════════════════════════════════════
// The leaver path's own storage: a resignation being submitted, accepted,
// its last working day agreed or adjusted, and — the part the rest of this
// file exists for — everything `offboarding-exit.ts` needs to price and
// process an exit exactly once.
//
// Two things matter more than the CRUD, the same two things that mattered
// for `lifecycle.neon.ts`:
//
//   * **A resignation is accepted, not edited into acceptance.** The status,
//     the acceptance metadata and the agreed last working day change
//     together under one lock, so two people actioning the same resignation
//     at once cannot both succeed against a stale row.
//
//   * **A settlement is frozen, never recomputed.** `saveSettlementSnapshot`
//     is the one write in this file that matters most: it takes the row lock,
//     checks whether a snapshot already exists, and only writes if it does
//     not. Salary structures and leave balances keep changing after somebody
//     leaves, so reading a live figure back a second time would quietly
//     change a number a payslip already promised. First write wins; every
//     later caller reads the same frozen number back.

import { and, asc, count, desc, eq, isNull, lte, sql, type SQL } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { employees, leaveBalances, leavePolicies, resignations, salaryStructures } from "@/db/schema/hrms";
import { availableDays } from "@/lib/leave-provisioning";
import { minorToMajor } from "@/lib/money/minor";
import { dateKeyInZone, todayKey } from "@/lib/date-keys";
import {
  DEFAULT_NOTICE_PERIOD_DAYS,
  canAcceptResignation,
  canAdjustLastWorkingDay,
  canSubmitResignation,
  computeAgreedLastWorkingDay,
} from "@/lib/offboarding-resignation";
import { offboardingTaskTemplates } from "@/lib/offboarding-checklist";
import type { SettlementComponents } from "@/lib/employee-lifecycle";
import { NeonLifecycleRepository } from "./lifecycle.neon";
import { NotFoundError, RepositoryError, type ListQuery, type Page } from "./types";

export type ResignationStatus = "submitted" | "accepted";

export interface ResignationRecord {
  id: string;
  employeeId: string;
  employeeName?: string;
  status: ResignationStatus;
  reason: string;
  intendedLastWorkingDay: string;
  /** Null until acceptance sets it from notice policy. */
  agreedLastWorkingDay?: string;
  submittedAt: string;
  acceptedAt?: string;
  acceptedById?: string;
  lastWorkingDayAdjustedAt?: string;
  lastWorkingDayAdjustedById?: string;
  exitProcessedAt?: string;
  settlementSnapshot?: SettlementComponents;
  relievingLetterDocumentId?: string;
  experienceCertificateDocumentId?: string;
  internshipCompletionDocumentId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Everything `offboarding-exit.ts` needs to price a settlement, gathered in one call so it never has to know the schema itself. */
export interface ExitSettlementInputs {
  joinDate: string;
  noticePeriodDays: number;
  monthlyBasicPay: number;
  monthlyGrossPay: number;
  encashableLeaveDays: number;
  employmentType: string;
  workEmail: string;
}

type ResignationRow = typeof resignations.$inferSelect;

function toRecord(row: ResignationRow, employeeName?: string): ResignationRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName,
    status: row.status,
    reason: row.reason,
    intendedLastWorkingDay: row.intendedLastWorkingDay,
    agreedLastWorkingDay: row.agreedLastWorkingDay ?? undefined,
    submittedAt: row.submittedAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString(),
    acceptedById: row.acceptedById ?? undefined,
    lastWorkingDayAdjustedAt: row.lastWorkingDayAdjustedAt?.toISOString(),
    lastWorkingDayAdjustedById: row.lastWorkingDayAdjustedById ?? undefined,
    exitProcessedAt: row.exitProcessedAt?.toISOString(),
    settlementSnapshot: (row.settlementSnapshot as SettlementComponents | null) ?? undefined,
    relievingLetterDocumentId: row.relievingLetterDocumentId ?? undefined,
    experienceCertificateDocumentId: row.experienceCertificateDocumentId ?? undefined,
    internshipCompletionDocumentId: row.internshipCompletionDocumentId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertDateKey(value: string, label: string): void {
  if (!DATE_KEY_PATTERN.test(value)) {
    throw new RepositoryError(`${label} must be a YYYY-MM-DD date`, 400);
  }
}

export class NeonResignationRepository {
  constructor(private readonly ctx: TenantContext) {}

  async list(q: ListQuery = {}): Promise<Page<ResignationRecord>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));

    const conditions: SQL[] = [];
    const filters = q.filters ?? {};
    if (filters.status && filters.status !== "all") {
      conditions.push(eq(resignations.status, filters.status as ResignationStatus));
    }
    if (filters.employeeId) {
      conditions.push(eq(resignations.employeeId, filters.employeeId as string));
    }

    return withTenant(this.ctx, async (tx) => {
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await tx
        .select({
          resignation: resignations,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(resignations)
        .leftJoin(employees, eq(employees.id, resignations.employeeId))
        .where(where)
        .orderBy(desc(resignations.submittedAt), asc(resignations.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(resignations)
        .where(where);

      const items = rows.map((r) =>
        toRecord(
          r.resignation,
          r.firstName || r.lastName ? `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() : undefined
        )
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

  async getById(id: string): Promise<ResignationRecord | null> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({
          resignation: resignations,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(resignations)
        .leftJoin(employees, eq(employees.id, resignations.employeeId))
        .where(eq(resignations.id, id))
        .limit(1);

      const row = rows[0];
      if (!row) return null;
      return toRecord(
        row.resignation,
        row.firstName || row.lastName ? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() : undefined
      );
    });
  }

  /** The one resignation still open for this employee, if any — what `canSubmitResignation` and the employee's own resignation page both need. */
  async getActiveByEmployee(employeeId: string): Promise<ResignationRecord | null> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(resignations)
        .where(and(eq(resignations.employeeId, employeeId), isNull(resignations.exitProcessedAt)))
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  /**
   * Submits a resignation.
   *
   * The existence check and the insert happen in the same transaction the
   * partial unique index also guards — belt and braces the same way
   * `lifecycle.neon.ts`'s `start()` is: the index is what actually stops two
   * concurrent submits from both landing, this check is what turns the
   * common case into a clean 409 instead of a raw constraint-violation error
   * bubbling out of the driver.
   */
  async submit(input: {
    employeeId: string;
    reason: string;
    intendedLastWorkingDay: string;
  }): Promise<ResignationRecord> {
    assertDateKey(input.intendedLastWorkingDay, "intendedLastWorkingDay");
    if (input.intendedLastWorkingDay < todayKey()) {
      throw new RepositoryError("The intended last working day cannot be in the past", 400);
    }
    const reason = input.reason.trim();
    if (!reason) throw new RepositoryError("A reason is required", 400);

    return withTenant(this.ctx, async (tx) => {
      const employeeRow = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.id, input.employeeId))
        .limit(1);
      if (!employeeRow[0]) throw new NotFoundError("Employee", input.employeeId);

      const existing = await tx
        .select({ id: resignations.id })
        .from(resignations)
        .where(and(eq(resignations.employeeId, input.employeeId), isNull(resignations.exitProcessedAt)))
        .limit(1);

      if (!canSubmitResignation(!!existing[0])) {
        throw new RepositoryError("This employee already has an open resignation", 409);
      }

      const [row] = await tx
        .insert(resignations)
        .values({
          orgId: this.ctx.orgId,
          employeeId: input.employeeId,
          reason,
          intendedLastWorkingDay: input.intendedLastWorkingDay,
        })
        .returning();

      return toRecord(row);
    });
  }

  /**
   * Accepts a resignation, computing the agreed last working day from notice
   * policy at the moment of acceptance — not before, because policy is read
   * from the employee's *current* `noticePeriodDays`, and a resignation can
   * sit `submitted` for days while a manager gets round to it.
   */
  async accept(id: string, acceptedById: string): Promise<ResignationRecord> {
    const record = await withTenant(this.ctx, async (tx) => {
      const locked = await tx
        .select()
        .from(resignations)
        .where(eq(resignations.id, id))
        .for("update")
        .limit(1);

      const resignation = locked[0];
      if (!resignation) throw new NotFoundError("Resignation", id);
      if (!canAcceptResignation(resignation.status)) {
        throw new RepositoryError(`A resignation that is ${resignation.status} cannot be accepted`, 409);
      }

      const employeeRow = await tx
        .select({ noticePeriodDays: employees.noticePeriodDays })
        .from(employees)
        .where(eq(employees.id, resignation.employeeId))
        .limit(1);

      const noticePeriodDays = employeeRow[0]?.noticePeriodDays ?? DEFAULT_NOTICE_PERIOD_DAYS;
      const submittedAtKey = dateKeyInZone(resignation.submittedAt);
      const agreedLastWorkingDay = computeAgreedLastWorkingDay(
        submittedAtKey,
        resignation.intendedLastWorkingDay,
        noticePeriodDays
      );

      const [updated] = await tx
        .update(resignations)
        .set({
          status: "accepted",
          acceptedAt: new Date(),
          acceptedById,
          agreedLastWorkingDay,
          updatedAt: new Date(),
        })
        .where(eq(resignations.id, id))
        .returning();

      // `notice_period` is read all over this app — the regular payroll
      // run's payable set, the workforce/analytics pages, the employees
      // directory's "Notice" tab, and the offboarding page's own exit
      // filter all key off this value — but until this line, nothing ever
      // wrote it. A resignation could be accepted and still be invisible
      // everywhere except the resignations table.
      await tx
        .update(employees)
        .set({ status: "notice_period", updatedAt: new Date() })
        .where(eq(employees.id, resignation.employeeId));

      return toRecord(updated);
    });

    await this.ensureOffboardingJourney(record);
    return record;
  }

  /**
   * Starts the offboarding checklist the moment a resignation is accepted,
   * so it is assigned up front instead of waiting for whichever admin
   * happens to be first to open the offboarding page and tick a box.
   *
   * Deliberately run outside the acceptance transaction, and deliberately
   * never allowed to fail the acceptance: this repository's job is the
   * resignation record, and a resignation must not fail to accept because a
   * second, unrelated insert had a problem. This is not a case of the
   * outbox bug repeating itself, either — a missed journey here still has a
   * second path to existing: the offboarding page's own `ensureJourney`
   * creates the identical checklist (same task keys, same
   * `offboardingTaskTemplates()`) the first time anyone opens it for this
   * employee. This call is a head start, not the only route to a checklist.
   */
  private async ensureOffboardingJourney(resignation: ResignationRecord): Promise<void> {
    try {
      await new NeonLifecycleRepository(this.ctx).start({
        employeeId: resignation.employeeId,
        kind: "offboarding",
        anchorDate: resignation.agreedLastWorkingDay ?? resignation.intendedLastWorkingDay,
        exitReason: resignation.reason,
        tasks: offboardingTaskTemplates(),
      });
    } catch (error) {
      // A 409 means the checklist already exists — someone beat this call
      // to it, which is fine. Anything else is logged, not swallowed
      // blind, but still does not fail the acceptance that already committed.
      if (error instanceof RepositoryError && error.status === 409) return;
      console.error(`Could not start offboarding checklist for employee ${resignation.employeeId}:`, error);
    }
  }

  /**
   * HR moving the agreed last working day earlier or later than notice
   * policy alone would produce — releasing someone early, or holding them to
   * a longer handover than they offered.
   *
   * Blocked once a settlement snapshot exists (see `canAdjustLastWorkingDay`
   * in offboarding-resignation.ts for why the snapshot, not the exit, is the
   * cutoff): moving the date after the money has been priced would leave a
   * frozen settlement silently wrong about which day it was priced against.
   */
  async adjustLastWorkingDay(
    id: string,
    newLastWorkingDay: string,
    adjustedById: string
  ): Promise<ResignationRecord> {
    assertDateKey(newLastWorkingDay, "newLastWorkingDay");

    return withTenant(this.ctx, async (tx) => {
      const locked = await tx
        .select()
        .from(resignations)
        .where(eq(resignations.id, id))
        .for("update")
        .limit(1);

      const resignation = locked[0];
      if (!resignation) throw new NotFoundError("Resignation", id);

      const hasSnapshot = resignation.settlementSnapshot != null;
      if (!canAdjustLastWorkingDay(resignation.status, hasSnapshot)) {
        const why = hasSnapshot
          ? "its settlement has already been calculated"
          : `it is ${resignation.status}, not accepted`;
        throw new RepositoryError(`The last working day cannot be adjusted: ${why}`, 409);
      }

      const [updated] = await tx
        .update(resignations)
        .set({
          agreedLastWorkingDay: newLastWorkingDay,
          lastWorkingDayAdjustedAt: new Date(),
          lastWorkingDayAdjustedById: adjustedById,
          updatedAt: new Date(),
        })
        .where(eq(resignations.id, id))
        .returning();

      return toRecord(updated);
    });
  }

  /**
   * Every accepted resignation whose agreed last working day has arrived and
   * has not been fully processed — the cron sweep's query. Indexed by
   * `(org_id, agreed_last_working_day)` for exactly this lookup; see the
   * index comment in hrms.ts for what this replaces.
   */
  async listDueForExit(limit = 100): Promise<ResignationRecord[]> {
    const today = todayKey();
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(resignations)
        .where(
          and(
            eq(resignations.status, "accepted"),
            isNull(resignations.exitProcessedAt),
            lte(resignations.agreedLastWorkingDay, today)
          )
        )
        .orderBy(asc(resignations.agreedLastWorkingDay))
        .limit(limit);
      return rows.map((row) => toRecord(row));
    });
  }

  /**
   * Everything `offboarding-exit.ts` needs to compute a settlement for this
   * resignation: the employee's join date and notice policy, their salary
   * structure as of the agreed last working day, and their encashable leave
   * balance. Returns null if the resignation or employee cannot be found, so
   * the orchestrator can report "not found" rather than compute against
   * undefined.
   *
   * A plain read, not locked — the lock that actually matters is the one
   * `saveSettlementSnapshot` takes at write time. Locking here too would hold
   * a row lock across the settlement arithmetic for no benefit: the
   * computation is pure and reruns harmlessly if two callers race, and only
   * the write needs to be exclusive.
   */
  async loadSettlementInputs(id: string): Promise<{
    resignation: ResignationRecord;
    inputs: ExitSettlementInputs;
  } | null> {
    return withTenant(this.ctx, async (tx) => {
      const resignationRows = await tx.select().from(resignations).where(eq(resignations.id, id)).limit(1);
      const resignation = resignationRows[0];
      if (!resignation) return null;

      const employeeRows = await tx
        .select()
        .from(employees)
        .where(eq(employees.id, resignation.employeeId))
        .limit(1);
      const employee = employeeRows[0];
      if (!employee) return null;

      // The structure in force on the agreed last working day, so a raise
      // that takes effect after somebody has already left does not
      // retroactively change what they are owed. Ordered by
      // `effectiveFrom DESC` and capped at one row defensively:
      // `payroll.neon.ts`'s equivalent join does not guard against two
      // structures whose date ranges overlap, and this repository should not
      // silently sum both if that ever happens.
      const referenceDate = resignation.agreedLastWorkingDay ?? todayKey();
      const structureRows = await tx
        .select()
        .from(salaryStructures)
        .where(
          and(
            eq(salaryStructures.employeeId, employee.id),
            lte(salaryStructures.effectiveFrom, referenceDate)
          )
        )
        .orderBy(desc(salaryStructures.effectiveFrom))
        .limit(5);

      // Filtered in application code rather than in SQL for the `effectiveTo
      // IS NULL OR effectiveTo >= referenceDate` half of the condition: this
      // repository already has to re-sort defensively (see above), so the one
      // extra pass over at most 5 rows costs nothing and keeps the query
      // itself simple enough to read in one glance.
      const structure = structureRows.find(
        (s) => !s.effectiveTo || s.effectiveTo >= referenceDate
      );

      const monthlyBasicPay = structure ? minorToMajor(structure.basicMinor) : 0;
      const monthlyGrossPay = structure
        ? minorToMajor(
            structure.basicMinor +
              structure.hraMinor +
              structure.conveyanceMinor +
              structure.medicalMinor +
              structure.ltaMinor +
              structure.specialAllowanceMinor +
              structure.otherAllowancesMinor
          )
        : 0;

      // Encashable leave: every balance row for the year the last working
      // day falls in, restricted to leave types the org's policy actually
      // allows encashing. A leave type with no policy row at all is treated
      // as not encashable rather than defaulting open, the same
      // fail-closed choice `isEncashable`'s own default makes.
      const year = Number(referenceDate.slice(0, 4));
      const leaveRows = await tx
        .select({
          openingDays: leaveBalances.openingDays,
          accruedDays: leaveBalances.accruedDays,
          carryForwardDays: leaveBalances.carryForwardDays,
          usedDays: leaveBalances.usedDays,
          pendingDays: leaveBalances.pendingDays,
          lapsedDays: leaveBalances.lapsedDays,
          encashedDays: leaveBalances.encashedDays,
        })
        .from(leaveBalances)
        .innerJoin(
          leavePolicies,
          and(eq(leavePolicies.leaveType, leaveBalances.leaveType), eq(leavePolicies.orgId, leaveBalances.orgId))
        )
        .where(
          and(
            eq(leaveBalances.employeeId, employee.id),
            eq(leaveBalances.year, year),
            eq(leavePolicies.isEncashable, true)
          )
        );

      const encashableLeaveDays = leaveRows.reduce(
        (sum, row) =>
          sum +
          availableDays({
            openingDays: Number(row.openingDays),
            accruedDays: Number(row.accruedDays),
            carryForwardDays: Number(row.carryForwardDays),
            usedDays: Number(row.usedDays),
            pendingDays: Number(row.pendingDays),
            lapsedDays: Number(row.lapsedDays),
            encashedDays: Number(row.encashedDays),
          }),
        0
      );

      return {
        resignation: toRecord(resignation),
        inputs: {
          joinDate: employee.joinDate,
          noticePeriodDays: employee.noticePeriodDays ?? DEFAULT_NOTICE_PERIOD_DAYS,
          monthlyBasicPay,
          monthlyGrossPay,
          encashableLeaveDays,
          employmentType: employee.employmentType,
          workEmail: employee.workEmail,
        },
      };
    });
  }

  /**
   * Freezes the settlement — write-once, under a lock, so two concurrent
   * exit-processing runs (a retried request racing the cron sweep, say)
   * cannot both compute a figure and both write. The first to take the lock
   * writes; the second sees the snapshot already present and returns it
   * unchanged rather than overwriting a number that may already be on a
   * payslip.
   */
  async saveSettlementSnapshot(id: string, snapshot: SettlementComponents): Promise<ResignationRecord> {
    return withTenant(this.ctx, async (tx) => {
      const locked = await tx
        .select()
        .from(resignations)
        .where(eq(resignations.id, id))
        .for("update")
        .limit(1);

      const resignation = locked[0];
      if (!resignation) throw new NotFoundError("Resignation", id);
      if (resignation.settlementSnapshot != null) return toRecord(resignation);

      const [updated] = await tx
        .update(resignations)
        .set({ settlementSnapshot: snapshot, updatedAt: new Date() })
        .where(eq(resignations.id, id))
        .returning();

      return toRecord(updated);
    });
  }

  /**
   * Records a document as issued — write-once per column via a `CASE WHEN
   * col IS NULL` set, the same idiom `directory-group-outbox.ts` uses to keep
   * a succeeded row succeeded. Only columns present in `patch` are touched,
   * and a column already holding an id is never overwritten, so calling this
   * twice for the same kind (a retried request after `dispatchLifecycleDocuments`
   * partially failed) cannot record a second document over the first.
   */
  async saveDocumentIds(
    id: string,
    patch: {
      relievingLetterDocumentId?: string;
      experienceCertificateDocumentId?: string;
      internshipCompletionDocumentId?: string;
    }
  ): Promise<ResignationRecord> {
    return withTenant(this.ctx, async (tx) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      // `CASE WHEN <col> IS NULL THEN <value> ELSE <col> END` — the same
      // write-once idiom directory-group-outbox.ts uses to keep a succeeded
      // row succeeded: a column that already holds a document id is never
      // overwritten, so a retried dispatch cannot record a second document
      // over the first.
      if (patch.relievingLetterDocumentId !== undefined) {
        const col = resignations.relievingLetterDocumentId;
        set.relievingLetterDocumentId = sql`CASE WHEN ${col} IS NULL THEN ${patch.relievingLetterDocumentId} ELSE ${col} END`;
      }
      if (patch.experienceCertificateDocumentId !== undefined) {
        const col = resignations.experienceCertificateDocumentId;
        set.experienceCertificateDocumentId = sql`CASE WHEN ${col} IS NULL THEN ${patch.experienceCertificateDocumentId} ELSE ${col} END`;
      }
      if (patch.internshipCompletionDocumentId !== undefined) {
        const col = resignations.internshipCompletionDocumentId;
        set.internshipCompletionDocumentId = sql`CASE WHEN ${col} IS NULL THEN ${patch.internshipCompletionDocumentId} ELSE ${col} END`;
      }

      const [updated] = await tx
        .update(resignations)
        .set(set)
        .where(eq(resignations.id, id))
        .returning();

      if (!updated) throw new NotFoundError("Resignation", id);
      return toRecord(updated);
    });
  }

  /**
   * Marks a resignation fully processed — only if it is not already, so
   * calling this twice (the exact "running exit twice" case the task asks
   * for) is a no-op the second time rather than a fresh timestamp. The
   * `WHERE exit_processed_at IS NULL` is what makes the write itself
   * atomic-and-idempotent without a separate lock: at most one call can ever
   * match that row and actually update it.
   */
  async markExitProcessed(id: string): Promise<ResignationRecord> {
    return withTenant(this.ctx, async (tx) => {
      const [updated] = await tx
        .update(resignations)
        .set({ exitProcessedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(resignations.id, id), isNull(resignations.exitProcessedAt)))
        .returning();

      if (updated) return toRecord(updated);

      const existingRows = await tx.select().from(resignations).where(eq(resignations.id, id)).limit(1);
      const existing = existingRows[0];
      if (!existing) throw new NotFoundError("Resignation", id);
      return toRecord(existing);
    });
  }
}
