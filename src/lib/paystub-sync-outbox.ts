import { and, eq, isNull, sql } from "drizzle-orm";
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

function retryAt(attemptCount: number): Date {
  const minutes = Math.min(60 * 24, 2 ** Math.min(attemptCount, 10));
  return new Date(Date.now() + minutes * 60_000);
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
