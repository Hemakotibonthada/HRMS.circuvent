import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { statusForEvent, verifyPaymentSignature, verifyWebhookSignature } from "./razorpay";

/**
 * The webhook is what actually moves a subscription to paid, and it is
 * unauthenticated by design — Razorpay has no session here. Its signature is
 * the entire authentication, so these are the tests that matter most in
 * billing.
 */

const SECRET = "whsec_example_secret";

const sign = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body).digest("hex");

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ event: "payment.captured", payload: {} });

  it("accepts a signature made with the shared secret", () => {
    expect(
      verifyWebhookSignature({ rawBody: body, signature: sign(body), secret: SECRET })
    ).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    expect(
      verifyWebhookSignature({ rawBody: body, signature: sign(body, "wrong"), secret: SECRET })
    ).toBe(false);
  });

  it("rejects a body that has been altered after signing", () => {
    /*
     * The attack this exists to stop: a real captured-payment event, replayed
     * with someone else's orgId in the notes, would otherwise mark a
     * different tenant as paid.
     */
    const signature = sign(body);
    const tampered = JSON.stringify({ event: "payment.captured", payload: { x: 1 } });
    expect(verifyWebhookSignature({ rawBody: tampered, signature, secret: SECRET })).toBe(false);
  });

  it("is not fooled by whitespace differences in the same JSON", () => {
    // Which is why the route reads the raw text and never re-serialises:
    // JSON.parse followed by JSON.stringify reorders keys and drops spacing,
    // and the signature is over the bytes that arrived.
    const signature = sign(body);
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyWebhookSignature({ rawBody: reserialised, signature, secret: SECRET })).toBe(false);
  });

  it("refuses rather than throwing on a malformed or missing signature", () => {
    // timingSafeEqual throws on a length mismatch, which would turn a junk
    // signature into a 500 and a retry storm.
    expect(verifyWebhookSignature({ rawBody: body, signature: "", secret: SECRET })).toBe(false);
    expect(verifyWebhookSignature({ rawBody: body, signature: "abc", secret: SECRET })).toBe(false);
    expect(verifyWebhookSignature({ rawBody: body, signature: sign(body), secret: "" })).toBe(false);
  });
});

describe("verifyPaymentSignature", () => {
  const orderId = "order_ABC123";
  const paymentId = "pay_XYZ789";
  const good = createHmac("sha256", SECRET).update(`${orderId}|${paymentId}`).digest("hex");

  it("accepts Razorpay's own callback signature", () => {
    expect(
      verifyPaymentSignature({ orderId, paymentId, signature: good, keySecret: SECRET })
    ).toBe(true);
  });

  it("rejects a browser that simply claims success", () => {
    // The client reports its own outcome, so it cannot be believed on its
    // own; this signature is what makes the claim checkable.
    expect(
      verifyPaymentSignature({ orderId, paymentId, signature: "made-up", keySecret: SECRET })
    ).toBe(false);
  });

  it("rejects a signature lifted from a different order", () => {
    expect(
      verifyPaymentSignature({
        orderId: "order_OTHER",
        paymentId,
        signature: good,
        keySecret: SECRET,
      })
    ).toBe(false);
  });
});

describe("statusForEvent", () => {
  it("marks a captured payment active", () => {
    expect(statusForEvent("payment.captured")).toBe("active");
    expect(statusForEvent("subscription.charged")).toBe("active");
  });

  it("marks a failure past due rather than cancelled", () => {
    /*
     * A failed payment starts a conversation; it does not end the
     * relationship. Locking a company out of its own HR records the morning a
     * card expires is not a decision anybody made deliberately.
     */
    expect(statusForEvent("payment.failed")).toBe("past_due");
    expect(statusForEvent("subscription.halted")).toBe("past_due");
  });

  it("marks an explicit cancellation cancelled", () => {
    expect(statusForEvent("subscription.cancelled")).toBe("cancelled");
  });

  it("has no opinion about events it does not handle", () => {
    // The route acknowledges these with a 200 so Razorpay stops retrying
    // them, rather than refusing and being sent them forever.
    expect(statusForEvent("order.paid")).toBeNull();
    expect(statusForEvent("")).toBeNull();
    expect(statusForEvent("something.new")).toBeNull();
  });
});
