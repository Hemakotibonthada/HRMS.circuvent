import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The verify route, which is what turns "the customer paid" into "the customer
 * is on the plan".
 *
 * Two of these tests exist because of bugs found by reading the code against
 * the browser that calls it:
 *
 *   1. The route expected `razorpayOrderId`; Razorpay's widget sends
 *      `razorpay_order_id`. Every real verification would have failed
 *      validation — and the failure would have looked like a payment problem.
 *
 *   2. The plan came from the request body. The signature covers the order id
 *      and payment id only, so a customer could check out for Starter, pay
 *      Starter's price, and post back `plan: "enterprise"` with a signature
 *      that verifies perfectly. The plan now comes from the order's notes,
 *      which the server wrote and the customer never saw.
 */

const ctx = { orgId: "org-1", userId: "user-1", role: "owner" as const, email: "a@b.com" };

const requireApiContext = vi.fn();
const loadRazorpaySettings = vi.fn();
const verifyPaymentSignature = vi.fn();
const fetchOrder = vi.fn();
const activateSubscription = vi.fn();
const loadSubscription = vi.fn();

vi.mock("@/lib/api-context", () => ({
  requireApiContext: (...args: unknown[]) => requireApiContext(...args),
  checkRateLimit: () => ({ allowed: true }),
  clientIdentifier: () => "test",
}));

vi.mock("@/lib/server-auth", () => ({
  authErrorResponse: () => ({ body: { error: "Unauthorized" }, status: 401 }),
}));

vi.mock("@/db/repositories/platform-settings", () => ({
  loadRazorpaySettings: () => loadRazorpaySettings(),
}));

vi.mock("@/lib/billing/razorpay", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/razorpay")>(
    "@/lib/billing/razorpay"
  );
  return {
    ...actual,
    verifyPaymentSignature: (...args: unknown[]) => verifyPaymentSignature(...args),
    fetchOrder: (...args: unknown[]) => fetchOrder(...args),
  };
});

vi.mock("@/db/repositories/subscription.neon", () => ({
  activateSubscription: (...args: unknown[]) => activateSubscription(...args),
  loadSubscription: (...args: unknown[]) => loadSubscription(...args),
}));

const { POST } = await import("./route");

/** A request shaped the way Razorpay's widget actually posts. */
function post(body: unknown) {
  return new Request("http://localhost/api/billing/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

const WIDGET_RESPONSE = {
  razorpay_order_id: "order_ABC",
  razorpay_payment_id: "pay_XYZ",
  razorpay_signature: "sig",
};

beforeEach(() => {
  requireApiContext.mockResolvedValue(ctx);
  loadRazorpaySettings.mockResolvedValue({
    keyId: "rzp_test_1",
    keySecret: "secret",
    webhookSecret: "whsec",
    mode: "test",
    enabled: true,
  });
  verifyPaymentSignature.mockReturnValue(true);
  fetchOrder.mockResolvedValue({
    id: "order_ABC",
    amount: 100000,
    currency: "INR",
    status: "paid",
    notes: { orgId: "org-1", plan: "starter", employees: "4" },
  });
  activateSubscription.mockResolvedValue({ activated: true });
  loadSubscription.mockResolvedValue({ plan: "starter" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/billing/verify", () => {
  it("accepts the field names Razorpay's widget actually sends", async () => {
    // The regression test for the mismatch. Had this route kept its camelCase
    // schema, this exact body — which is what the browser posts, verbatim —
    // would have been rejected as "Incomplete payment details".
    const res = await POST(post(WIDGET_RESPONSE));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, activated: true });
  });

  it("takes the plan from the order, not from the request", async () => {
    // The customer paid for starter, per the order's notes, and asks for
    // enterprise. The extra field is ignored entirely.
    const res = await POST(post({ ...WIDGET_RESPONSE, plan: "enterprise" }));

    expect(res.status).toBe(200);
    expect(activateSubscription).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ plan: "starter" })
    );
  });

  it("refuses a payment belonging to another organisation", async () => {
    fetchOrder.mockResolvedValue({
      id: "order_ABC",
      amount: 100000,
      currency: "INR",
      status: "paid",
      notes: { orgId: "someone-else", plan: "enterprise" },
    });

    const res = await POST(post(WIDGET_RESPONSE));

    expect(res.status).toBe(400);
    expect(activateSubscription).not.toHaveBeenCalled();
  });

  it("refuses a payment whose signature does not verify", async () => {
    verifyPaymentSignature.mockReturnValue(false);

    const res = await POST(post(WIDGET_RESPONSE));

    expect(res.status).toBe(400);
    expect(activateSubscription).not.toHaveBeenCalled();
    // Nothing is fetched either: an unverified payment is not worth an API call.
    expect(fetchOrder).not.toHaveBeenCalled();
  });

  it("does not activate an order that has not settled", async () => {
    fetchOrder.mockResolvedValue({
      id: "order_ABC",
      amount: 100000,
      currency: "INR",
      status: "created",
      notes: { orgId: "org-1", plan: "starter" },
    });

    const res = await POST(post(WIDGET_RESPONSE));

    expect(res.status).toBe(202);
    // `ok` must be false even though 202 is a success status — the browser
    // reads that flag, and a truthy one here would show "your plan is active"
    // for a payment still in flight.
    expect(await res.json()).toMatchObject({ ok: false, pending: true });
    expect(activateSubscription).not.toHaveBeenCalled();
  });

  it("refuses an order carrying no recognisable plan", async () => {
    fetchOrder.mockResolvedValue({
      id: "order_ABC",
      amount: 100000,
      currency: "INR",
      status: "paid",
      notes: { orgId: "org-1", plan: "platinum" },
    });

    const res = await POST(post(WIDGET_RESPONSE));

    expect(res.status).toBe(502);
    expect(activateSubscription).not.toHaveBeenCalled();
  });

  it("does not let an ordinary employee change the plan", async () => {
    requireApiContext.mockResolvedValue({ ...ctx, role: "employee" });

    const res = await POST(post(WIDGET_RESPONSE));

    expect(res.status).toBe(403);
    expect(activateSubscription).not.toHaveBeenCalled();
  });

  it("reports a payment it cannot confirm without claiming it failed", async () => {
    const { RazorpayError } = await import("@/lib/billing/razorpay");
    fetchOrder.mockRejectedValue(new RazorpayError("upstream down", 503));

    const res = await POST(post(WIDGET_RESPONSE));

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    // The wording matters. The money may have left their account; telling them
    // the payment failed would be a guess, and the wrong one.
    expect(body.error).toContain("Payment received");
    expect(activateSubscription).not.toHaveBeenCalled();
  });
});
