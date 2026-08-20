import { describe, expect, it } from "vitest";
import {
  PLANS,
  TRIAL_DAYS,
  checkSeats,
  isEntitled,
  monthlyTotalMinor,
  planFor,
  seatLimit,
  trialDaysRemaining,
  trialEndsAt,
  type SubscriptionSnapshot,
} from "./plans";

/**
 * Billing was entirely fictional: the subscriptions table had no rows, the
 * screen hardcoded `SUBSCRIPTION_PLANS[1] // Professional`, and nothing
 * anywhere checked a seat limit. These are the rules that replace that,
 * tested without a database so each one can be stated on its own.
 */

const sub = (over: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot => ({
  plan: "starter",
  status: "active",
  maxEmployees: null,
  trialEndsAt: null,
  currentPeriodEnd: null,
  cancelledAt: null,
  ...over,
});

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

describe("planFor", () => {
  it("finds each plan by id", () => {
    expect(planFor("professional").name).toBe("Professional");
    expect(planFor("enterprise").maxEmployees).toBeNull();
  });

  it("falls back to the cheapest plan rather than throwing", () => {
    /*
     * A stored plan id this build does not recognise — a row written by a
     * later version, or a typo in a support fix — must not take the billing
     * screen down. Falling back to the *cheapest* is deliberate: falling back
     * to the most expensive would silently grant a tenant everything.
     */
    expect(planFor("platinum").id).toBe("starter");
    expect(planFor(null).id).toBe("starter");
    expect(planFor(undefined).id).toBe("starter");
  });
});

describe("isEntitled", () => {
  it("lets an active subscription through", () => {
    expect(isEntitled(sub({ status: "active" }))).toBe(true);
  });

  it("lets a live trial through and stops an expired one", () => {
    expect(isEntitled(sub({ status: "trial", trialEndsAt: inDays(3) }))).toBe(true);
    expect(isEntitled(sub({ status: "trial", trialEndsAt: inDays(-1) }))).toBe(false);
  });

  it("keeps a past-due account working", () => {
    /*
     * A failed card should start a conversation, not lock a company out of
     * its own attendance records on the morning the payment bounced. Dunning
     * is a business process; this is a kill switch, and it is the wrong tool.
     */
    expect(isEntitled(sub({ status: "past_due" }))).toBe(true);
  });

  it("stops a cancelled or expired subscription", () => {
    expect(isEntitled(sub({ status: "cancelled" }))).toBe(false);
    expect(isEntitled(sub({ status: "expired" }))).toBe(false);
  });
});

describe("trialDaysRemaining", () => {
  it("rounds up, so a part day is still a day", () => {
    // Showing "0 days remaining" while the product still works is the kind of
    // small lie that makes people stop believing the big numbers.
    const elevenHours = new Date(Date.now() + 11 * 3_600_000);
    expect(trialDaysRemaining(sub({ trialEndsAt: elevenHours }))).toBe(1);
  });

  it("never goes negative", () => {
    expect(trialDaysRemaining(sub({ trialEndsAt: inDays(-9) }))).toBe(0);
  });

  it("is zero when there is no trial at all", () => {
    expect(trialDaysRemaining(sub({ trialEndsAt: null }))).toBe(0);
  });

  it("gives a fresh trial the advertised length", () => {
    const fresh = sub({ trialEndsAt: trialEndsAt() });
    expect(trialDaysRemaining(fresh)).toBe(TRIAL_DAYS);
  });
});

describe("seatLimit", () => {
  it("prefers the subscription's own ceiling over the plan's", () => {
    // A negotiated deal lives on the row: a customer sold 400 seats on
    // Professional must not be cut back to the catalogue's 200.
    expect(seatLimit(sub({ plan: "professional", maxEmployees: 400 }))).toBe(400);
  });

  it("falls back to the plan when the row names none", () => {
    expect(seatLimit(sub({ plan: "professional", maxEmployees: null }))).toBe(200);
    expect(seatLimit(sub({ plan: "enterprise", maxEmployees: null }))).toBeNull();
  });
});

describe("checkSeats", () => {
  const starter = sub({ plan: "starter", maxEmployees: 25 });

  it("allows an addition that fits", () => {
    const check = checkSeats(starter, 20, 5);
    expect(check.allowed).toBe(true);
    expect(check.remaining).toBe(5);
  });

  it("refuses one that does not, and says by how much", () => {
    /*
     * The importer is the fastest way there is to blow through a seat limit,
     * and somebody who has just tried to upload a spreadsheet needs to know
     * how many rows will fit before they go and edit the file.
     */
    const check = checkSeats(starter, 20, 400);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("25");
    expect(check.reason).toContain("20");
    expect(check.reason).toContain("420");
    expect(check.remaining).toBe(5);
  });

  it("treats exactly filling the plan as allowed", () => {
    // An off-by-one here refuses the twenty-fifth employee on a plan sold as
    // covering twenty-five.
    expect(checkSeats(starter, 24, 1).allowed).toBe(true);
    expect(checkSeats(starter, 25, 1).allowed).toBe(false);
  });

  it("never refuses on an unlimited plan", () => {
    const check = checkSeats(sub({ plan: "enterprise" }), 10_000, 5_000);
    expect(check.allowed).toBe(true);
    expect(check.limit).toBeNull();
    expect(check.remaining).toBeNull();
  });

  it("reports no negative remaining when already over the limit", () => {
    // A tenant can end up over its ceiling — a plan downgraded, or a limit
    // introduced after the fact — and "-15 seats left" helps nobody.
    const check = checkSeats(starter, 40, 1);
    expect(check.remaining).toBe(0);
    expect(check.allowed).toBe(false);
  });
});

describe("monthlyTotalMinor", () => {
  it("multiplies the per-seat price by headcount", () => {
    expect(monthlyTotalMinor(PLANS.starter, 10)).toBe(PLANS.starter.pricePerEmployeeMinor * 10);
  });

  it("never bills a negative headcount", () => {
    expect(monthlyTotalMinor(PLANS.starter, -5)).toBe(0);
  });
});

describe("the catalogue", () => {
  it("prices in the currency the rest of the product uses", () => {
    // The catalogue this replaced quoted dollars on a product whose every
    // other amount is rupees, which is a fair sign of where those numbers
    // came from.
    for (const plan of Object.values(PLANS)) {
      expect(plan.currency).toBe("INR");
      expect(plan.pricePerEmployeeMinor).toBeGreaterThan(0);
    }
  });

  it("gets more expensive as it gets more capable", () => {
    expect(PLANS.starter.pricePerEmployeeMinor).toBeLessThan(PLANS.professional.pricePerEmployeeMinor);
    expect(PLANS.professional.pricePerEmployeeMinor).toBeLessThan(PLANS.enterprise.pricePerEmployeeMinor);
  });

  it("uses ids the database enum already accepts", () => {
    // `identity.subscription_plan` is starter, professional, enterprise. A
    // fourth id here would insert fine in tests and fail on the real column.
    expect(Object.keys(PLANS).sort()).toEqual(["enterprise", "professional", "starter"]);
  });
});
