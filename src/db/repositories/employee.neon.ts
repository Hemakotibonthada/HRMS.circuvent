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
import { auditLog, organizations, users } from "@/db/schema/identity";
import { queueMailboxChange } from "@/lib/mailbox-outbox";
import { recordJobChanges, type JobChange } from "@/lib/job-history";
import { defaultTeamId } from "@/lib/default-team";
import {
  drainDueGroupJoins,
  drainDueGroupLeaves,
  queueGroupJoins,
  queueGroupLeaves,
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
import { employeeCodePrefixFor, PERMANENT_EMPLOYEE_CODE_PREFIX } from "@/lib/employee-code";
import { companyEmailDomains, normaliseEmailDomains } from "@/lib/employee-rules";
import {
  dispatchLifecycleDocuments,
  type LifecycleDocumentKind,
} from "@/lib/intern-documents";
import { decryptNullable, encryptNullable } from "@/lib/crypto/field-encryption";
import {
  canWriteBankDetails,
  toAuditSnapshot,
  type BankDetailsUpdate,
  type RawEmployeeBankDetails,
} from "@/lib/bank-details-rules";
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
  internshipEndDate: employees.internshipEndDate,
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

function toMinor(major: number | null | undefined): bigint | null | undefined {
  if (major === undefined) return undefined;
  if (major === null) return null;
  return BigInt(Math.round(major * 100));
}

type Row = typeof employees.$inferSelect & { departmentName?: string | null };

function toRecord(row: Row): EmployeeRecord {
  return {
    id: row.id,
    employeeCode: row.employeeCode,
    // Undefined, not null, for both: EmployeeRecord's optional fields are
    // absent for anyone who has never converted, and JSON.stringify drops an
    // `undefined` property but keeps an explicit `null` — the interns UI
    // treats "previousEmployeeCode present" as its "converted" signal, so a
    // stray null here would make every never-converted employee look like
    // one.
    previousEmployeeCode: row.previousEmployeeCode ?? undefined,
    codeChangedAt: row.codeChangedAt ? row.codeChangedAt.toISOString() : undefined,
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
    internshipEndDate: row.internshipEndDate ?? undefined,
    exitDate: row.exitDate ?? undefined,
    exitReason: row.exitReason ?? undefined,
    salary: toMajor(row.ctcMinor),
    currency: row.currency,
    organizationId: row.orgId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The work-email domains this organisation issues staff addresses on,
 * falling back to `companyEmailDomains()` — the `COMPANY_EMAIL_DOMAINS` env
 * var, then the built-in default — when the organisation has not set its own.
 *
 * `companyEmailDomains()` in `lib/employee-rules.ts` is one list for the
 * entire process. That is fine for a single deployment, but this platform is
 * multi-tenant: a second organisation whose staff are not on circuvent.com
 * (or whatever `COMPANY_EMAIL_DOMAINS` names for this deployment) would have
 * every one of their hires refused by `validateEmployeeFields` as a "personal
 * address" — on a domain they simply do not own. Each organisation needs its
 * own answer to "what is a work address here".
 *
 * Stored under `companyEmailDomains` in `identity.organizations.settings` —
 * already a jsonb column with nothing else claiming that key — rather than a
 * new column, so an organisation that has not configured this costs nothing
 * extra to read and the feature needed no migration at all.
 *
 * Never throws: a bad connection or a malformed settings blob is exactly the
 * situation the process-wide fallback exists for, not a reason to turn
 * "add an employee" into a 500 the env-wide default would have avoided.
 */
export async function resolveCompanyEmailDomains(
  ctx: TenantContext,
  env: Record<string, string | undefined> = process.env,
): Promise<readonly string[]> {
  const fallback = companyEmailDomains(env);

  try {
    const [org] = await withTenant(ctx, async (tx) =>
      tx
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, ctx.orgId))
        .limit(1),
    );

    const settings = (org?.settings ?? {}) as { companyEmailDomains?: unknown };
    const configured = Array.isArray(settings.companyEmailDomains)
      ? normaliseEmailDomains(settings.companyEmailDomains as string[])
      : [];

    return configured.length > 0 ? configured : fallback;
  } catch (error) {
    console.warn(
      "[employee] Could not resolve this organisation's own work-email domains; using the process-wide default.",
      {
        orgId: ctx.orgId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
    );
    return fallback;
  }
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
      // The code comes from `hrms.next_employee_code` — see migration 0030,
      // extended by 0040 to take a prefix.
      //
      // It used to be `CIR-${count + 1}`, which is wrong in a way that only
      // shows up later: `count` skips anybody soft-deleted, so the first
      // departure makes the next hire collide with a code already issued. The
      // function takes the maximum over every row, including deleted ones, and
      // holds a transaction-scoped advisory lock so two concurrent hires cannot
      // read the same number.
      //
      // The prefix picks which of the two independent sequences this hire
      // draws from: interns get CVI-, everyone else keeps the CV- sequence
      // this function has always produced. Passing it explicitly rather than
      // relying on the SQL default means an intern hire can never silently
      // fall back to CV- just because this call site forgot to ask.
      const code =
        data.employeeCode ??
        (await (async () => {
          const prefix = employeeCodePrefixFor(data.employmentType);
          const result = await tx.execute(
            sql`SELECT hrms.next_employee_code(${this.ctx.orgId}::uuid, ${prefix}) AS code`,
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
          // Everybody lands in a team. A person attached to no department is
          // around nobody, and "who is away today" and "whose birthday is it"
          // are answered by looking at the people around them — so they opened
          // the Team tab and were told they had no colleagues.
          departmentId: data.departmentId ?? (await defaultTeamId(tx, this.ctx.orgId)),
          designation: data.designation,
          reportingToId: data.reportingToId,
          employmentType: (data.employmentType ?? "full_time") as never,
          status: (data.status ?? "active") as never,
          joinDate: data.joinDate,
          ctcMinor: toMinor(data.salary),
        })
        .returning();

      // If an account already exists for this address in this organisation,
      // link it. Nothing else in the product ever sets `employees.user_id`:
      // only founder registration does, and it gets away with it by creating
      // both rows at once. Every other hire was left unlinked, and an unlinked
      // employee cannot be resolved from a login — which is why attendance,
      // leave, payslips and expenses only ever worked for the founder and for
      // the two accounts the owner-backfill script repaired.
      //
      // Matched on the work email, lower-cased, and only when that account is
      // not already claimed by another employee. Anything ambiguous is left
      // null rather than guessed: attaching the wrong person's employment
      // record to a login is far worse than leaving it unattached.
      const [account] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.orgId, this.ctx.orgId),
            sql`lower(${users.email}) = lower(${data.email})`,
            isNull(users.deletedAt)
          )
        )
        .limit(1);

      if (account) {
        // `employees.user_id` is UNIQUE, so exactly one employee row may hold
        // an account. `remove()` soft-deletes and leaves `user_id` in place,
        // which means a departed employee would keep the account for ever:
        // a re-hire on the same address could not be linked, and the resolver
        // — which ignores deleted rows — would find nobody.
        //
        // So a live employee takes the account, and a departed one gives it
        // up. A live holder is never disturbed: that would be attaching one
        // person's employment record to another's login, which is far worse
        // than leaving this one unlinked.
        const [claimed] = await tx
          .select({ id: employees.id, deletedAt: employees.deletedAt })
          .from(employees)
          .where(eq(employees.userId, account.id))
          .limit(1);

        if (claimed?.deletedAt) {
          await tx
            .update(employees)
            .set({ userId: null })
            .where(eq(employees.id, claimed.id));
        }

        if (!claimed || claimed.deletedAt) {
          await tx.update(employees).set({ userId: account.id }).where(eq(employees.id, row.id));
          row.userId = account.id;
        }
      }

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

    // Every hire gets a joining letter — interns and permanent staff alike —
    // fired after commit for the same reason the group join above is: PDF
    // rendering and the signing-outbox insert this triggers are I/O the hire
    // itself must not wait on or be undone by if either is slow or down.
    void dispatchLifecycleDocuments(
      this.ctx,
      row.id,
      ["joining_letter"],
      this.ctx.userId,
    ).then((outcomes) => {
      for (const outcome of outcomes) {
        if (!outcome.ok) {
          console.warn("[lifecycle-documents] Could not issue the joining letter.", {
            orgId: this.ctx.orgId,
            employeeId: row.id,
            error: outcome.error,
          });
        }
      }
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
      // Read before writing, so the change can be recorded as a transition
      // rather than only a destination. In the same transaction as the update:
      // a history row that survives a rolled-back edit describes a promotion
      // that did not happen.
      const [before] = await tx
        .select({
          designation: employees.designation,
          departmentId: employees.departmentId,
          reportingToId: employees.reportingToId,
          employmentType: employees.employmentType,
        })
        .from(employees)
        .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
        .limit(1);

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
          ...(data.exitReason !== undefined
            ? { exitReason: data.exitReason }
            : {}),
          ...(data.salary !== undefined
            ? { ctcMinor: toMinor(data.salary) }
            : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
        .returning();

      if (!row) throw new NotFoundError("Employee", id);

      // Names alongside ids, so "moved to Engineering" keeps saying that after
      // Engineering is renamed. Looked up only when the id actually changed.
      const nameOfDepartment = async (departmentId: string | null) => {
        if (!departmentId) return null;
        const [d] = await tx
          .select({ name: departments.name })
          .from(departments)
          .where(eq(departments.id, departmentId))
          .limit(1);
        return d?.name ?? null;
      };

      const nameOfEmployee = async (employeeId: string | null) => {
        if (!employeeId) return null;
        const [e] = await tx
          .select({ firstName: employees.firstName, lastName: employees.lastName })
          .from(employees)
          .where(eq(employees.id, employeeId))
          .limit(1);
        return e ? `${e.firstName} ${e.lastName}`.trim() : null;
      };

      if (before) {
        const changes: JobChange[] = [];

        if (before.designation !== row.designation) {
          changes.push({
            field: "designation",
            fromValue: before.designation ?? null,
            toValue: row.designation ?? null,
          });
        }

        if (before.departmentId !== row.departmentId) {
          changes.push({
            field: "department",
            fromValue: await nameOfDepartment(before.departmentId),
            toValue: await nameOfDepartment(row.departmentId),
            fromId: before.departmentId,
            toId: row.departmentId,
          });
        }

        if (before.reportingToId !== row.reportingToId) {
          changes.push({
            field: "manager",
            fromValue: await nameOfEmployee(before.reportingToId),
            toValue: await nameOfEmployee(row.reportingToId),
            fromId: before.reportingToId,
            toId: row.reportingToId,
          });
        }

        if (before.employmentType !== row.employmentType) {
          changes.push({
            field: "employment_type",
            fromValue: before.employmentType ?? null,
            toValue: row.employmentType ?? null,
          });
        }

        await recordJobChanges(
          tx,
          {
            orgId: this.ctx.orgId,
            employeeId: row.id,
            changedById: this.ctx.userId,
          },
          changes
        );
      }

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
   *
   * This is also the one place in the product that ends someone's
   * employment — the employees page has no separate "offboard" action, the
   * delete button is it — so it is where exit paperwork fires: an
   * experience certificate and relieving letter for everyone, plus an
   * internship completion certificate for anyone still `employmentType ===
   * "intern"` at the moment they leave without having converted first (a
   * conversion issues that certificate itself — see convertToPermanent —
   * so an intern who already converted is "full_time" by the time this
   * runs and gets the permanent-staff set, not a duplicate).
   */
  async remove(id: string): Promise<void> {
    const row = await withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .update(employees)
        .set({
          deletedAt: new Date(),
          status: "inactive",
          // A relieving letter and an experience certificate both need a
          // real last working day. COALESCE, not an unconditional
          // overwrite: HR sometimes records the exit date days before
          // actually deactivating the record via `update()`, and that
          // deliberately-chosen date must survive rather than be silently
          // replaced by today just because today is when the row was
          // removed.
          exitDate: sql`coalesce(${employees.exitDate}, current_date)`,
        })
        .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
        .returning();

      if (!row) throw new NotFoundError("Employee", id);
      return row;
    });

    // This delete button is a second, older way somebody's employment ends —
    // the resignation path's own exit processing is the other — and it
    // queued no group removal at all until this line: an employee removed
    // here kept every group membership onboarding ever granted them,
    // indefinitely, since nothing about a soft-deleted row ever gets edited
    // again for a re-drive to piggyback on. Same outbox, same sweep, same
    // "all@<domain>" scope as the auto-join side grants — this can only
    // reliably revoke what onboarding reliably tracked granting; a manual
    // addition to people@ or managers@ leaves no record here to reverse.
    if (row.workEmail) {
      try {
        const domain = resolveGroupDomain(row.workEmail);
        await withTenant(this.ctx, async (tx) => {
          await queueGroupLeaves(tx, {
            orgId: this.ctx.orgId,
            employeeId: row.id,
            memberEmail: row.workEmail,
            groupAddresses: autoJoinAddresses(domain),
          });
        });
      } catch (error) {
        console.warn(
          "[groups] Could not queue group removal on delete; the removal itself is unaffected.",
          {
            orgId: this.ctx.orgId,
            employeeId: row.id,
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
        );
      }
    }

    // The common case, attempted immediately so a deletion made at 9am is out
    // of the group by 9am — mirrors the join side's immediate attempt below
    // `create()`. Failure here is not an error: the outbox row survives with
    // a backoff and the scheduled sweep re-drives it.
    void drainDueGroupLeaves(this.ctx).catch((error: unknown) => {
      console.warn("[groups] Could not run the immediate group leave attempt.", {
        orgId: this.ctx.orgId,
        employeeId: row.id,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    });

    const kinds: LifecycleDocumentKind[] =
      row.employmentType === "intern"
        ? ["internship_completion_certificate", "experience_certificate", "relieving_letter"]
        : ["experience_certificate", "relieving_letter"];

    void dispatchLifecycleDocuments(this.ctx, row.id, kinds, this.ctx.userId).then(
      (outcomes) => {
        for (const outcome of outcomes) {
          if (!outcome.ok) {
            console.warn(`[lifecycle-documents] Could not issue ${outcome.kind} on exit.`, {
              orgId: this.ctx.orgId,
              employeeId: row.id,
              error: outcome.error,
            });
          }
        }
      },
    );
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

  /**
   * Reads one employee's bank and statutory details, decrypted and unmasked.
   *
   * Deliberately not part of the `EmployeeRepository` interface — like
   * payroll and tax, this is a single sensitive sub-resource with its own
   * route and its own authorisation rule (self, or a privileged role that can
   * view but never write), not a field of the general employee record that
   * every list/search/CRUD caller receives. Callers still owe this a mask
   * before it reaches a response body (`toBankDetailsView` in
   * `lib/bank-details-rules.ts`) — this method returns the real account
   * number, the same way `getById` returns the real salary and leaves
   * shaping the response to the route.
   */
  async getBankDetails(employeeId: string): Promise<RawEmployeeBankDetails> {
    return withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .select({
          bankDetails: employees.bankDetails,
          panNumber: employees.panNumber,
          uanNumber: employees.uanNumber,
          pfNumber: employees.pfNumber,
          esiNumber: employees.esiNumber,
        })
        .from(employees)
        .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)));

      if (!row) throw new NotFoundError("Employee", employeeId);

      return {
        bankDetails: row.bankDetails ?? null,
        statutoryIds: {
          panNumber: decryptNullable(row.panNumber),
          uanNumber: row.uanNumber,
          pfNumber: row.pfNumber,
          esiNumber: row.esiNumber,
        },
      };
    });
  }

  /**
   * Replaces one employee's bank and statutory details, audits the change and
   * queues the Paystub sync — the same three things `update()` above does for
   * the rest of the record, kept as a separate method because this data has
   * its own encryption rule (PAN) and its own audit trail, not because the
   * transaction shape differs.
   *
   * Whole-record replacement, not a patch: `BankDetailsUpdate` (see
   * `lib/bank-details-rules.ts`) always carries every field, because the
   * self-service form always submits every field together, so there is no
   * partial-update case where an absent field must be read back as
   * "leave unchanged" versus "clear it".
   */
  async updateBankDetails(
    employeeId: string,
    data: BankDetailsUpdate,
    callerId: string | null,
  ): Promise<RawEmployeeBankDetails> {
    // The route this backs never accepts a target employeeId in its request
    // body at all — it always calls this with the caller's own resolved
    // employee id, passed in as `callerId` too — so this can only ever refuse
    // if some future caller (a script, an admin tool, a route refactored
    // without re-reading this comment) passes a mismatched id. Checked here
    // anyway: `canWriteBankDetails` is the one place this rule is written
    // down, and a rule enforced at only one of its two possible call sites is
    // a rule that quietly stops applying the day someone adds a second one.
    //
    // `callerId` is resolved by the caller (`currentEmployeeId`/
    // `requireCurrentEmployeeId` in lib/current-employee.ts) from
    // `ctx.userId` — the signing-in account, not the employment record — and
    // passed in rather than re-resolved here: re-resolving it opened a second
    // `withTenant` transaction and repeated the same indexed lookup the
    // caller had just run, doubling both for every PUT. `callerId ?? ""`
    // keeps an unresolvable caller (no employee record at all) from ever
    // equalling a real `employees.id`, so the check still fails closed.
    if (!canWriteBankDetails(callerId ?? "", employeeId)) {
      throw new RepositoryError("You can only update your own bank details", 403);
    }

    const after = await withTenant(this.ctx, async (tx) => {
      const [before] = await tx
        .select({
          bankDetails: employees.bankDetails,
          panNumber: employees.panNumber,
          uanNumber: employees.uanNumber,
          pfNumber: employees.pfNumber,
          esiNumber: employees.esiNumber,
        })
        .from(employees)
        .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)));

      if (!before) throw new NotFoundError("Employee", employeeId);

      const beforeRaw: RawEmployeeBankDetails = {
        bankDetails: before.bankDetails ?? null,
        statutoryIds: {
          panNumber: decryptNullable(before.panNumber),
          uanNumber: before.uanNumber,
          pfNumber: before.pfNumber,
          esiNumber: before.esiNumber,
        },
      };

      const [row] = await tx
        .update(employees)
        .set({
          bankDetails: data.bankDetails,
          panNumber: encryptNullable(data.panNumber),
          uanNumber: data.uanNumber,
          pfNumber: data.pfNumber,
          esiNumber: data.esiNumber,
          updatedAt: new Date(),
        })
        .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
        .returning({
          bankDetails: employees.bankDetails,
          panNumber: employees.panNumber,
          uanNumber: employees.uanNumber,
          pfNumber: employees.pfNumber,
          esiNumber: employees.esiNumber,
        });

      // The row existed for the SELECT above, and this UPDATE carries the
      // same id/deletedAt predicate inside the same transaction — its
      // absence here would mean a concurrent hard delete raced this update,
      // which nothing in this repository does (`remove()` only ever soft
      // deletes). Checked anyway rather than trusting that.
      if (!row) throw new NotFoundError("Employee", employeeId);

      const afterRaw: RawEmployeeBankDetails = {
        bankDetails: row.bankDetails ?? null,
        statutoryIds: {
          panNumber: decryptNullable(row.panNumber),
          uanNumber: row.uanNumber,
          pfNumber: row.pfNumber,
          esiNumber: row.esiNumber,
        },
      };

      // Bank details decide where somebody's salary is deposited; a silent
      // change here is exactly the failure identity.audit_log's hash chain
      // exists to make detectable after the fact. `hash` below is a
      // placeholder, not the real value: the column is NOT NULL with no
      // default, so Drizzle's insert type requires something, but
      // `audit_log_chain_hash` (see drizzle/0001_row_level_security.sql)
      // overwrites both `hash` and `previous_hash` unconditionally in a
      // BEFORE INSERT trigger — which runs before the NOT NULL constraint is
      // ever checked — so this placeholder never reaches disk.
      await tx.insert(auditLog).values({
        orgId: this.ctx.orgId,
        actorId: this.ctx.userId ?? null,
        app: "hrms",
        action: "employee.bank_details.updated",
        entityType: "employee",
        entityId: employeeId,
        before: toAuditSnapshot(beforeRaw),
        after: toAuditSnapshot(afterRaw),
        hash: "pending",
      });

      await queuePaystubEmployeeSync(tx, this.ctx.orgId, employeeId);
      return afterRaw;
    });

    void queueAndAttemptPaystubEmployeeSync(this.ctx, employeeId).catch(
      (error: unknown) => {
        console.warn(
          "[paystub-sync] Could not run the immediate employee push attempt.",
          {
            orgId: this.ctx.orgId,
            employeeId,
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
        );
      },
    );

    return after;
  }

  /**
   * Sets or clears the expected end date the interns page counts down and
   * the reminder sweep watches.
   *
   * Its own method rather than a case inside `update()`: `EmployeeUpdate`
   * (types.ts) deliberately does not carry `internshipEndDate`, so an
   * ordinary profile-edit PATCH — fixing a phone number — can never move or
   * clear an internship's end date as a side effect of a request that was
   * about something else entirely.
   */
  async setInternshipEndDate(
    id: string,
    internshipEndDate: string | null,
  ): Promise<EmployeeRecord> {
    const row = await withTenant(this.ctx, async (tx) => {
      const [row] = await tx
        .update(employees)
        .set({ internshipEndDate, updatedAt: new Date() })
        .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
        .returning();

      if (!row) throw new NotFoundError("Employee", id);
      return row;
    });

    return toRecord(row);
  }

  /**
   * Converts an intern to permanent staff at the end of their internship.
   *
   * Draws a brand-new CV- code from the independent permanent sequence —
   * the retired CVI- code is never reused, see `hrms.next_employee_code` —
   * and keeps the old code on the record instead of overwriting it: payslips,
   * signed documents and attendance already reference the CVI- code, and
   * rewriting it in place would make every one of those unverifiable against
   * whoever holds that code number today. `previousEmployeeCode` and
   * `codeChangedAt` are what let a later payslip lookup still resolve it.
   *
   * Only `employeeCode`, `previousEmployeeCode`, `codeChangedAt` and
   * `employmentType` change here — leave balances, group membership and the
   * reporting line are simply never touched, which is what "survives
   * conversion" means at the SQL level.
   *
   * Idempotent: retried after a timeout, or triggered twice from a
   * double-click, this must not draw a second CV- code and clobber the
   * `previousEmployeeCode` the first attempt already recorded. `FOR UPDATE`
   * serialises two concurrent calls for the same employee, and checking
   * `employmentType` inside that lock is what turns the second call into a
   * no-op that returns the already-converted record instead of converting
   * it again.
   */
  async convertToPermanent(id: string): Promise<EmployeeRecord> {
    const { row, justConverted, queuedMailChange } = await withTenant(this.ctx, async (tx) => {
      const [current] = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
        .for("update")
        .limit(1);

      if (!current) throw new NotFoundError("Employee", id);

      // Already converted, or never was an intern: return the record as-is
      // rather than drawing a second code. This check, made inside the row
      // lock above, is the entire idempotency guarantee — a retried request
      // observes "not an intern any more" and stops here.
      if (current.employmentType !== "intern") {
        return { row: current, justConverted: false, queuedMailChange: null };
      }

      const result = await tx.execute(
        sql`SELECT hrms.next_employee_code(${this.ctx.orgId}::uuid, ${PERMANENT_EMPLOYEE_CODE_PREFIX}) AS code`,
      );
      const newCode = (result.rows[0] as { code?: string } | undefined)?.code;
      if (!newCode) {
        throw new Error(
          "hrms.next_employee_code returned nothing; migration 0040 may not be applied",
        );
      }

      const [updated] = await tx
        .update(employees)
        .set({
          employeeCode: newCode,
          previousEmployeeCode: current.employeeCode,
          codeChangedAt: new Date(),
          // The same default a hire with no explicit employmentType already
          // gets in create() above — a converted intern lands exactly where
          // a permanent hire who never specified a type would.
          employmentType: "full_time" as never,
          updatedAt: new Date(),
        })
        .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
        .returning();

      if (!updated) throw new NotFoundError("Employee", id);

      // An intern who becomes permanent loses the "cvi-" prefix and keeps the
      // rest of their address, so six months of correspondence still resolves
      // to them. Queued rather than applied: the mail server has no rename,
      // so the move is a create, a delete and an alias against a single VM,
      // and `work_email` must not name the new address until it exists.
      const queuedMailChange = await queueMailboxChange(tx as never, {
        orgId: this.ctx.orgId,
        employeeId: id,
        currentEmail: current.workEmail,
        reason: "intern_converted",
      });

      await queuePaystubEmployeeSync(tx, this.ctx.orgId, id);
      return { row: updated, justConverted: true, queuedMailChange };
    });

    // Both side effects are scoped to justConverted: the idempotent no-op
    // branch above already had its Paystub sync queued and its completion
    // certificate dispatched by the call that actually converted the
    // record, and doing either again here would send a second certificate
    // for a retried request that changed nothing.
    if (justConverted) {
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

      void dispatchLifecycleDocuments(
        this.ctx,
        row.id,
        ["internship_completion_certificate"],
        this.ctx.userId,
      ).then((outcomes) => {
        for (const outcome of outcomes) {
          if (!outcome.ok) {
            console.warn(
              "[lifecycle-documents] Could not issue the internship completion certificate on conversion.",
              { orgId: this.ctx.orgId, employeeId: row.id, error: outcome.error },
            );
          }
        }
      });
    }

    return toRecord(row);
  }
}
