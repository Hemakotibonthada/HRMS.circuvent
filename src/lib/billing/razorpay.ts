// ═══════════════════════════════════════════════════════════════
// RAZORPAY
// ═══════════════════════════════════════════════════════════════
//
// Taking money. Razorpay rather than Stripe because the company, its
// customers and every amount in this product are Indian, and Stripe's India
// support for recurring domestic cards is not something to build a first
// revenue line on.
//
// ── Why the REST API and not the SDK ──
// Everything used here is four HTTP calls and one HMAC. The SDK would add a
// dependency to the deployment for that, and — more to the point — webhook
// signature verification is the one piece of this that must be right, so it
// is written here where it can be read and tested rather than trusted to a
// wrapper.
//
// ── Why this degrades instead of throwing at import ──
// A deployment with no Razorpay keys is the normal state of every developer
// machine and of this product until a merchant account exists. Reading the
// keys lazily and reporting "not configured" keeps the rest of billing —
// plans, trials, seat limits — working on a deployment that cannot yet
// charge anybody, instead of taking the process down at boot.

import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.razorpay.com/v1";

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
}

/**
 * The keys from the environment, or null.
 *
 * Kept because a deployment configured before the settings table existed must
 * keep working, but it is no longer the only source — see
 * `loadRazorpaySettings` in `db/repositories/platform-settings.ts`, which reads
 * the database first and falls back to this. Anything that needs credentials
 * should take them as an argument rather than reaching for the environment, so
 * one lookup decides for the whole request.
 */
export function razorpayCredentialsFromEnv(): RazorpayCredentials | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "RazorpayError";
  }
}

async function call<T>(
  creds: RazorpayCredentials,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown }
): Promise<T> {
  const auth = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");
  const response = await fetch(`${API}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    // Razorpay's own message, not a generic one: "amount must be at least
    // 100" tells an operator what to change, "payment failed" does not.
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { error?: { description?: string } };
      if (parsed.error?.description) detail = parsed.error.description;
    } catch {
      // Non-JSON error body; the raw text is more useful than nothing.
    }
    throw new RazorpayError(detail, response.status);
  }

  return JSON.parse(text) as T;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
  notes?: Record<string, string>;
}

/**
 * Re-reads an order from Razorpay.
 *
 * This is how the server learns what was actually bought. The browser reports
 * a payment and is believed only as far as the signature goes — and the
 * signature covers `order_id|payment_id`, nothing else. It says a real payment
 * happened against a real order; it says nothing about which plan.
 *
 * Taking the plan from the request body instead would let somebody check out
 * for Starter, pay Starter's price legitimately, and post back "enterprise"
 * with a perfectly valid signature. The notes were written by this server when
 * the order was created, so reading them back is the only account of the
 * purchase the customer never had a chance to edit.
 */
export async function fetchOrder(
  creds: RazorpayCredentials,
  orderId: string
): Promise<RazorpayOrder> {
  return call<RazorpayOrder>(creds, `/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
}

/**
 * An order for one period's subscription fee.
 *
 * A one-off order per period rather than a Razorpay Subscription with a
 * saved mandate: seat-based pricing changes the amount every month as a
 * company hires, and a fixed mandate would either undercharge a growing
 * customer or have to be cancelled and recreated at every headcount change.
 * Charging for the period that has just been counted is both simpler and
 * more defensible on an invoice.
 *
 * `amountMinor` is paise, matching every other amount in this codebase.
 */
export async function createOrder(
  creds: RazorpayCredentials,
  input: {
    amountMinor: number;
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
  }
): Promise<RazorpayOrder> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new RazorpayError("An order must be for a positive whole number of paise.", 400);
  }

  return call<RazorpayOrder>(creds, "/orders", {
    method: "POST",
    body: {
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
      // Razorpay captures automatically rather than leaving an authorised
      // payment for somebody to capture by hand and forget about.
      payment_capture: 1,
    },
  });
}

/**
 * Confirms the credentials actually work, by asking Razorpay something.
 *
 * A settings screen that stores a key and says "saved" has proved nothing —
 * the first anybody would learn of a typo is a customer failing to check out.
 * This fetches the payments list with a limit of one: the lightest authenticated
 * call Razorpay offers, and a 401 from it is unambiguous.
 */
export async function verifyCredentials(
  creds: RazorpayCredentials
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await call<unknown>(creds, "/payments?count=1", { method: "GET" });
    return { ok: true };
  } catch (error) {
    if (error instanceof RazorpayError) {
      const hint =
        error.status === 401
          ? "Razorpay rejected these credentials. Check the Key ID and Key Secret."
          : error.message;
      return { ok: false, error: hint };
    }
    return { ok: false, error: "Could not reach Razorpay. Check network access from this deployment." };
  }
}

/**
 * Whether a webhook really came from Razorpay.
 *
 * The whole security of the webhook rests on this. Razorpay signs the raw
 * request body with the webhook secret; the comparison is constant-time
 * because a byte-by-byte early return leaks, over enough attempts, which
 * prefix of a forged signature was correct.
 *
 * The *raw* body must be passed — not a re-serialised object. `JSON.parse`
 * followed by `JSON.stringify` reorders keys and drops whitespace, and the
 * signature is over the bytes that arrived.
 */
export function verifyWebhookSignature(input: {
  rawBody: string;
  signature: string;
  secret: string;
}): boolean {
  if (!input.signature || !input.secret) return false;

  const expected = createHmac("sha256", input.secret).update(input.rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(input.signature, "utf8");

  // `timingSafeEqual` throws rather than returning false on a length
  // mismatch, which would turn a malformed signature into a 500.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Whether a completed checkout is genuine.
 *
 * The browser reports its own success, so it cannot be believed on its own:
 * the signature Razorpay returns alongside is over `order_id|payment_id`,
 * keyed with the API secret, and is what makes the claim checkable.
 */
export function verifyPaymentSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): boolean {
  if (!input.signature) return false;

  const expected = createHmac("sha256", input.keySecret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(input.signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The events worth acting on. Anything else is acknowledged and ignored. */
export type BillingWebhookEvent =
  | "payment.captured"
  | "payment.failed"
  | "subscription.charged"
  | "subscription.halted"
  | "subscription.cancelled";

/**
 * What a webhook event means for a subscription's status.
 *
 * Returned as a value rather than applied here, so the mapping can be tested
 * on its own and so the route stays responsible for writing.
 */
export function statusForEvent(
  event: string
): "active" | "past_due" | "cancelled" | null {
  switch (event) {
    case "payment.captured":
    case "subscription.charged":
      return "active";
    case "payment.failed":
    case "subscription.halted":
      // Not cancelled: a failed payment starts a conversation, it does not
      // end the relationship, and locking a company out of its own HR records
      // the morning a card expires is not a business decision anybody made.
      return "past_due";
    case "subscription.cancelled":
      return "cancelled";
    default:
      return null;
  }
}
