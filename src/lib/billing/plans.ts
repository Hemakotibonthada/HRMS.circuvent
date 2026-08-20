// ═══════════════════════════════════════════════════════════════
// PLANS AND SUBSCRIPTION STATE
// ═══════════════════════════════════════════════════════════════
//
// What a tenant is paying for, what that entitles them to, and whether they
// are still entitled to it.
//
// ── Why this exists ──
// `identity.subscriptions` has existed since the schema did, with a plan, a
// status, a seat limit, a price, a trial end and both `external_customer_id`
// and `external_subscription_id` sitting ready for a payment processor. It
// had zero rows. Registration advertises "Start your 14-day free trial" and
// created no subscription at all, and the billing screen read
// `SUBSCRIPTION_PLANS[1] // Professional` — so every tenant on every
// deployment was shown the Professional plan whether or not anybody had
// agreed to it, and certainly whether or not anybody had paid for it.
//
// Nothing enforced the seat limit either, which matters more this week than
// last: the spreadsheet importer will cheerfully insert two thousand
// employees into an organisation whose plan allows twenty-five.
//
// ── On the prices below ──
// The catalogue this replaces quoted $3 and $8 per employee per month, on a
// product whose every other amount is rupees — the same tell that the empty
// invoice list on the billing page already called out. These are those
// figures carried into rupees at a round rate. They are a business decision
// rather than a technical one, and they live here, as data, in one place,
// precisely so that changing them is an edit rather than a search.

/** Minor units, as everywhere else in this codebase: paise, not rupees. */
export interface Plan {
  id: PlanId;
  name: string;
  /** Per employee, per month, in paise. */
  pricePerEmployeeMinor: number;
  currency: "INR";
  /** `null` means no ceiling, which is what Enterprise is sold on. */
  maxEmployees: number | null;
  features: string[];
}

export type PlanId = "starter" | "professional" | "enterprise";

/** Matches the `identity.subscription_status` enum exactly. */
export type SubscriptionStatus = "active" | "trial" | "past_due" | "cancelled" | "expired";

export const TRIAL_DAYS = 14;

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: "starter",
    name: "Starter",
    pricePerEmployeeMinor: 24_900,
    currency: "INR",
    maxEmployees: 25,
    features: [
      "Employee directory",
      "Attendance tracking",
      "Leave management",
      "Offer and joining letters",
      "Basic reports",
      "Email support",
    ],
  },
  professional: {
    id: "professional",
    name: "Professional",
    pricePerEmployeeMinor: 66_400,
    currency: "INR",
    maxEmployees: 200,
    features: [
      "Everything in Starter",
      "Payroll and payslips",
      "Recruitment and onboarding",
      "Performance and goals",
      "Spreadsheet import",
      "Priority support",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    pricePerEmployeeMinor: 124_500,
    currency: "INR",
    maxEmployees: null,
    features: [
      "Everything in Professional",
      "Unlimited employees",
      "Single sign-on and SCIM",
      "Custom letter templates",
      "Audit log export",
      "Dedicated support",
    ],
  },
};

export const PLAN_LIST: Plan[] = [PLANS.starter, PLANS.professional, PLANS.enterprise];

/** The plan a stored id names, falling back to the cheapest rather than throwing. */
export function planFor(id: string | null | undefined): Plan {
  return PLANS[(id ?? "") as PlanId] ?? PLANS.starter;
}

export interface SubscriptionSnapshot {
  plan: PlanId;
  status: SubscriptionStatus;
  /** What the row itself allows, which may differ from the plan on a bespoke deal. */
  maxEmployees: number | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelledAt: Date | null;
}

/**
 * Whether this subscription still entitles the tenant to use the product.
 *
 * A trial counts, right up until it does not. `past_due` deliberately counts
 * too: a failed card should start a conversation, not lock a company out of
 * its own attendance records on the morning the payment bounced. `cancelled`
 * and `expired` do not count.
 */
export function isEntitled(sub: SubscriptionSnapshot, now: Date = new Date()): boolean {
  if (sub.status === "cancelled" || sub.status === "expired") return false;
  if (sub.status === "trial") return trialDaysRemaining(sub, now) > 0;
  return true;
}

/**
 * Whole days left of a trial, floored at zero.
 *
 * Rounded up rather than down: somebody with eleven hours left has a day left,
 * not none, and showing "0 days remaining" while the product still works is
 * the kind of small lie that makes people stop believing the big numbers.
 */
export function trialDaysRemaining(sub: SubscriptionSnapshot, now: Date = new Date()): number {
  if (!sub.trialEndsAt) return 0;
  const ms = sub.trialEndsAt.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

/** The seat ceiling that actually applies: the row's own, or its plan's. */
export function seatLimit(sub: SubscriptionSnapshot): number | null {
  return sub.maxEmployees ?? planFor(sub.plan).maxEmployees;
}

export interface SeatCheck {
  allowed: boolean;
  limit: number | null;
  used: number;
  /** How many more may be added. `null` when there is no ceiling. */
  remaining: number | null;
  reason?: string;
}

/**
 * Whether `adding` this many more employees is within the plan.
 *
 * Takes a count rather than being asked one employee at a time, because the
 * question the importer needs answered is "may I add these four hundred", and
 * asking four hundred separate times would let it stop halfway and leave a
 * half-imported organisation behind.
 */
export function checkSeats(sub: SubscriptionSnapshot, used: number, adding: number): SeatCheck {
  const limit = seatLimit(sub);
  if (limit === null) {
    return { allowed: true, limit: null, used, remaining: null };
  }

  const remaining = Math.max(0, limit - used);
  if (used + adding <= limit) {
    return { allowed: true, limit, used, remaining };
  }

  const plan = planFor(sub.plan);
  return {
    allowed: false,
    limit,
    used,
    remaining,
    // Names the numbers rather than saying "limit reached": somebody who has
    // just tried to import a spreadsheet needs to know how many of their rows
    // will fit before they go and edit the file.
    reason:
      `The ${plan.name} plan covers ${limit} employees and you have ${used}. ` +
      `Adding ${adding} would take you to ${used + adding}. ` +
      (remaining > 0
        ? `There ${remaining === 1 ? "is" : "are"} ${remaining} seat${remaining === 1 ? "" : "s"} left — upgrade your plan to add more.`
        : "Upgrade your plan to add more."),
  };
}

/** The monthly bill for a headcount, in paise. */
export function monthlyTotalMinor(plan: Plan, employees: number): number {
  return plan.pricePerEmployeeMinor * Math.max(0, employees);
}

/** When a trial started now would end. */
export function trialEndsAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + TRIAL_DAYS * 86_400_000);
}
