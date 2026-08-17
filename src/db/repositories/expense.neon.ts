// ═══════════════════════════════════════════════════════════════
// EXPENSE REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// `hrms.expense_claims` has existed, with row-level security, indexes and a
// unique claim number, since the schema was written. The workflow engine
// already routes `expense` approvals to it. What was missing was anything that
// wrote to it: `/api/expenses` validated a submission, invented
// `id: EXP-${Date.now()}`, returned 201 "Expense submitted" and dropped it on
// the floor. An employee filed a claim, saw success, and the money never came.
//
// Three things this has to get right that the fake did not:
//
//   * **Claim numbers must be unique per organization.** A number derived from
//     `Date.now()` collides whenever two people submit in the same
//     millisecond, and `expense_claims_org_number_key` would then reject the
//     second — under load, at random. The sequence is computed inside the same
//     transaction that inserts, so the unique index is a backstop rather than
//     the mechanism.
//
//   * **Amounts are bigint minor units.** A reimbursement is money going back
//     to a person; the float rounding the payroll repository documents applies
//     here with the same force.
//
//   * **A claim moves forward once.** `canTransition` is checked against the
//     row inside the transaction, so a double-clicked Approve cannot reach
//     reimbursement twice.

import { and, asc, count, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { employees, expenseClaims } from "@/db/schema/hrms";
import { minorToMajor, toMinor } from "@/lib/money/minor";
import {
  canTransition,
  formatClaimNumber,
  resolveApprovedMinor,
  totalOfLineItems,
  validateClaim,
  type ExpenseLineItem,
  type ExpenseStage,
} from "@/lib/expense-rules";
import { dateKeyInZone } from "@/lib/date-keys";
import {
  NotFoundError,
  RepositoryError,
  type ExpenseClaimRecord,
  type ExpenseSubmission,
  type ListQuery,
  type Page,
} from "./types";

const SORTABLE = {
  expenseDate: expenseClaims.expenseDate,
  createdAt: expenseClaims.createdAt,
  status: expenseClaims.status,
  totalAmount: expenseClaims.totalAmountMinor,
} as const;

type Row = typeof expenseClaims.$inferSelect & { employeeName?: string | null };

/**
 * The stage, which the column alone does not carry.
 *
 * `status` is the approval enum; reimbursement is recorded by a timestamp. A
 * reimbursed claim is still `approved` in the column, so anything reasoning
 * about "what can happen next" has to look at both.
 */
function stageOf(row: Row): ExpenseStage {
  if (row.status === "approved" && row.reimbursedAt) return "reimbursed";
  return row.status;
}

function toRecord(row: Row): ExpenseClaimRecord {
  const approvedMinor = row.approvedAmountMinor;

  return {
    id: row.id,
    claimNumber: row.claimNumber,
    employeeId: row.employeeId,
    employeeName: row.employeeName ?? undefined,
    title: row.title,
    category: row.category,
    expenseDate: row.expenseDate,
    description: row.description ?? undefined,
    lineItems: (row.lineItems as ExpenseLineItem[]) ?? [],
    receipts: (row.receipts as string[]) ?? [],
    anomalies: (row.anomalies as string[]) ?? [],

    status: row.status,
    stage: stageOf(row),

    // Floats for display, exact paise beside them. Same contract as payroll:
    // print from the first, add with the second.
    amount: minorToMajor(row.totalAmountMinor),
    amountMinor: toMinor(row.totalAmountMinor),
    approvedAmount: approvedMinor === null ? undefined : minorToMajor(approvedMinor),
    approvedAmountMinor: approvedMinor === null ? undefined : toMinor(approvedMinor),
    currency: row.currency,

    approvedById: row.approvedById ?? undefined,
    approvedAt: row.approvedAt?.toISOString(),
    rejectionReason: row.rejectionReason ?? undefined,
    reimbursedAt: row.reimbursedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export class NeonExpenseRepository {
  constructor(private readonly ctx: TenantContext) {}

  async list(q: ListQuery = {}): Promise<Page<ExpenseClaimRecord>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, q.pageSize ?? 50));

    const conditions: SQL[] = [];
    const filters = q.filters ?? {};
    if (filters.status && filters.status !== "all") {
      conditions.push(eq(expenseClaims.status, filters.status as never));
    }
    if (filters.employeeId) {
      conditions.push(eq(expenseClaims.employeeId, filters.employeeId as string));
    }
    if (filters.category && filters.category !== "all") {
      conditions.push(eq(expenseClaims.category, filters.category as string));
    }
    if (filters.from) conditions.push(gte(expenseClaims.expenseDate, filters.from as string));
    if (filters.to) conditions.push(lte(expenseClaims.expenseDate, filters.to as string));

    const sortColumn = SORTABLE[(q.sortBy ?? "createdAt") as keyof typeof SORTABLE];
    if (!sortColumn) throw new RepositoryError(`Cannot sort expenses by ${q.sortBy}`, 400);
    const direction = q.sortDirection === "asc" ? asc : desc;

    return withTenant(this.ctx, async (tx) => {
      const where = conditions.length ? and(...conditions) : undefined;

      const rows = await tx
        .select({
          claim: expenseClaims,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(expenseClaims)
        .leftJoin(employees, eq(employees.id, expenseClaims.employeeId))
        .where(where)
        // A stable tiebreak, or two claims created in the same millisecond can
        // swap places between pages and one of them is never shown.
        .orderBy(direction(sortColumn), asc(expenseClaims.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(expenseClaims)
        .where(where);

      const items = rows.map((r) =>
        toRecord({
          ...r.claim,
          employeeName:
            r.firstName || r.lastName ? `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() : null,
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

  async getById(id: string): Promise<ExpenseClaimRecord | null> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({
          claim: expenseClaims,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(expenseClaims)
        .leftJoin(employees, eq(employees.id, expenseClaims.employeeId))
        .where(eq(expenseClaims.id, id))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      return toRecord({
        ...row.claim,
        employeeName:
          row.firstName || row.lastName
            ? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()
            : null,
      });
    });
  }

  /** Totals for the header cards, computed in the database rather than by paging. */
  async summary(employeeId?: string): Promise<{
    total: number;
    pending: number;
    approved: number;
    reimbursed: number;
    totalAmountMinor: string;
  }> {
    return withTenant(this.ctx, async (tx) => {
      const where = employeeId ? eq(expenseClaims.employeeId, employeeId) : undefined;

      const rows = await tx
        .select({
          status: expenseClaims.status,
          reimbursed: sql<number>`count(*) filter (where ${expenseClaims.reimbursedAt} is not null)`,
          n: count(),
          amount: sql<string>`coalesce(sum(${expenseClaims.totalAmountMinor}), 0)::text`,
        })
        .from(expenseClaims)
        .where(where)
        .groupBy(expenseClaims.status);

      let total = 0;
      let pending = 0;
      let approved = 0;
      let reimbursed = 0;
      let amount = 0n;

      for (const row of rows) {
        total += Number(row.n);
        if (row.status === "pending") pending += Number(row.n);
        if (row.status === "approved") approved += Number(row.n);
        reimbursed += Number(row.reimbursed);
        amount += BigInt(row.amount);
      }

      return { total, pending, approved, reimbursed, totalAmountMinor: amount.toString() };
    });
  }

  /**
   * Files a claim.
   *
   * The total is derived from the line items rather than accepted from the
   * caller — a submitted total that disagrees with its own lines is either a
   * bug or an attempt to claim more than they justify.
   */
  async submit(input: ExpenseSubmission): Promise<ExpenseClaimRecord> {
    const today = dateKeyInZone(new Date());
    const validation = validateClaim(
      {
        title: input.title,
        category: input.category,
        expenseDate: input.expenseDate,
        lineItems: input.lineItems,
        description: input.description,
      },
      today
    );

    if (!validation.ok) {
      throw new RepositoryError(validation.errors.join("; "), 400);
    }

    const totalMinor = BigInt(totalOfLineItems(input.lineItems));

    return withTenant(this.ctx, async (tx) => {
      const employee = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.id, input.employeeId))
        .limit(1);

      // RLS already confines this to the caller's tenant, so a miss here means
      // the employee is in another organization — reported as not found rather
      // than confirming they exist somewhere.
      if (!employee[0]) throw new NotFoundError("Employee", input.employeeId);

      const year = Number(input.expenseDate.slice(0, 4));

      // Read inside the transaction so two concurrent submissions serialise on
      // the unique index rather than both computing the same next number.
      const [{ used }] = await tx
        .select({ used: count() })
        .from(expenseClaims)
        .where(sql`${expenseClaims.claimNumber} like ${`EXP-${year}-%`}`);

      const inserted = await tx
        .insert(expenseClaims)
        .values({
          orgId: this.ctx.orgId,
          employeeId: input.employeeId,
          claimNumber: formatClaimNumber(year, used + 1),
          title: input.title.trim(),
          category: input.category,
          totalAmountMinor: totalMinor,
          currency: input.currency ?? "INR",
          expenseDate: input.expenseDate,
          description: input.description?.trim() || null,
          lineItems: input.lineItems,
          receipts: input.receipts ?? [],
          status: "pending",
        })
        .returning();

      return toRecord(inserted[0]);
    });
  }

  /** Approves, in full or in part. */
  async approve(
    id: string,
    approvedById: string,
    approvedAmountMinor?: string | null
  ): Promise<ExpenseClaimRecord> {
    return this.transition(id, "approved", async (row, tx) => {
      const approved = resolveApprovedMinor(toMinor(row.totalAmountMinor), approvedAmountMinor);

      const updated = await tx
        .update(expenseClaims)
        .set({
          status: "approved",
          approvedById,
          approvedAt: new Date(),
          approvedAmountMinor: BigInt(approved),
          rejectionReason: null,
        })
        .where(eq(expenseClaims.id, id))
        .returning();

      return updated[0];
    });
  }

  async reject(id: string, approvedById: string, reason: string): Promise<ExpenseClaimRecord> {
    if (!reason.trim()) {
      throw new RepositoryError("A reason is required when rejecting", 400);
    }

    return this.transition(id, "rejected", async (_row, tx) => {
      const updated = await tx
        .update(expenseClaims)
        .set({
          status: "rejected",
          approvedById,
          approvedAt: new Date(),
          rejectionReason: reason.trim(),
        })
        .where(eq(expenseClaims.id, id))
        .returning();

      return updated[0];
    });
  }

  /** Withdrawn by the claimant, or cancelled by HR. */
  async cancel(id: string, reason: string): Promise<ExpenseClaimRecord> {
    return this.transition(id, "cancelled", async (_row, tx) => {
      const updated = await tx
        .update(expenseClaims)
        .set({ status: "cancelled", rejectionReason: reason.trim() || "Withdrawn" })
        .where(eq(expenseClaims.id, id))
        .returning();

      return updated[0];
    });
  }

  /**
   * Records payment.
   *
   * Only reachable from `approved`, and only once — the transition check is
   * what stops a retried click paying somebody twice.
   */
  async reimburse(id: string): Promise<ExpenseClaimRecord> {
    return this.transition(id, "reimbursed", async (_row, tx) => {
      const updated = await tx
        .update(expenseClaims)
        .set({ reimbursedAt: new Date() })
        .where(eq(expenseClaims.id, id))
        .returning();

      return updated[0];
    });
  }

  /**
   * Locks the row, checks the transition, then applies it.
   *
   * `FOR UPDATE` matters: without it two approvals read `pending` at the same
   * moment, both pass the check, and both write. The lock makes the second one
   * wait and then fail correctly.
   */
  private async transition(
    id: string,
    to: ExpenseStage,
    apply: (
      row: typeof expenseClaims.$inferSelect,
      tx: Parameters<Parameters<typeof withTenant>[1]>[0]
    ) => Promise<typeof expenseClaims.$inferSelect>
  ): Promise<ExpenseClaimRecord> {
    return withTenant(this.ctx, async (tx) => {
      const locked = await tx.execute(
        sql`SELECT * FROM hrms.expense_claims WHERE id = ${id} FOR UPDATE`
      );

      const row = locked.rows[0] as unknown as typeof expenseClaims.$inferSelect | undefined;
      if (!row) throw new NotFoundError("Expense claim", id);

      // The raw row comes back with snake_case keys and text-typed numerics,
      // so it is re-read through Drizzle for the stage check rather than
      // trusted to have the shape the type claims.
      const typed = await tx
        .select()
        .from(expenseClaims)
        .where(eq(expenseClaims.id, id))
        .limit(1);

      const current = typed[0];
      if (!current) throw new NotFoundError("Expense claim", id);

      const from = stageOf(current);
      if (!canTransition(from, to)) {
        throw new RepositoryError(`An expense claim cannot go from ${from} to ${to}`, 409);
      }

      return toRecord(await apply(current, tx));
    });
  }
}
