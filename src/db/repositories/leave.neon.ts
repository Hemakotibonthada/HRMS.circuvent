// ═══════════════════════════════════════════════════════════════
// LEAVE REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// The interesting part is not the CRUD but the balance arithmetic, which the
// Firestore version could not do safely.
//
// Applying for leave has to read the balance, check it, write the request and
// reserve the days as one atomic step. In Firestore those were separate client
// round-trips, so two requests submitted at once could both see the same
// balance and both succeed — overdrawing it. Here it is a single transaction
// with a row lock, so the second waits and then fails correctly.
//
// Balances track `pending` separately from `used`: days are reserved on apply
// and only converted to used on approval. Without that, an employee could
// stack overlapping requests that individually fit the balance.

import { and, asc, count, desc, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import {
  employees,
  leaveBalances,
  leavePolicies,
  leaveRequests,
} from "@/db/schema/hrms";
import {
  NotFoundError,
  RepositoryError,
  type LeaveApply,
  type LeaveBalanceRecord,
  type LeaveRepository,
  type LeaveRequestRecord,
  type ListQuery,
  type Page,
  type Unsubscribe,
} from "./types";

const SORTABLE = {
  startDate: leaveRequests.startDate,
  appliedAt: leaveRequests.appliedAt,
  status: leaveRequests.status,
  totalDays: leaveRequests.totalDays,
} as const;

type Row = typeof leaveRequests.$inferSelect & { employeeName?: string | null };

function toRecord(row: Row): LeaveRequestRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: row.employeeName ?? undefined,
    leaveType: row.leaveType,
    startDate: row.startDate,
    endDate: row.endDate,
    totalDays: Number(row.totalDays),
    isHalfDay: row.isHalfDay,
    halfDayPeriod: row.halfDayPeriod ?? undefined,
    reason: row.reason,
    status: row.status,
    appliedAt: row.appliedAt.toISOString(),
    approvedById: row.approvedById ?? undefined,
    approvedAt: row.approvedAt?.toISOString(),
    rejectionReason: row.rejectionReason ?? undefined,
    handoverToId: row.handoverToId ?? undefined,
    organizationId: row.orgId,
  };
}

/**
 * Calendar days between two dates, inclusive.
 *
 * Deliberately not working-day aware: weekends and holidays vary per location
 * and are applied by the leave policy, not by date arithmetic. Half days count
 * as 0.5 regardless of span.
 */
export function countLeaveDays(startDate: string, endDate: string, isHalfDay: boolean): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new RepositoryError("Invalid leave dates", 400);
  }
  if (end < start) throw new RepositoryError("End date is before start date", 400);

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (isHalfDay) {
    // A half day only makes sense on a single date.
    if (days !== 1) throw new RepositoryError("A half day must be a single date", 400);
    return 0.5;
  }
  return days;
}

/**
 * What the year granted, before anything was taken off it.
 *
 * Kept beside `availableFrom` and expressed in the same terms, because the two
 * are shown together as "available of entitled" — computing them apart is how
 * a screen ends up claiming someone has more days left than they were ever
 * given.
 */
function entitledFrom(row: typeof leaveBalances.$inferSelect): number {
  return Number(row.openingDays) + Number(row.accruedDays) + Number(row.carryForwardDays);
}

function availableFrom(row: typeof leaveBalances.$inferSelect): number {
  return (
    entitledFrom(row) - Number(row.usedDays) - Number(row.pendingDays) - Number(row.lapsedDays)
  );
}

export class NeonLeaveRepository implements LeaveRepository {
  constructor(private readonly ctx: TenantContext) {}

  async list(q: ListQuery = {}): Promise<Page<LeaveRequestRecord>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, q.pageSize ?? 50));

    const conditions: SQL[] = [];
    const filters = q.filters ?? {};
    if (filters.status && filters.status !== "all") {
      conditions.push(eq(leaveRequests.status, filters.status as never));
    }
    if (filters.employeeId) {
      conditions.push(eq(leaveRequests.employeeId, filters.employeeId as string));
    }
    if (filters.leaveType && filters.leaveType !== "all") {
      conditions.push(eq(leaveRequests.leaveType, filters.leaveType as never));
    }
    if (filters.from) conditions.push(gte(leaveRequests.startDate, filters.from as string));
    if (filters.to) conditions.push(lte(leaveRequests.endDate, filters.to as string));

    const sortColumn = SORTABLE[(q.sortBy ?? "appliedAt") as keyof typeof SORTABLE];
    if (!sortColumn) throw new RepositoryError(`Cannot sort leave by ${q.sortBy}`, 400);
    const direction = q.sortDirection === "asc" ? asc : desc;

    return withTenant(this.ctx, async (tx) => {
      const where = conditions.length ? and(...conditions) : undefined;

      const rows = await tx
        .select({
          request: leaveRequests,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(leaveRequests)
        .leftJoin(employees, eq(employees.id, leaveRequests.employeeId))
        .where(where)
        .orderBy(direction(sortColumn), asc(leaveRequests.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(leaveRequests)
        .where(where);

      const items = rows.map((r) =>
        toRecord({
          ...r.request,
          employeeName: [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
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

  async getById(id: string): Promise<LeaveRequestRecord | null> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
      return rows[0] ? toRecord(rows[0]) : null;
    });
  }

  create(data: LeaveApply): Promise<LeaveRequestRecord> {
    return this.apply(data);
  }

  /**
   * Applies for leave.
   *
   * Everything happens in one transaction: overlap check, balance lock,
   * sufficiency check, insert, reserve. Splitting these was what allowed two
   * concurrent applications to overdraw the same balance.
   */
  async apply(data: LeaveApply): Promise<LeaveRequestRecord> {
    const totalDays = countLeaveDays(data.startDate, data.endDate, data.isHalfDay ?? false);
    const year = new Date(`${data.startDate}T00:00:00Z`).getUTCFullYear();

    return withTenant(this.ctx, async (tx) => {
      const overlapping = await tx
        .select({ id: leaveRequests.id })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.employeeId, data.employeeId),
            inArray(leaveRequests.status, ["pending", "approved"]),
            // Two ranges overlap when each starts before the other ends.
            lte(leaveRequests.startDate, data.endDate),
            gte(leaveRequests.endDate, data.startDate)
          )
        )
        .limit(1);

      if (overlapping.length > 0) {
        throw new RepositoryError("You already have leave booked over these dates", 409);
      }

      const policy = await tx
        .select()
        .from(leavePolicies)
        .where(
          and(
            eq(leavePolicies.leaveType, data.leaveType as never),
            eq(leavePolicies.isActive, true)
          )
        )
        .limit(1);

      if (policy[0]?.maxConsecutiveDays && totalDays > policy[0].maxConsecutiveDays) {
        throw new RepositoryError(
          `${policy[0].label} is limited to ${policy[0].maxConsecutiveDays} consecutive days`,
          400
        );
      }

      // Unpaid leave has no balance to draw down, so the check is skipped
      // rather than failing against a balance row that will never exist.
      const isPaid = policy[0] ? policy[0].isPaid : true;

      if (isPaid) {
        // FOR UPDATE serialises concurrent applications for the same employee
        // and leave type; without it both would read the same balance.
        const locked = await tx
          .select()
          .from(leaveBalances)
          .where(
            and(
              eq(leaveBalances.employeeId, data.employeeId),
              eq(leaveBalances.year, year),
              eq(leaveBalances.leaveType, data.leaveType as never)
            )
          )
          .for("update")
          .limit(1);

        const balance = locked[0];
        if (!balance) {
          throw new RepositoryError(
            `No ${data.leaveType} balance exists for ${year}`,
            409
          );
        }

        const available = availableFrom(balance);
        if (available < totalDays) {
          throw new RepositoryError(
            `Insufficient balance: ${available} day(s) available, ${totalDays} requested`,
            409
          );
        }

        // Reserved as pending, not used. Converting on approval is what stops
        // an employee stacking overlapping requests that each fit the balance.
        await tx
          .update(leaveBalances)
          .set({
            pendingDays: sql`${leaveBalances.pendingDays} + ${totalDays}`,
            updatedAt: new Date(),
          })
          .where(eq(leaveBalances.id, balance.id));
      }

      const [row] = await tx
        .insert(leaveRequests)
        .values({
          orgId: this.ctx.orgId,
          employeeId: data.employeeId,
          leaveType: data.leaveType as never,
          startDate: data.startDate,
          endDate: data.endDate,
          totalDays: String(totalDays),
          isHalfDay: data.isHalfDay ?? false,
          halfDayPeriod: data.halfDayPeriod,
          reason: data.reason,
          handoverToId: data.handoverToId,
          contactDuringLeave: data.contactDuringLeave,
        })
        .returning();

      return toRecord(row);
    });
  }

  async approve(id: string, approverId: string): Promise<LeaveRequestRecord> {
    return this.transition(id, "approved", approverId);
  }

  async reject(id: string, approverId: string, reason: string): Promise<LeaveRequestRecord> {
    return this.transition(id, "rejected", approverId, reason);
  }

  async cancel(id: string, reason: string): Promise<LeaveRequestRecord> {
    return this.transition(id, "cancelled", undefined, reason);
  }

  /**
   * Moves a request to a terminal state and settles the balance.
   *
   *   approved   pending → used
   *   rejected   pending released
   *   cancelled  pending released, or used released if already approved
   *
   * Only pending requests can be approved or rejected. Re-approving would
   * deduct the days a second time, which is exactly the kind of double-count
   * an idempotency check has to prevent.
   */
  private async transition(
    id: string,
    next: "approved" | "rejected" | "cancelled",
    actorId?: string,
    reason?: string
  ): Promise<LeaveRequestRecord> {
    return withTenant(this.ctx, async (tx) => {
      const locked = await tx
        .select()
        .from(leaveRequests)
        .where(eq(leaveRequests.id, id))
        .for("update")
        .limit(1);

      const request = locked[0];
      if (!request) throw new NotFoundError("Leave request", id);

      if (next !== "cancelled" && request.status !== "pending") {
        throw new RepositoryError(
          `This request is already ${request.status} and cannot be ${next}`,
          409
        );
      }
      if (next === "cancelled" && request.status === "cancelled") {
        throw new RepositoryError("This request is already cancelled", 409);
      }
      if (next === "cancelled" && request.status === "rejected") {
        throw new RepositoryError("A rejected request cannot be cancelled", 409);
      }

      const days = Number(request.totalDays);
      const year = new Date(`${request.startDate}T00:00:00Z`).getUTCFullYear();
      const wasApproved = request.status === "approved";

      const balance = await tx
        .select()
        .from(leaveBalances)
        .where(
          and(
            eq(leaveBalances.employeeId, request.employeeId),
            eq(leaveBalances.year, year),
            eq(leaveBalances.leaveType, request.leaveType)
          )
        )
        .for("update")
        .limit(1);

      if (balance[0]) {
        const id_ = balance[0].id;
        if (next === "approved") {
          await tx
            .update(leaveBalances)
            .set({
              pendingDays: sql`greatest(0, ${leaveBalances.pendingDays} - ${days})`,
              usedDays: sql`${leaveBalances.usedDays} + ${days}`,
              updatedAt: new Date(),
            })
            .where(eq(leaveBalances.id, id_));
        } else if (wasApproved) {
          // Cancelling an approved request returns days from used.
          await tx
            .update(leaveBalances)
            .set({
              usedDays: sql`greatest(0, ${leaveBalances.usedDays} - ${days})`,
              updatedAt: new Date(),
            })
            .where(eq(leaveBalances.id, id_));
        } else {
          await tx
            .update(leaveBalances)
            .set({
              pendingDays: sql`greatest(0, ${leaveBalances.pendingDays} - ${days})`,
              updatedAt: new Date(),
            })
            .where(eq(leaveBalances.id, id_));
        }
      }

      const [row] = await tx
        .update(leaveRequests)
        .set({
          status: next,
          approvedById: actorId,
          approvedAt: next === "approved" ? new Date() : undefined,
          rejectionReason: next === "rejected" ? reason : undefined,
          cancellationReason: next === "cancelled" ? reason : undefined,
          updatedAt: new Date(),
        })
        .where(eq(leaveRequests.id, id))
        .returning();

      return toRecord(row);
    });
  }

  async update(id: string, data: Partial<LeaveApply>): Promise<LeaveRequestRecord> {
    return withTenant(this.ctx, async (tx) => {
      const current = await tx
        .select({ status: leaveRequests.status })
        .from(leaveRequests)
        .where(eq(leaveRequests.id, id))
        .limit(1);

      if (!current[0]) throw new NotFoundError("Leave request", id);
      // Editing an approved request would change the days already deducted
      // from the balance without re-running the check.
      if (current[0].status !== "pending") {
        throw new RepositoryError("Only a pending request can be edited", 409);
      }

      const [row] = await tx
        .update(leaveRequests)
        .set({
          ...(data.reason !== undefined ? { reason: data.reason } : {}),
          ...(data.handoverToId !== undefined ? { handoverToId: data.handoverToId } : {}),
          ...(data.contactDuringLeave !== undefined
            ? { contactDuringLeave: data.contactDuringLeave }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(leaveRequests.id, id))
        .returning();

      return toRecord(row);
    });
  }

  async remove(id: string): Promise<void> {
    // Leave history is evidence for payroll and statutory records, so requests
    // are cancelled rather than deleted.
    await this.cancel(id, "Withdrawn");
  }

  subscribe(): Unsubscribe {
    throw new RepositoryError(
      "NeonLeaveRepository does not support subscribe(); use the HTTP repository on the client",
      501
    );
  }

  async balances(employeeId: string, year: number): Promise<LeaveBalanceRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(leaveBalances)
        .where(and(eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.year, year)))
        .orderBy(asc(leaveBalances.leaveType));

      return rows.map((r) => ({
        employeeId: r.employeeId,
        year: r.year,
        leaveType: r.leaveType,
        opening: Number(r.openingDays),
        accrued: Number(r.accruedDays),
        used: Number(r.usedDays),
        pending: Number(r.pendingDays),
        carryForward: Number(r.carryForwardDays),
        lapsed: Number(r.lapsedDays),
        entitled: entitledFrom(r),
        available: availableFrom(r),
      }));
    });
  }

  async pendingFor(managerId: string): Promise<LeaveRequestRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({
          request: leaveRequests,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(leaveRequests)
        .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
        .where(
          and(
            eq(leaveRequests.status, "pending"),
            eq(employees.reportingToId, managerId),
            // A manager approving their own leave defeats the control.
            ne(leaveRequests.employeeId, managerId)
          )
        )
        .orderBy(asc(leaveRequests.startDate));

      return rows.map((r) =>
        toRecord({
          ...r.request,
          employeeName: [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
        })
      );
    });
  }

  /** Requests overlapping a date range, for the team leave calendar. */
  async onLeaveBetween(from: string, to: string): Promise<LeaveRequestRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.status, "approved"),
            // Overlap, not containment: someone whose leave spans the whole
            // window would be missed by a start-within-range test.
            lte(leaveRequests.startDate, to),
            gte(leaveRequests.endDate, from)
          )
        )
        .orderBy(asc(leaveRequests.startDate));

      return rows.map(toRecord);
    });
  }
}
