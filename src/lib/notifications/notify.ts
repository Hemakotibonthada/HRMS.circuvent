// ═══════════════════════════════════════════════════════════════
// NOTIFYING A PERSON ABOUT SOMETHING THAT HAPPENED
// ═══════════════════════════════════════════════════════════════
//
// The bridge between the notification engine and the routes that cause
// notifications.
//
// The engine, its templates and its transports amount to about twelve hundred
// lines with fifty tests, and until now nothing imported any of it outside its
// own test files. Leave was approved and the employee found out by refreshing
// the page. That is the same defect as an unwired email body, at subsystem
// scale: complete, tested, and connected to nothing.
//
// Everything here is best-effort by construction. The approval is already
// committed by the time this runs, and an exception raised while announcing it
// would turn a successful approval into a 500 — leaving the leave approved,
// the balance deducted, and the manager convinced it failed.

import { eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { employees } from "@/db/schema/hrms";
import {
  planDispatch,
  type NotificationRequest,
  type NotificationType,
  type UserPreferences,
} from "@/lib/notifications/engine";
import { deliver, type DeliveryResult, type Recipient } from "@/lib/notifications/transport";

/**
 * Where to reach an employee.
 *
 * Work address first. A leave approval is a work matter and belongs in the
 * mailbox the person reads at work; a personal address is the fallback for
 * someone who has been offboarded and whose work mail is already closed.
 */
export async function loadRecipient(
  ctx: TenantContext,
  employeeId: string
): Promise<Recipient | null> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({
        id: employees.id,
        workEmail: employees.workEmail,
        personalEmail: employees.personalEmail,
      })
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);

    if (!row) return null;

    const email = row.workEmail?.trim() || row.personalEmail?.trim() || undefined;
    return { userId: row.id, email };
  });
}

export interface NotifyOutcome {
  attempted: boolean;
  results: DeliveryResult[];
  reason?: string;
}

/**
 * Tells an employee about something, over whichever channels apply.
 *
 * Never throws. Returns what happened so a route can log it, because a
 * notification that silently did not go is indistinguishable from one the
 * recipient has not read yet.
 */
export async function notifyEmployee(
  ctx: TenantContext,
  input: {
    employeeId: string;
    type: NotificationType;
    data: Record<string, string | number>;
    actionUrl?: string;
    idempotencyKey?: string;
    preferences?: UserPreferences;
  }
): Promise<NotifyOutcome> {
  try {
    const recipient = await loadRecipient(ctx, input.employeeId);
    if (!recipient) {
      return { attempted: false, results: [], reason: "No such employee" };
    }
    if (!recipient.email) {
      return { attempted: false, results: [], reason: "Employee has no email address" };
    }

    const request: NotificationRequest = {
      type: input.type,
      recipientId: input.employeeId,
      data: input.data,
      actionUrl: input.actionUrl,
      idempotencyKey: input.idempotencyKey,
    };

    const preferences: UserPreferences = input.preferences ?? { userId: input.employeeId };
    const decision = planDispatch(request, preferences);

    if (decision.suppressedReason) {
      return { attempted: false, results: [], reason: decision.suppressedReason };
    }

    return { attempted: true, results: await deliver(decision, recipient) };
  } catch (error) {
    // The thing being announced already happened. Losing the announcement is
    // bad; losing the approval because the announcement failed is worse.
    console.error(`[notify] ${input.type} for ${input.employeeId} failed:`, error);
    return {
      attempted: true,
      results: [],
      reason: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
