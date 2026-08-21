// ═══════════════════════════════════════════════════════════════
// POST /api/billing/checkout
// ═══════════════════════════════════════════════════════════════
//
// Starts a payment for a plan. Returns an order the browser hands to
// Razorpay's checkout widget. Nothing is recorded as paid here — that waits
// for Razorpay to say so, through the webhook.
//
// The amount is computed on the server, from the plan and the tenant's own
// measured headcount, and never taken from the request. A price the client
// sends is a price the client chooses.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { loadSubscription } from "@/db/repositories/subscription.neon";
import { PLANS, monthlyTotalMinor, type PlanId } from "@/lib/billing/plans";
import {
  RazorpayError,
  createOrder,
} from "@/lib/billing/razorpay";
import { loadRazorpaySettings } from "@/db/repositories/platform-settings";
import { startRecurring } from "@/lib/billing/recurring";

const schema = z.object({
  plan: z.enum(["starter", "professional", "enterprise"]),
  /**
   * How they want to pay.
   *
   * Defaults to the one-off order this endpoint has always created, so an
   * older client that sends only a plan keeps working exactly as before.
   */
  mode: z.enum(["one_off", "recurring"]).optional().default("one_off"),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // Only the people who can commit the company to a bill.
  if (!["owner", "admin"].includes(ctx.role)) {
    return NextResponse.json(
      { error: "Only an owner or administrator can change the plan" },
      { status: 403 }
    );
  }

  const limit = checkRateLimit(`checkout:${clientIdentifier(request, ctx.userId)}`, 20, 60 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const settings = await loadRazorpaySettings();
  if (!settings || !settings.enabled) {
    // Said plainly rather than failing obscurely. This is the normal state of
    // a deployment until a merchant account exists, and whoever reads it
    // needs to know it is configuration and not a fault.
    return NextResponse.json(
      {
        error: settings
          ? "Payments are switched off for this deployment. Turn them on in Settings → Billing."
          : "Payments are not set up on this deployment. Add the Razorpay keys in Settings → Billing.",
      },
      { status: 503 }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose one of the available plans" }, { status: 400 });
  }

  const plan = PLANS[parsed.data.plan as PlanId];
  const view = await loadSubscription(ctx);

  // Billed on measured headcount, not on what the plan allows and not on
  // anything the caller sent. A company of nine on a plan that covers
  // twenty-five pays for nine.
  const employees = Math.max(1, view?.employeesUsed ?? 1);
  const amountMinor = monthlyTotalMinor(plan, employees);

  // ── Recurring ────────────────────────────────────────────────
  // The tenant authorises a mandate once and Razorpay collects every month.
  // The plan is priced per seat and the subscription carries the headcount as
  // its quantity, so the amount tracks hiring without cancelling anything.
  if (parsed.data.mode === "recurring") {
    try {
      const { subscriptionId, planId } = await startRecurring({
        creds: settings,
        orgId: ctx.orgId,
        plan,
        employees,
      });

      return NextResponse.json({
        mode: "recurring",
        // The widget opens on a subscription id rather than an order id; the
        // customer is authorising future collection, not paying once.
        subscription: { id: subscriptionId },
        keyId: settings.keyId,
        plan: { id: plan.id, name: plan.name },
        employees,
        amountMinor,
        customer: { email: ctx.email ?? undefined },
      });
    } catch (error) {
      if (error instanceof RazorpayError) {
        console.error("Razorpay subscription failed:", error.message);
        return NextResponse.json(
          { error: error.message },
          { status: error.status >= 500 ? 502 : 400 }
        );
      }
      console.error("Recurring checkout failed:", error);
      return NextResponse.json({ error: "Could not start the subscription." }, { status: 500 });
    }
  }

  try {
    const order = await createOrder(settings, {
      amountMinor,
      currency: plan.currency,
      // Ties the payment back to the tenant and the moment, so somebody
      // reconciling a Razorpay dashboard against this database has something
      // to match on that is not a uuid.
      receipt: `${ctx.orgId.slice(0, 8)}-${plan.id}-${Date.now().toString(36)}`,
      notes: { orgId: ctx.orgId, plan: plan.id, employees: String(employees) },
    });

    return NextResponse.json({
      mode: "one_off",
      order: { id: order.id, amount: order.amount, currency: order.currency },
      // The publishable half of the key pair. The secret never leaves the
      // server; this one is designed to sit in a browser.
      keyId: settings.keyId,
      plan: { id: plan.id, name: plan.name },
      employees,
      amountMinor,
      /*
       * Handed to the checkout widget so the customer is not asked to retype
       * an address this server already has. Without it Razorpay opens on a
       * contact form rather than the payment methods — a needless step
       * between deciding to pay and paying, and a common place to give up.
       */
      customer: { email: ctx.email ?? undefined },
    });
  } catch (error) {
    if (error instanceof RazorpayError) {
      console.error("Razorpay order failed:", error.message);
      return NextResponse.json(
        { error: error.message },
        { status: error.status >= 500 ? 502 : 400 }
      );
    }
    console.error("Checkout failed:", error);
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 500 });
  }
}
