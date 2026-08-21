// ═══════════════════════════════════════════════════════════════
// SUBSCRIPTION READS AND SEAT ACCOUNTING
// ═══════════════════════════════════════════════════════════════
//
// The database half of billing. The rules themselves are in `plans.ts`, kept
// pure so they can be tested without a database; this is only the part that
// has to talk to one.
//
// `currentEmployees` on the subscription row is treated as a cache, not as
// truth. Truth is `count(*)` over `hrms.employees`, because a stored counter
// drifts the first time anything writes an employee without remembering to
// increment it — and this codebase now has three such paths: the create form,
// the spreadsheet importer and the ATS onboarding handoff. A seat limit
// enforced against a counter that has drifted low is not enforced at all.

import { and, count, eq, isNull } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { subscriptions } from "@/db/schema/identity";
import { employees } from "@/db/schema/hrms";
import {
  PLANS,
  checkSeats,
  isEntitled,
  planFor,
  trialDaysRemaining,
  trialEndsAt,
  type PlanId,
  type SeatCheck,
  type SubscriptionSnapshot,
  type SubscriptionStatus,
} from "@/lib/billing/plans";

export interface SubscriptionView extends SubscriptionSnapshot {
  /** Measured, never read from the cached column. */
  employeesUsed: number;
  seatsRemaining: number | null;
  trialDaysLeft: number;
  entitled: boolean;
  planName: string;
  pricePerEmployeeMinor: number;
  currency: string;
  /** Whether a payment processor has ever been attached to this tenant. */
  externalCustomerId: string | null;
}

/**
 * The tenant's subscription, or null when it has none.
 *
 * Null is a real answer rather than an error: every organisation created
 * before subscriptions were provisioned at sign-up has no row, and those
 * tenants must keep working rather than be locked out by a billing feature
 * that arrived after they did.
 */
export async function loadSubscription(ctx: TenantContext): Promise<SubscriptionView | null> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.orgId, ctx.orgId))
      .limit(1);

    const [{ value: used }] = await tx
      .select({ value: count() })
      .from(employees)
      .where(and(eq(employees.orgId, ctx.orgId), isNull(employees.deletedAt)));

    if (!row) return null;

    const snapshot: SubscriptionSnapshot = {
      plan: (row.plan ?? "starter") as PlanId,
      status: (row.status ?? "trial") as SubscriptionStatus,
      maxEmployees: row.maxEmployees ?? null,
      trialEndsAt: row.trialEndsAt ?? null,
      currentPeriodEnd: row.currentPeriodEnd ?? null,
      cancelledAt: row.cancelledAt ?? null,
    };

    const plan = planFor(snapshot.plan);
    const seats = checkSeats(snapshot, used, 0);

    return {
      ...snapshot,
      employeesUsed: used,
      seatsRemaining: seats.remaining,
      trialDaysLeft: trialDaysRemaining(snapshot),
      entitled: isEntitled(snapshot),
      planName: plan.name,
      pricePerEmployeeMinor: row.pricePerEmployee ?? plan.pricePerEmployeeMinor,
      currency: row.currency ?? plan.currency,
      externalCustomerId: row.externalCustomerId ?? null,
    };
  });
}

/**
 * Whether this organisation may add `adding` more employees.
 *
 * A tenant with no subscription row is allowed through. That is deliberate:
 * subscriptions began being created at sign-up only recently, so refusing
 * here would lock every organisation that predates the change out of hiring,
 * to enforce a plan it was never sold. Those tenants are visible — their
 * subscription reads as null on the billing screen — and can be backfilled;
 * denying them access first and asking questions afterwards is the wrong
 * order for a control that has never run before.
 */
export async function assertSeatsAvailable(
  ctx: TenantContext,
  adding: number
): Promise<SeatCheck> {
  const view = await loadSubscription(ctx);
  if (!view) {
    return { allowed: true, limit: null, used: 0, remaining: null };
  }

  return checkSeats(view, view.employeesUsed, adding);
}

/**
 * Writes the measured headcount back onto the subscription row.
 *
 * The column is a convenience for anything reading the row directly — an
 * invoice run, a support query — and this keeps it honest without ever being
 * the thing a limit is checked against.
 */
export async function refreshSeatCount(ctx: TenantContext): Promise<number> {
  return withTenant(ctx, async (tx) => {
    const [{ value: used }] = await tx
      .select({ value: count() })
      .from(employees)
      .where(and(eq(employees.orgId, ctx.orgId), isNull(employees.deletedAt)));

    await tx
      .update(subscriptions)
      .set({ currentEmployees: used, updatedAt: new Date() })
      .where(eq(subscriptions.orgId, ctx.orgId));

    return used;
  });
}

/**
 * Gives an organisation that predates subscriptions the trial it never got.
 *
 * Used by the billing screen rather than run as a migration, so a tenant is
 * only given a plan at the moment somebody actually looks at billing — and
 * so this never silently starts a clock on an organisation nobody is using.
 */
export async function startTrialIfMissing(ctx: TenantContext): Promise<boolean> {
  return withTenant(ctx, async (tx) => {
    const [existing] = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.orgId, ctx.orgId))
      .limit(1);

    if (existing) return false;

    const plan = PLANS.starter;
    await tx.insert(subscriptions).values({
      orgId: ctx.orgId,
      plan: plan.id,
      status: "trial",
      maxEmployees: plan.maxEmployees ?? undefined,
      pricePerEmployee: plan.pricePerEmployeeMinor,
      currency: plan.currency,
      billingCycle: "monthly",
      trialEndsAt: trialEndsAt(),
      currentPeriodStart: new Date(),
      currentPeriodEnd: trialEndsAt(),
    });

    return true;
  });
}

/**
 * Puts a tenant on a paid plan after a verified payment.
 *
 * Idempotent on the payment id, and that is the whole point: the browser
 * reports the payment as soon as the widget closes, and Razorpay's webhook
 * reports the same payment moments later. Whichever arrives first activates
 * the subscription; the second finds the id already recorded and changes
 * nothing, rather than extending the period twice for one payment.
 *
 * The period runs from now rather than from the end of the trial. A company
 * that pays on day three of a fourteen-day trial has chosen to start paying,
 * and quietly holding their money for eleven days before the period begins is
 * not a defensible reading of that.
 */
export async function activateSubscription(
  ctx: TenantContext,
  input: { plan: PlanId; externalPaymentId: string; externalOrderId?: string }
): Promise<{ activated: boolean }> {
  return withTenant(ctx, async (tx) => {
    const [existing] = await tx
      .select({
        id: subscriptions.id,
        externalSubscriptionId: subscriptions.externalSubscriptionId,
      })
      .from(subscriptions)
      .where(eq(subscriptions.orgId, ctx.orgId))
      .limit(1);

    // Already applied. Seen twice for every payment, by design.
    if (existing?.externalSubscriptionId === input.externalPaymentId) {
      return { activated: false };
    }

    const plan = PLANS[input.plan];
    const periodStart = new Date();
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    if (!existing) {
      await tx.insert(subscriptions).values({
        orgId: ctx.orgId,
        plan: plan.id,
        status: "active",
        maxEmployees: plan.maxEmployees ?? undefined,
        pricePerEmployee: plan.pricePerEmployeeMinor,
        currency: plan.currency,
        billingCycle: "monthly",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        externalSubscriptionId: input.externalPaymentId,
        externalCustomerId: input.externalOrderId ?? null,
      });
      return { activated: true };
    }

    await tx
      .update(subscriptions)
      .set({
        plan: plan.id,
        status: "active",
        // The column is NOT NULL, so an unlimited plan omits it rather than
        // writing null — `undefined` leaves the existing value, which for a
        // plan with no cap is what "no limit" already means here.
        maxEmployees: plan.maxEmployees ?? undefined,
        pricePerEmployee: plan.pricePerEmployeeMinor,
        currency: plan.currency,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        externalSubscriptionId: input.externalPaymentId,
        externalCustomerId: input.externalOrderId ?? null,
        cancelledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.orgId, ctx.orgId));

    return { activated: true };
  });
}
