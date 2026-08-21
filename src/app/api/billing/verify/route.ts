// ═══════════════════════════════════════════════════════════════
// POST /api/billing/verify
// ═══════════════════════════════════════════════════════════════
//
// The step between "the customer paid" and "the customer is on the plan".
//
// It did not exist. Checkout created an order, the browser was told the order
// id, and nothing ever completed: no widget, no verification, no subscription
// change. A customer could have paid Razorpay and stayed on a trial.
//
// The webhook is the authoritative path — it arrives even if the browser is
// closed mid-payment — but it can be seconds or minutes late, and somebody who
// has just paid should not be left staring at an unchanged screen. So both
// exist and both are idempotent on the payment id: whichever lands first
// activates the subscription, the other finds it already recorded and does
// nothing.
//
// ── Why the signature matters here ──
//
// The browser reports the payment, and a browser is not trustworthy. Without a
// signature check anybody could POST an order id and a made-up payment id and
// grant themselves a plan. Razorpay signs `order_id|payment_id` with the key
// secret, which only the server holds, and that is what makes a
// client-reported success believable.
//
// ── Why the plan is not in the request ──
//
// The signature covers the order id and the payment id and nothing else. It
// proves a real payment against a real order; it proves nothing about what was
// bought. So the plan is read back from the order's notes, which this server
// wrote at checkout, rather than from the request body — otherwise a customer
// could check out for Starter, pay Starter's price, and post back "enterprise"
// with a signature that verifies perfectly.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { loadRazorpaySettings } from "@/db/repositories/platform-settings";
import { fetchOrder, verifyPaymentSignature, RazorpayError } from "@/lib/billing/razorpay";
import { activateSubscription, loadSubscription } from "@/db/repositories/subscription.neon";
import { PLANS, type PlanId } from "@/lib/billing/plans";

/**
 * Razorpay's own field names, exactly as its checkout widget hands them over.
 * Renaming them on the way in would mean the browser had to transform the
 * response before posting it, which is one more place to get it wrong.
 */
const schema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!["owner", "admin"].includes(ctx.role)) {
    return NextResponse.json(
      { error: "Only an owner or administrator can change the plan" },
      { status: 403 }
    );
  }

  const limit = checkRateLimit(`verify:${clientIdentifier(request, ctx.userId)}`, 20, 60 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Incomplete payment details" }, { status: 400 });
  }

  const settings = await loadRazorpaySettings();
  if (!settings) {
    return NextResponse.json({ error: "Payments are not configured." }, { status: 503 });
  }

  const valid = verifyPaymentSignature({
    orderId: parsed.data.razorpay_order_id,
    paymentId: parsed.data.razorpay_payment_id,
    signature: parsed.data.razorpay_signature,
    keySecret: settings.keySecret,
  });

  if (!valid) {
    // Logged, because a failure here is either a bug or somebody trying it on,
    // and both are worth seeing. The response says nothing about which.
    console.warn("Rejected a payment with an invalid signature", {
      orgId: ctx.orgId,
      orderId: parsed.data.razorpay_order_id,
    });
    return NextResponse.json({ error: "This payment could not be verified." }, { status: 400 });
  }

  // What was actually bought, according to the order this server created.
  let order;
  try {
    order = await fetchOrder(settings, parsed.data.razorpay_order_id);
  } catch (error) {
    const message =
      error instanceof RazorpayError
        ? error.message
        : "Could not confirm the order with Razorpay.";
    console.error("Could not re-read a paid order:", message);
    // The webhook is still coming and will settle it. Saying the payment
    // failed would be wrong — it succeeded, and only the confirmation is late.
    return NextResponse.json(
      { error: "Payment received, but we could not confirm it yet. It will be applied shortly." },
      { status: 502 }
    );
  }

  /*
   * The order has to belong to the organisation asking about it. A signature
   * verifies against the merchant key, not against a tenant, so without this
   * one customer's valid payment details could be replayed by another to claim
   * a plan they never paid for.
   */
  if (order.notes?.orgId && order.notes.orgId !== ctx.orgId) {
    console.warn("Rejected a payment belonging to another organisation", {
      orgId: ctx.orgId,
      orderOrgId: order.notes.orgId,
    });
    return NextResponse.json({ error: "This payment could not be verified." }, { status: 400 });
  }

  const paidPlan = order.notes?.plan;
  if (!paidPlan || !(paidPlan in PLANS)) {
    console.error("A paid order carried no recognisable plan", {
      orderId: order.id,
      plan: paidPlan,
    });
    return NextResponse.json(
      { error: "Payment received, but the plan could not be determined. Support has been notified." },
      { status: 502 }
    );
  }

  // Razorpay marks an order `paid` once the captured amount covers it. Acting
  // on anything else would grant a plan for a payment still in flight.
  //
  // Returned as 202 with `ok: false`: this is not a failure and not a success.
  // Callers must read `ok` rather than the status class, or a still-settling
  // payment reads as a completed one.
  if (order.status !== "paid") {
    return NextResponse.json(
      {
        ok: false,
        pending: true,
        error: "Payment received, but it has not settled yet. It will be applied shortly.",
      },
      { status: 202 }
    );
  }

  const result = await activateSubscription(ctx, {
    plan: paidPlan as PlanId,
    externalPaymentId: parsed.data.razorpay_payment_id,
    externalOrderId: parsed.data.razorpay_order_id,
  });

  return NextResponse.json({
    ok: true,
    // False when the webhook got here first. Not an error — the plan is active
    // either way, and saying so is more useful than pretending this call did it.
    activated: result.activated,
    subscription: await loadSubscription(ctx),
  });
}
