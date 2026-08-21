// ═══════════════════════════════════════════════════════════════
// RECURRING — turning a plan choice into a Razorpay subscription
// ═══════════════════════════════════════════════════════════════
// The one-off flow charges for a month already counted and needs the customer
// to return each time. This is the other option: a mandate authorised once,
// collected monthly by Razorpay.
//
// ── Seat pricing, without cancel-and-recreate ──
// The Razorpay plan prices one employee for one month; the subscription's
// `quantity` is the headcount. Razorpay charges amount × quantity per cycle,
// and hiring is a quantity update on the same subscription. That is the whole
// reason recurring is possible here at all — the objection recorded against it
// in `razorpay.ts` was that a fixed mandate cannot follow a changing headcount,
// and a per-seat plan with a quantity does exactly that.
//
// ── Plans are reused, not created per customer ──
// Razorpay plans are immutable and permanent. Creating one per organisation
// would leave a merchant account carrying a plan for every company that ever
// signed up, and there would be no way to tidy them. One plan per tier per
// price is enough, because the customer-specific part is the quantity.

import { eq, sql } from "drizzle-orm";

import { withTenant } from "@/db/client";
import { subscriptions } from "@/db/schema/identity";
import {
  createPlan,
  createSubscription,
  updateSubscriptionQuantity,
  type RazorpayCredentials,
} from "@/lib/billing/razorpay";
import { hasLapsed, type Plan, type SubscriptionSnapshot } from "@/lib/billing/plans";

/**
 * The settings key a tier's Razorpay plan id is remembered under.
 *
 * Keyed by tier *and* price so that changing a price creates a new Razorpay
 * plan rather than silently billing new customers at the old rate — Razorpay
 * plans cannot be edited, so reusing the id after a price change would charge
 * the old amount forever with nothing on screen to suggest it.
 */
export function planSettingKey(plan: Plan): string {
  return `payments.razorpay.plan.${plan.id}.${plan.pricePerEmployeeMinor}`;
}

export interface StartRecurringInput {
  creds: RazorpayCredentials;
  orgId: string;
  plan: Plan;
  employees: number;
}

/**
 * Creates (or reuses) the Razorpay plan, starts a subscription, and records it.
 *
 * The subscription id is written before the customer authorises anything.
 * That is deliberate: if the row were written only after authorisation, a
 * customer who completed the mandate while the response was lost would have a
 * live Razorpay subscription this application had never heard of — billed
 * monthly, attributable to nobody. An unauthorised subscription id sitting in
 * the row is harmless by comparison; Razorpay charges nothing until the
 * mandate is signed, and the webhook is what marks it active.
 */
export async function startRecurring(
  input: StartRecurringInput
): Promise<{ subscriptionId: string; planId: string }> {
  const key = planSettingKey(input.plan);

  const planId = await resolvePlanId(input, key);

  const subscription = await createSubscription(input.creds, {
    planId,
    quantity: input.employees,
    // The same notes the one-off order carries, for the same reason: the
    // webhook reads the tenant and the tier from here, and these were written
    // by this server rather than by the customer.
    notes: {
      orgId: input.orgId,
      plan: input.plan.id,
      employees: String(input.employees),
    },
  });

  await withTenant({ orgId: input.orgId }, async (tx) => {
    await tx
      .update(subscriptions)
      .set({
        razorpaySubscriptionId: subscription.id,
        razorpayPlanId: planId,
        billedQuantity: input.employees,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.orgId, input.orgId));
  });

  return { subscriptionId: subscription.id, planId };
}

/**
 * Brings Razorpay's billed seat count into line with actual headcount.
 *
 * Without this, recurring billing is wrong the moment anybody is hired: the
 * subscription keeps charging for the headcount at the time the mandate was
 * signed. A growing customer is undercharged and a shrinking one is
 * overcharged, and neither notices until an invoice is queried.
 *
 * Run from the nightly sweep rather than on every hire, deliberately. A
 * quantity update is an API call against a live mandate; doing one per hire
 * would mean twenty calls during an onboarding morning, each racing the last,
 * to reach a number one nightly call reaches exactly. The change takes effect
 * at the next cycle either way — see `updateSubscriptionQuantity` — so there
 * is nothing to gain by being quicker and a rate limit to lose.
 *
 * Returns what it did rather than logging it, so "nothing to do" is
 * distinguishable from "adjusted three".
 */
export async function syncSubscriptionQuantity(
  orgId: string,
  deps: {
    creds: RazorpayCredentials | null;
    update?: typeof updateSubscriptionQuantity;
  }
): Promise<{ changed: boolean; from?: number; to?: number; reason?: string }> {
  if (!deps.creds) return { changed: false, reason: "payments-not-configured" };

  const row = await withTenant({ orgId }, async (tx) => {
    const [found] = await tx
      .select({
        razorpaySubscriptionId: subscriptions.razorpaySubscriptionId,
        billedQuantity: subscriptions.billedQuantity,
        currentEmployees: subscriptions.currentEmployees,
        status: subscriptions.status,
      })
      .from(subscriptions)
      .where(eq(subscriptions.orgId, orgId))
      .limit(1);
    return found ?? null;
  });

  // Not on recurring billing. The one-off flow prices each order from live
  // headcount at the moment of payment, so there is nothing to keep in step.
  if (!row?.razorpaySubscriptionId) return { changed: false, reason: "not-recurring" };

  // A cancelled mandate must not be touched: updating the quantity on one
  // would be an attempt to keep billing somebody who has stopped.
  if (row.status === "cancelled" || row.status === "expired") {
    return { changed: false, reason: "not-active" };
  }

  const seats = Math.max(1, row.currentEmployees ?? 1);
  if (row.billedQuantity === seats) return { changed: false, reason: "already-in-step" };

  const update = deps.update ?? updateSubscriptionQuantity;
  await update(deps.creds, row.razorpaySubscriptionId, seats);

  await withTenant({ orgId }, async (tx) => {
    await tx
      .update(subscriptions)
      .set({ billedQuantity: seats, updatedAt: new Date() })
      .where(eq(subscriptions.orgId, orgId));
  });

  return { changed: true, from: row.billedQuantity ?? undefined, to: seats };
}
/**
 * Writes `expired` on a subscription whose paid period has run out.
 *
 * The status is bookkeeping, not the gate. `isEntitled` already decides a
 * lapse from `current_period_end` and the grace period, so the product stops
 * working at the right moment whether or not this ever runs. What this adds is
 * a row that says so — which is what a billing screen reads, and what somebody
 * asking "why did this customer stop paying" needs to find.
 *
 * Written this way round on purpose: making the sweep the gate would mean
 * entitlement depended on whether a nightly job succeeded, and a job that
 * failed last night would silently hand out a free month.
 */
export async function markLapsedSubscription(orgId: string): Promise<boolean> {
  return withTenant({ orgId }, async (tx) => {
    const [row] = await tx
      .select({
        plan: subscriptions.plan,
        status: subscriptions.status,
        maxEmployees: subscriptions.maxEmployees,
        trialEndsAt: subscriptions.trialEndsAt,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelledAt: subscriptions.cancelledAt,
      })
      .from(subscriptions)
      .where(eq(subscriptions.orgId, orgId))
      .limit(1);

    if (!row) return false;

    const lapsed = hasLapsed({
      plan: row.plan as SubscriptionSnapshot["plan"],
      status: row.status as SubscriptionSnapshot["status"],
      maxEmployees: row.maxEmployees ?? null,
      trialEndsAt: row.trialEndsAt ?? null,
      currentPeriodEnd: row.currentPeriodEnd ?? null,
      cancelledAt: row.cancelledAt ?? null,
    });

    if (!lapsed) return false;

    await tx
      .update(subscriptions)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(subscriptions.orgId, orgId));
    return true;
  });
}

/**
 * The Razorpay plan for this tier, created once and remembered.
 *
 * Stored in `platform_settings` rather than derived, because the id is
 * Razorpay's and cannot be recomputed — losing it means creating a duplicate
 * plan on every checkout, and a merchant account slowly filling with identical
 * plans nobody can delete.
 */
async function resolvePlanId(input: StartRecurringInput, key: string): Promise<string> {
  const existing = await readPlanId(key);
  if (existing) return existing;

  const created = await createPlan(input.creds, {
    perSeatAmountMinor: input.plan.pricePerEmployeeMinor,
    currency: input.plan.currency,
    name: `${input.plan.name} — per employee, per month`,
    notes: { tier: input.plan.id },
  });

  await writePlanId(key, created.id);
  return created.id;
}

async function readPlanId(key: string): Promise<string | null> {
  // `identity.platform_settings` is not in the Drizzle schema — the Razorpay
  // settings repository reads it with a tagged template and so does this.
  // Tagged, never the `{ sql, params }` object form, which `execute` does not
  // accept and which fails only at runtime.
  return withTenant({ orgId: "", superuser: true }, async (tx) => {
    const result = await tx.execute(
      sql`SELECT value FROM identity.platform_settings WHERE key = ${key}`
    );
    const rows = (result as unknown as { rows?: { value?: { planId?: string } }[] }).rows ?? [];
    return rows[0]?.value?.planId ?? null;
  });
}

async function writePlanId(key: string, planId: string): Promise<void> {
  await withTenant({ orgId: "", superuser: true }, async (tx) => {
    await tx.execute(
      sql`INSERT INTO identity.platform_settings (key, value, updated_at)
          VALUES (${key}, ${JSON.stringify({ planId })}::jsonb, now())
          ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, updated_at = now()`
    );
  });
}
