// ═══════════════════════════════════════════════════════════════
// GET /api/billing/subscription
// ═══════════════════════════════════════════════════════════════
//
// What this tenant is actually on, measured rather than asserted.
//
// The billing screen used to read `SUBSCRIPTION_PLANS[1] // Professional`, so
// every organisation on every deployment was shown the Professional plan and
// its price whether or not anybody had agreed to either. There was no billing
// route at all for it to call instead. This is that route.
//
// A tenant with no subscription row gets `subscription: null` rather than an
// invented one. Organisations created before sign-up started provisioning a
// trial genuinely have none, and showing them a plan they were never sold is
// the exact problem this replaces.

import { NextResponse, type NextRequest } from "next/server";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { loadSubscription, startTrialIfMissing } from "@/db/repositories/subscription.neon";
import { PLAN_LIST } from "@/lib/billing/plans";

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // An organisation that predates subscriptions is given its trial the first
  // time somebody opens billing, rather than by a migration that would start
  // a fourteen-day clock on every dormant tenant at once.
  if (["owner", "admin"].includes(ctx.role)) {
    await startTrialIfMissing(ctx);
  }

  const subscription = await loadSubscription(ctx);

  return NextResponse.json({
    subscription,
    // The catalogue travels with the answer so the screen has one source for
    // both what the tenant is on and what it could move to.
    plans: PLAN_LIST,
  });
}
