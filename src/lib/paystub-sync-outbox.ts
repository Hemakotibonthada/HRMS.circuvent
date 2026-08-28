import { and, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { departments, employees, locations, paystubEmployeeSyncOutbox } from "@/db/schema/hrms";
import { pushEmployeeToPaystub, type PaystubSyncSource } from "@/lib/paystub-client";

type EmployeeRow = typeof employees.$inferSelect;
type TenantTx = Parameters<Parameters<typeof withTenant>[1]>[0];

export interface PaystubOutboxAttemptResult {
  ok: boolean;
  created?: boolean;
  error?: string;
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/X-Service-Token[^\s,)]*/gi, "X-Service-Token [redacted]").slice(0, 500);
}

/**
 * How long to wait before trying again, doubling each time to a ceiling.
 *
 * The ceiling is 1024 minutes (about 17 hours), set by the exponent cap; the
 * `60 * 24` term can never be selected, because 1024 is already below it. Kept
 * byte-identical to `retryDelayMinutes` in `onboarding-groups.ts` rather than
 * tidied, because the two outboxes backing off in step is the property worth
 * having, and a silent divergence between them is the kind of thing nobody
 * notices until one is retrying every minute.
 */
export function paystubRetryDelayMinutes(attemptCount: number): number {
  return Math.min(60 * 24, 2 ** Math.min(attemptCount, 10));
}

function retryAt(attemptCount: number): Date {
  return new Date(Date.now() + paystubRetryDelayMinutes(attemptCount) * 60_000);
}

/**
 * What a sweep should do with a row it has picked up.
 *
 * Split out because the interesting case is not the happy one. A soft-deleted
 * employee can never be pushed, and `attemptPaystubEmployeeSync` refuses it
 * *before* recording an attempt — so the row keeps its long-past next-attempt
 * time, is selected again by the very next sweep, and occupies the batch limit
 * forever while making no progress. Deciding that here, in one pure function,
 * is what makes it possible to prove it does not happen.
 */
export type OutboxRowAction =
  | { kind: "attempt" }
  | { kind: "retire"; reason: string };

export function actionForOutboxRow(row: { deletedAt: Date | null }): OutboxRowAction {
  if (row.deletedAt !== null) {
    return {
      kind: "retire",
      reason: "The employee was deleted in HRMS before this reached Paystub.",
    };
  }
  return { kind: "attempt" };
}

export async function queuePaystubEmployeeSync(
  tx: TenantTx,
  orgId: string,
  employeeId: string
): Promise<void> {
  await tx
    .insert(paystubEmployeeSyncOutbox)
    .values({
      orgId,
      employeeId,
      status: "pending",
      nextAttemptAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [paystubEmployeeSyncOutbox.orgId, paystubEmployeeSyncOutbox.employeeId],
      set: {
        status: "pending",
        nextAttemptAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      },
    });
}

async function markSuccess(
  ctx: TenantContext,
  employeeId: string,
  created: boolean
): Promise<void> {
  await withTenant(ctx, async (tx) => {
    await tx
      .update(paystubEmployeeSyncOutbox)
      .set({
        status: "succeeded",
        attemptCount: sql`${paystubEmployeeSyncOutbox.attemptCount} + 1`,
        lastCreated: created,
        lastError: null,
        lastAttemptAt: new Date(),
        nextAttemptAt: null,
        syncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(paystubEmployeeSyncOutbox.employeeId, employeeId));
  });
}

async function markFailure(
  ctx: TenantContext,
  employeeId: string,
  attemptCount: number,
  error: string
): Promise<void> {
  await withTenant(ctx, async (tx) => {
    await tx
      .update(paystubEmployeeSyncOutbox)
      .set({
        status: "failed",
        attemptCount: sql`${paystubEmployeeSyncOutbox.attemptCount} + 1`,
        lastError: error,
        lastAttemptAt: new Date(),
        nextAttemptAt: retryAt(attemptCount + 1),
        updatedAt: new Date(),
      })
      .where(eq(paystubEmployeeSyncOutbox.employeeId, employeeId));
  });
}

export async function deliverPaystubEmployeeSync(
  source: PaystubSyncSource,
  save: {
    success(created: boolean): Promise<void>;
    failure(error: string): Promise<void>;
  },
  push: (row: PaystubSyncSource) => Promise<{ created: boolean }> = pushEmployeeToPaystub
): Promise<PaystubOutboxAttemptResult> {
  try {
    const result = await push(source);
    await save.success(result.created);
    return { ok: true, created: result.created };
  } catch (error) {
    const message = publicError(error);
    await save.failure(message);
    return { ok: false, error: message };
  }
}

export async function attemptPaystubEmployeeSync(
  ctx: TenantContext,
  employeeId: string
): Promise<PaystubOutboxAttemptResult> {
  const found = await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({
        employee: employees,
        attemptCount: paystubEmployeeSyncOutbox.attemptCount,
        // Joined rather than sent as ids: Paystub keeps its own departments
        // and locations, so a code and a name are the only identifiers the
        // two systems can share. See PaystubEmployeeSyncBody.
        departmentCode: departments.code,
        departmentName: departments.name,
        locationCode: locations.code,
        locationName: locations.name,
      })
      .from(employees)
      .leftJoin(
        paystubEmployeeSyncOutbox,
        and(
          eq(paystubEmployeeSyncOutbox.orgId, employees.orgId),
          eq(paystubEmployeeSyncOutbox.employeeId, employees.id)
        )
      )
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(locations, eq(locations.id, employees.locationId))
      .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)))
      .limit(1);
    return row ?? null;
  });

  if (!found) {
    return { ok: false, error: `Employee ${employeeId} was not found for Paystub sync.` };
  }

  const source: PaystubSyncSource = {
    employee: found.employee,
    department:
      found.departmentCode && found.departmentName
        ? { code: found.departmentCode, name: found.departmentName }
        : null,
    location:
      found.locationCode && found.locationName
        ? { code: found.locationCode, name: found.locationName }
        : null,
  };

  return deliverPaystubEmployeeSync(source, {
    success: (created) => markSuccess(ctx, employeeId, created),
    failure: (error) => markFailure(ctx, employeeId, found.attemptCount ?? 0, error),
  });
}

export async function queueAndAttemptPaystubEmployeeSync(
  ctx: TenantContext,
  employeeId: string
): Promise<void> {
  const result = await attemptPaystubEmployeeSync(ctx, employeeId);
  if (!result.ok) {
    console.warn("[paystub-sync] Employee push failed; intent remains in the outbox.", {
      orgId: ctx.orgId,
      employeeId,
    });
  }
}

export interface PaystubDrainResult {
  attempted: number;
  synced: number;
  failed: number;
  /** Rows whose employee has since been deleted, taken off the retry schedule. */
  retired: number;
}

/**
 * Retries every Paystub push that is due.
 *
 * This is what makes the outbox an outbox. `queueAndAttemptPaystubEmployeeSync`
 * tries once when the employee is saved and, on failure, logs that "the intent
 * remains in the outbox" — but nothing ever came back for it. The backoff
 * columns were written on every failure and read by nobody, so a push that
 * failed on a network blip at hire time stayed failed until somebody edited
 * that employee again. For a leaver, nobody ever does.
 *
 * Due means a retry was actually scheduled and that time has passed. A null
 * `nextAttemptAt` is deliberately *not* due: it is how both a completed row and
 * a retired one say they want nothing further, so neither is picked up forever.
 */
export async function drainDuePaystubSyncs(
  ctx: TenantContext,
  limit = 50
): Promise<PaystubDrainResult> {
  const now = new Date();

  const due = await withTenant(ctx, async (tx) =>
    tx
      .select({
        employeeId: paystubEmployeeSyncOutbox.employeeId,
        deletedAt: employees.deletedAt,
      })
      .from(paystubEmployeeSyncOutbox)
      .leftJoin(employees, eq(employees.id, paystubEmployeeSyncOutbox.employeeId))
      .where(
        and(
          eq(paystubEmployeeSyncOutbox.orgId, ctx.orgId),
          inArray(paystubEmployeeSyncOutbox.status, ["pending", "failed"]),
          isNotNull(paystubEmployeeSyncOutbox.nextAttemptAt),
          lte(paystubEmployeeSyncOutbox.nextAttemptAt, now)
        )
      )
      .limit(limit)
  );

  const result: PaystubDrainResult = { attempted: 0, synced: 0, failed: 0, retired: 0 };

  for (const row of due) {
    const action = actionForOutboxRow({ deletedAt: row.deletedAt ?? null });

    if (action.kind === "retire") {
      // Not marked succeeded, because it did not succeed; carries no next
      // attempt, because it will not be tried again. (A hard delete cascades
      // the row away and never reaches here.)
      await withTenant(ctx, async (tx) => {
        await tx
          .update(paystubEmployeeSyncOutbox)
          .set({
            status: "failed",
            lastError: action.reason,
            nextAttemptAt: null,
            lastAttemptAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(paystubEmployeeSyncOutbox.employeeId, row.employeeId));
      });
      result.retired++;
      continue;
    }

    result.attempted++;
    const attempt = await attemptPaystubEmployeeSync(ctx, row.employeeId);
    if (attempt.ok) result.synced++;
    else result.failed++;
  }

  return result;
}
