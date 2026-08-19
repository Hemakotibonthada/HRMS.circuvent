// ═══════════════════════════════════════════════════════════════
// EMPLOYEE REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Runs inside API routes and background workers. It never reaches the browser:
// Postgres credentials must not, and a TCP connection could not. Client code
// uses HttpEmployeeRepository, which calls the routes that wrap this.
//
// Every method executes inside withTenant(), so row-level security is active
// for the whole statement. Searching, sorting and pagination happen in SQL
// rather than by reading the tenant's entire collection into memory as the
// Firestore path must.

import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import {
  departments,
  employees,
  leaveBalances,
  leavePolicies,
} from "@/db/schema/hrms";
import {
  drainDueGroupJoins,
  queueGroupJoins,
} from "@/lib/directory-group-outbox";
import {
  autoJoinAddresses,
  resolveGroupDomain,
  shouldAutoJoin,
} from "@/lib/onboarding-groups";
import {
  DEFAULT_LEAVE_POLICIES,
  provisionFor,
  type LeavePolicy,
} from "@/lib/leave-provisioning";
import {
  queueAndAttemptPaystubEmployeeSync,
  queuePaystubEmployeeSync,
} from "@/lib/paystub-sync-outbox";
import {
  NotFoundError,
  RepositoryError,
  type EmployeeCreate,
  type EmployeeRecord,
  type EmployeeRepository,
  type EmployeeUpdate,
  type ListQuery,
  type Page,
  type Unsubscribe,
} from "./types";

/** Columns a caller may sort by. Anything else is rejected. */
const SORTABLE = {
  fullName: employees.firstName,
  email: employees.workEmail,
  designation: employees.designation,
  joinDate: employees.joinDate,
  status: employees.status,
  employeeCode: employees.employeeCode,
  createdAt: employees.createdAt,
} as const;

type SortableField = keyof typeof SORTABLE;

/** Filters a caller may apply, mapped to real columns. */
const FILTERABLE = {
  status: employees.status,
  departmentId: employees.departmentId,
  employmentType: employees.employmentType,
  locationId: employees.locationId,
} as const;

/**
 * Salary is stored in minor units (paise) as bigint so payroll arithmetic is
 * exact; the UI works in major units.
 */
function toMajor(minor: bigint | null): number | undefined {
  return minor === null ? undefined : Number(minor) / 100;
}

function toMinor(major: number | undefined): bigint | undefined {
  return major === undefined ? undefined : BigInt(Math.round(major * 100));
}

type Row = typeof employees.$inferSelect & { departmentName?: string | null };

function toRecord(row: Row): EmployeeRecord {
  return {
    id: row.id,
    employeeCode: row.employeeCode,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
    email: row.workEmail,
    phone: row.phone ?? undefined,
    avatarUrl: row.avatarUrl ?? undefined,
    departmentId: row.departmentId ?? undefined,
    departmentName: row.departmentName ?? undefined,
    designation: row.designation,
    reportingToId: row.reportingToId ?? undefined,
    employmentType: row.employmentType,
    status: row.status,
    joinDate: row.joinDate,
    exitDate: row.exitDate ?? undefined,
    salary: toMajor(row.ctcMinor),
    currency: row.currency,
    organizationId: row.orgId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class NeonEmployeeRepository implements EmployeeRepository {
  constructor(private readonly ctx: TenantContext) {}

  async list(q: ListQuery = {}): Promise<Page<EmployeeRecord>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, q.pageSize ?? 50));

    const conditions = [isNull(employees.deletedAt)];

    if (q.search?.trim()) {
      const needle = `%${q.search.trim()}%`;
      conditions.push(
        or(
          ilike(employees.firstName, needle),
          ilike(employees.lastName, needle),
          ilike(employees.workEmail, needle),
          ilike(employees.designation, needle),
          ilike(employees.employeeCode, needle),
        )!,
      );
    }

    for (const [field, value] of Object.entries(q.filters ?? {})) {
      if (
        value === undefined ||
        value === null ||
        value === "" ||
        value === "all"
      )
        continue;
      const column = FILTERABLE[field as keyof typeof FILTERABLE];
      // Ignoring an unknown filter would silently widen the result set, so it
      // is an error instead.
      if (!column)
        throw new RepositoryError(`Unknown employee filter: ${field}`, 400);
      conditions.push(eq(column, value as never));
    }

    const sortField = (q.sortBy ?? "fullName") as SortableField;
    const sortColumn = SORTABLE[sortField];
    if (!sortColumn)
      throw new RepositoryError(`Cannot sort employees by ${q.sortBy}`, 400);
    const direction = q.sortDirection === "desc" ? desc : asc;

    return withTenant(this.ctx, async (tx) => {
      const where = and(...conditions);

      const rows = await tx
        .select({
          employee: employees,
          departmentName: departments.name,
        })
        .from(employees)
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(where)
        .orderBy(direction(sortColumn), asc(employees.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(employees)
        .where(where);

      const items = rows.map((r) =>
        toRecord({ ...r.employee, departmentName: r.departmentName }),
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

  async getById(id: string): Promise<EmployeeRecord | null> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({ employee: employees, departmentName: departments.name })
        .from(employees)
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
        .limit(1);

      if (rows.length === 0) return null;
      return toRecord({
        ...rows[0].employee,
        departmentName: rows[0].departmentName,
      });
    });
  }

  async create(data: EmployeeCreate): Promise<EmployeeRecord> {
    const row = await withTenant(this.ctx, async (tx) => {
      // The code comes from `hrms.next_employee_code` — see migration 0030.
      //
      // It used to be `CIR-${count + 1}`, which is wrong in a way that only
      // shows up later: `count` skips anybody soft-deleted, so the first
      // departure makes the next hire collide with a code already issued. The
      // function takes the maximum over every row, including deleted ones, and
      // holds a transaction-scoped advisory lock so two concurrent hires cannot
      // read the same number.
      const code =
        data.employeeCode ??
        (await (async () => {
          const result = await tx.execute(
            sql`SELECT hrms.next_employee_code(${this.ctx.orgId}::uuid) AS code`,
          );
          const next = (result.rows[0] as { code?: string } | undefined)?.code;
          if (!next) {
            throw new Error(
              "hrms.next_employee_code returned nothing; migration 0030 may not be applied",
            );
          }
          return next;
        })());

      const [row] = await tx
        .insert(employees)
        .values({
          orgId: this.ctx.orgId,
          employeeCode: code,
          firstName: data.firstName,
          lastName: data.lastName,
          workEmail: data.email,
          phone: data.phone,
          departmentId: data.departmentId,
          designation: data.designation,
          reportingToId: data.reportingToId,
          employmentType: (data.employmentType ?? "full_time") as never,
          status: (data.status ?? "active") as never,
          joinDate: data.joinDate,
          ctcMinor: toMinor(data.salary),
        })
        .returning();

      // Leave balances, in the same transaction as the hire.
      //
      // Nothing in this product ever wrote a balance row: the table existed,
      // `/api/leave/balances` had a GET and no POST, and no repository
      // inserted one. Every leave application from every employee was refused
      // with "No <type> balance exists for <year>", so the leave module — apply
      // form, approvals queue, balances page and all — could not process a
      // single request.
      //
      // Provisioned here rather than in a nightly job because the failure it
      // fixes is immediate: somebody hired this morning applies for leave this
      // afternoon. Inside the transaction because an employee who exists
      // without balances is exactly the broken state being repaired.
      await this.provisionLeave(tx, row.id, data.joinDate);

      // Standard access, queued in the same transaction as the hire.
      //
      // Membership of all@<domain> is what grants an ordinary employee their
      // access across the suite and puts them on the all-staff address.
      // Groups live at the identity provider, not here — see the header of
      // `directory-sdk.ts` — so this records the durable intent and the HTTP
      // call happens after the transaction commits. A hire must not fail
      // because auth.circuvent.com is unreachable, and a network round trip
      // inside a transaction holds a connection open for as long as somebody
      // else's server takes to answer.
      await this.provisionGroups(tx, row.id, data.email, data.status);

      await queuePaystubEmployeeSync(tx, this.ctx.orgId, row.id);
      return row;
    });

    void queueAndAttemptPaystubEmployeeSync(this.ctx, row.id).catch(
      (error: unknown) => {
        console.warn(
          "[paystub-sync] Could not run the immediate employee push attempt.",
          {
            orgId: this.ctx.orgId,
            employeeId: row.id,
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
        );
      },
    );

    // The common case, attempted immediately so a hire made at 9am is in the
    // group by 9am. Failure here is not an error: the outbox row survives and
    // the scheduled sweep re-drives it.
    void drainDueGroupJoins(this.ctx).catch((error: unknown) => {
      console.warn("[groups] Could not run the immediate group join attempt.", {
        orgId: this.ctx.orgId,
        employeeId: row.id,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    });

    return toRecord(row);
  }

  /**
   * Queues the new hire's membership of the groups that grant standard access.
   *
   * Deliberately tolerant, exactly as `provisionLeave` is: a hire must not
   * fail because group provisioning did. A missing membership is recoverable
   * by re-running it; a failed hire halfway through an onboarding flow is not.
   */
  private async provisionGroups(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    employeeId: string,
    email: string,
    status: string | undefined,
  ): Promise<void> {
    try {
      if (!shouldAutoJoin({ email, status })) return;

      // The hire's own work address decides the domain, so a company whose
      // mail is on a different domain from its website still gets the right
      // group. Falls back to the configured default when it cannot be read.
      const domain = resolveGroupDomain(email);

      // A SAVEPOINT, not a bare call, and this is what makes the try/catch
      // around it mean anything.
      //
      // Postgres aborts the *whole* transaction on any error inside it: catching
      // the exception in application code leaves the connection in a failed
      // state, and every statement after it — the Paystub sync queue, the
      // commit itself — fails with "current transaction is aborted". So a
      // tolerant catch around a raw insert is not tolerant at all; it converts
      // "group provisioning failed" into "the hire failed", which is precisely
      // the outcome the catch was written to prevent.
      //
      // `tx.transaction()` issues a SAVEPOINT, so a failure here rolls back to
      // this point and the outer transaction carries on. It matters today:
      // until migration 0033 is applied the outbox table does not exist, and
      // without this every hire would fail.
      await tx.transaction(async (sp) => {
        await queueGroupJoins(sp, {
          orgId: this.ctx.orgId,
          employeeId,
          memberEmail: email,
          groupAddresses: autoJoinAddresses(domain),
        });
      });
    } catch (error) {
      console.warn(
        "[groups] Could not queue the new employee's group membership; the hire itself is unaffected.",
        {
          orgId: this.ctx.orgId,
          employeeId,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * Materialises this year's leave balances for a new employee.
   *
   * Uses the organisation's own policies where it has set any, and the default
   * set otherwise — a tenant that has just registered has no policies, and
   * provisioning nothing would leave the same hole this closes.
   *
   * Deliberately tolerant: a hire must not fail because leave provisioning did.
   * A missing balance is recoverable by re-provisioning; a failed hire in the
   * middle of an onboarding flow is not.
   *
   * Wrapped in a SAVEPOINT for that tolerance to be real. Postgres aborts the
   * whole transaction on any error inside it, so catching the exception in
   * application code without one leaves the connection failed and every later
   * statement — the group queue, the Paystub sync, the commit — failing with
   * "current transaction is aborted". The catch would then have converted
   * "leave provisioning failed" into "the hire failed", which is the outcome
   * it exists to prevent.
   */
  private async provisionLeave(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    employeeId: string,
    joinDate: string,
  ): Promise<void> {
    try {
      await tx.transaction(async (sp) => {
        const configured = await sp
          .select({
            leaveType: leavePolicies.leaveType,
            label: leavePolicies.label,
            annualQuotaDays: leavePolicies.annualQuotaDays,
            isProRata: leavePolicies.isProRata,
            carryForwardLimitDays: leavePolicies.carryForwardLimitDays,
            isActive: leavePolicies.isActive,
          })
          .from(leavePolicies)
          .where(eq(leavePolicies.isActive, true));

        const policies: LeavePolicy[] =
          configured.length > 0
            ? configured.map((p) => ({
                leaveType: p.leaveType as LeavePolicy["leaveType"],
                label: p.label,
                annualQuotaDays: Number(p.annualQuotaDays),
                isProRata: p.isProRata,
                carryForwardLimitDays: Number(p.carryForwardLimitDays ?? 0),
              }))
            : [...DEFAULT_LEAVE_POLICIES];

        // The year the person joins, not the calendar year here: a December hire
        // recorded against next year gets a balance they cannot use yet.
        const year = Number(joinDate.slice(0, 4)) || new Date().getFullYear();

        const balances = provisionFor({ policies, joinDate, year });
        if (balances.length === 0) return;

        await sp
          .insert(leaveBalances)
          .values(
            balances.map((b) => ({
              orgId: this.ctx.orgId,
              employeeId,
              year: b.year,
              leaveType: b.leaveType as never,
              openingDays: String(b.openingDays),
              accruedDays: String(b.accruedDays),
              carryForwardDays: String(b.carryForwardDays),
            })),
          )
          // Re-hiring somebody, or a retry, must not collide.
          .onConflictDoNothing();
      });
    } catch (error) {
      console.error(
        `[employees] Could not provision leave for ${employeeId}:`,
        error,
      );
    }
  }

  async update(id: string, data: EmployeeUpdate): Promise<EmployeeRecord> {
    const row = await withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .update(employees)
        .set({
          ...(data.firstName !== undefined
            ? { firstName: data.firstName }
            : {}),
          ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
          ...(data.email !== undefined ? { workEmail: data.email } : {}),
          ...(data.phone !== undefined ? { phone: data.phone } : {}),
          ...(data.departmentId !== undefined
            ? { departmentId: data.departmentId }
            : {}),
          ...(data.designation !== undefined
            ? { designation: data.designation }
            : {}),
          ...(data.reportingToId !== undefined
            ? { reportingToId: data.reportingToId }
            : {}),
          ...(data.employmentType !== undefined
            ? { employmentType: data.employmentType as never }
            : {}),
          ...(data.status !== undefined
            ? { status: data.status as never }
            : {}),
          ...(data.joinDate !== undefined ? { joinDate: data.joinDate } : {}),
          ...(data.exitDate !== undefined ? { exitDate: data.exitDate } : {}),
          ...(data.salary !== undefined
            ? { ctcMinor: toMinor(data.salary) }
            : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
        .returning();

      if (!row) throw new NotFoundError("Employee", id);
      await queuePaystubEmployeeSync(tx, this.ctx.orgId, row.id);
      return row;
    });

    void queueAndAttemptPaystubEmployeeSync(this.ctx, row.id).catch(
      (error: unknown) => {
        console.warn(
          "[paystub-sync] Could not run the immediate employee push attempt.",
          {
            orgId: this.ctx.orgId,
            employeeId: row.id,
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
        );
      },
    );

    return toRecord(row);
  }

  /**
   * Soft delete. Payroll records, attendance and audit entries reference the
   * employee; a hard delete would either cascade them away or fail on the
   * foreign key.
   */
  async remove(id: string): Promise<void> {
    await withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .update(employees)
        .set({ deletedAt: new Date(), status: "inactive" })
        .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
        .returning({ id: employees.id });

      if (!row) throw new NotFoundError("Employee", id);
    });
  }

  /**
   * Postgres has no browser-facing change feed, so live updates are the HTTP
   * repository's concern (it polls). Server-side callers fetch explicitly.
   */
  subscribe(): Unsubscribe {
    throw new RepositoryError(
      "NeonEmployeeRepository does not support subscribe(); use HttpEmployeeRepository on the client",
      501,
    );
  }

  async listDirectReports(managerId: string): Promise<EmployeeRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({ employee: employees, departmentName: departments.name })
        .from(employees)
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(
          and(
            eq(employees.reportingToId, managerId),
            isNull(employees.deletedAt),
          ),
        )
        .orderBy(asc(employees.firstName));

      return rows.map((r) =>
        toRecord({ ...r.employee, departmentName: r.departmentName }),
      );
    });
  }

  async countByStatus(): Promise<Record<string, number>> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({ status: employees.status, value: count() })
        .from(employees)
        .where(isNull(employees.deletedAt))
        .groupBy(employees.status);

      return Object.fromEntries(rows.map((r) => [r.status, r.value]));
    });
  }

  /**
   * Reporting lines can be cycled by a bad edit (A reports to B reports to A),
   * which makes the org chart recurse forever. This walks the chain in SQL and
   * reports any cycle.
   */
  async findReportingCycles(): Promise<string[][]> {
    return withTenant(this.ctx, async (tx) => {
      const result = await tx.execute(sql`
        WITH RECURSIVE chain AS (
          SELECT id, reporting_to_id, ARRAY[id] AS path, false AS cycle
          FROM hrms.employees
          WHERE deleted_at IS NULL
          UNION ALL
          SELECT e.id, e.reporting_to_id, c.path || e.id, e.id = ANY(c.path)
          FROM hrms.employees e
          JOIN chain c ON e.id = c.reporting_to_id
          WHERE NOT c.cycle AND e.deleted_at IS NULL
        )
        SELECT DISTINCT path FROM chain WHERE cycle
      `);
      return (result.rows as { path: string[] }[]).map((r) => r.path);
    });
  }
}
