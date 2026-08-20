// ═══════════════════════════════════════════════════════════════
// POST /api/billing/webhook
// ═══════════════════════════════════════════════════════════════
//
// Razorpay telling us what actually happened.
//
// This, not the browser, is what moves a subscription to active. A checkout
// that reports success in the client and never reaches here has not been
// paid for — the page can be closed, the network can drop, and a determined
// caller can simply post the success themselves. Money is recorded on the
// word of the payment processor, verified by signature.
//
// Unauthenticated by design: Razorpay has no session here. The signature is
// the authentication, which is why `verifyWebhookSignature` is written out in
// `lib/billing/razorpay.ts` rather than delegated, and why the raw body is
// read as text — re-serialising the JSON would reorder keys and invalidate a
// signature taken over the bytes that arrived.

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { subscriptions } from "@/db/schema/identity";
import { statusForEvent, verifyWebhookSignature } from "@/lib/billing/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // Refused rather than accepted unverified. An endpoint that writes
    // subscription status and cannot check who is calling it is worse than
    // one that is switched off.
    return NextResponse.json(
      { error: "RAZORPAY_WEBHOOK_SECRET is not configured; webhooks are refused." },
      { status: 503 }
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";

  if (!verifyWebhookSignature({ rawBody, signature, secret })) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: {
    event?: string;
    payload?: {
      payment?: { entity?: { notes?: Record<string, string>; order_id?: string; id?: string } };
      subscription?: { entity?: { notes?: Record<string, string>; id?: string } };
    };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Body is not valid JSON" }, { status: 400 });
  }

  const event = payload.event ?? "";
  const status = statusForEvent(event);

  // Acknowledged, not refused. Razorpay retries anything it does not get a
  // 2xx for, and an event this product does not care about would otherwise be
  // redelivered forever.
  if (!status) {
    return NextResponse.json({ ok: true, ignored: event });
  }

  const notes =
    payload.payload?.payment?.entity?.notes ?? payload.payload?.subscription?.entity?.notes ?? {};
  const orgId = notes.orgId;

  if (!orgId) {
    // Also acknowledged: a payment created outside this application — a
    // manual charge in the Razorpay dashboard — has no tenant to attribute
    // to, and retrying it will never produce one.
    console.warn("[billing] webhook with no orgId in notes", { event });
    return NextResponse.json({ ok: true, unattributed: true });
  }

  const externalPaymentId =
    payload.payload?.payment?.entity?.id ?? payload.payload?.subscription?.entity?.id ?? null;

  try {
    await db().transaction(async (tx) => {
      // Superuser scope: Razorpay is not a tenant, so there is no session to
      // derive row-level security from. The organisation is taken from the
      // signed payload, which is the only reason that is safe.
      await tx.execute(`SET LOCAL app.superuser = 'on'`);

      const now = new Date();
      await tx
        .update(subscriptions)
        .set({
          status,
          ...(status === "active"
            ? {
                // A paid period starts now and runs a month. Written only on
                // success, so a failed payment never extends anybody's access.
                currentPeriodStart: now,
                currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
                cancelledAt: null,
              }
            : {}),
          ...(status === "cancelled" ? { cancelledAt: now } : {}),
          ...(externalPaymentId ? { externalSubscriptionId: externalPaymentId } : {}),
          updatedAt: now,
        })
        .where(eq(subscriptions.orgId, orgId));
    });
  } catch (error) {
    console.error("[billing] webhook could not be applied", { event, orgId, error });
    // A 500 asks Razorpay to retry, which is what we want for a database
    // blip: the event is real and has not been recorded.
    return NextResponse.json({ error: "Could not record this event" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, event, status });
}
