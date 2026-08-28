// Recurring billing takes money on a mandate, every month, without anybody
// looking. The tests worth having are the ones about the guards: what refuses
// to be created, and what stops a price change from being billed at the old
// rate forever.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RazorpayError,
  cancelSubscription,
  createPlan,
  createSubscription,
  updateSubscriptionQuantity,
} from "@/lib/billing/razorpay";
import { planSettingKey } from "@/lib/billing/recurring";
import { PLANS } from "@/lib/billing/plans";

const creds = { keyId: "rzp_test_key", keySecret: "secret" };

/** Captures what would have gone to Razorpay without going there. */
function stubFetch(body: unknown = { id: "stub_1" }) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        method: String(init.method),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify(body), { status: 200 });
    })
  );
  return calls;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("creating a per-seat plan", () => {
  it("prices one seat for one month", async () => {
    const calls = stubFetch({ id: "plan_1" });
    await createPlan(creds, {
      perSeatAmountMinor: 24_900,
      currency: "INR",
      name: "Starter — per employee, per month",
    });

    expect(calls[0].url).toContain("/plans");
    expect(calls[0].body).toMatchObject({
      period: "monthly",
      interval: 1,
      item: { amount: 24_900, currency: "INR" },
    });
  });

  it("refuses a price that is not positive whole paise", async () => {
    // A plan is permanent once created. A zero or fractional amount would be
    // an unbillable plan that cannot be edited or deleted afterwards.
    for (const amount of [0, -100, 24_900.5]) {
      await expect(
        createPlan(creds, { perSeatAmountMinor: amount, currency: "INR", name: "x" })
      ).rejects.toBeInstanceOf(RazorpayError);
    }
  });
});

describe("starting a subscription", () => {
  it("carries the headcount as the quantity", async () => {
    // This is what makes recurring workable for seat pricing at all: Razorpay
    // charges amount × quantity, so the monthly total follows hiring.
    const calls = stubFetch({ id: "sub_1" });
    await createSubscription(creds, { planId: "plan_1", quantity: 9 });

    expect(calls[0].url).toContain("/subscriptions");
    expect(calls[0].body).toMatchObject({ plan_id: "plan_1", quantity: 9 });
  });

  it("does not let Razorpay email the customer as well", async () => {
    // This application already writes about billing. Two senders describing
    // the same charge is how somebody stops reading both.
    const calls = stubFetch({ id: "sub_1" });
    await createSubscription(creds, { planId: "plan_1", quantity: 1 });
    expect(calls[0].body).toMatchObject({ customer_notify: 0 });
  });

  it("refuses a subscription for nobody", async () => {
    for (const quantity of [0, -3, 2.5]) {
      await expect(
        createSubscription(creds, { planId: "plan_1", quantity })
      ).rejects.toBeInstanceOf(RazorpayError);
    }
  });
});

describe("changing the seat count", () => {
  it("takes effect at the end of the cycle, not immediately", async () => {
    // Applying at once would charge a prorated amount per hire — a company
    // onboarding twenty people in a week would get twenty separate charges,
    // and letting somebody go mid-month would owe a refund the API cannot
    // cleanly express. One predictable amount per month is what an invoice is.
    const calls = stubFetch({ id: "sub_1" });
    await updateSubscriptionQuantity(creds, "sub_1", 12);

    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toMatchObject({ quantity: 12, schedule_change_at: "cycle_end" });
  });

  it("refuses to bill for nobody", async () => {
    await expect(updateSubscriptionQuantity(creds, "sub_1", 0)).rejects.toBeInstanceOf(
      RazorpayError
    );
  });
});

describe("cancelling", () => {
  it("lets the paid period finish by default", async () => {
    // They have paid for the month they are in; ending it early is taking
    // money for nothing.
    const calls = stubFetch({ id: "sub_1" });
    await cancelSubscription(creds, "sub_1");
    expect(calls[0].body).toMatchObject({ cancel_at_cycle_end: 1 });
  });

  it("can stop immediately when somebody asks", async () => {
    const calls = stubFetch({ id: "sub_1" });
    await cancelSubscription(creds, "sub_1", { immediately: true });
    expect(calls[0].body).toMatchObject({ cancel_at_cycle_end: 0 });
  });
});

describe("which Razorpay plan a tier maps to", () => {
  it("keys on the price as well as the tier", () => {
    /*
     * Razorpay plans are immutable. Keying only on the tier would mean that
     * after a price rise every new customer was still subscribed to the old
     * plan id — billed at last year's rate forever, with the new price shown
     * on screen and nothing to suggest the two disagreed.
     */
    const before = planSettingKey(PLANS.starter);
    const after = planSettingKey({ ...PLANS.starter, pricePerEmployeeMinor: 29_900 });
    expect(before).not.toBe(after);
  });

  it("is stable for the same tier at the same price", () => {
    // Otherwise every checkout creates another plan, and a merchant account
    // fills with identical plans that cannot be deleted.
    expect(planSettingKey(PLANS.professional)).toBe(planSettingKey(PLANS.professional));
  });

  it("distinguishes the tiers", () => {
    expect(planSettingKey(PLANS.starter)).not.toBe(planSettingKey(PLANS.professional));
  });
});
