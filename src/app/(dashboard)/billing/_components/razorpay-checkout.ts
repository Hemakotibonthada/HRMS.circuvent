// ═══════════════════════════════════════════════════════════════
// Razorpay checkout, in the browser
// ═══════════════════════════════════════════════════════════════
//
// The order created by /api/billing/checkout is only half of a payment. This
// is the half that asks the customer for money: Razorpay's hosted widget,
// which handles the card form, UPI, netbanking and 3-D Secure so that no card
// number ever touches this application.
//
// Nothing here is trusted. The widget's success callback is a browser telling
// us it succeeded, and a browser can say anything — so the result is posted to
// /api/billing/verify, which recomputes the HMAC with the key secret before
// anything is recorded. The callback is a prompt to go and check, not proof.

/** The subset of the widget's interface this application uses. */
interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpayHandlerResponse) => void;
  prefill?: { name?: string; email?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
}

export interface RazorpayHandlerResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/**
 * Loads the widget once and reuses it.
 *
 * Kept as a module-level promise rather than a boolean: two upgrade clicks in
 * quick succession would otherwise start two downloads, and the second could
 * resolve before the first had finished defining `window.Razorpay`.
 */
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Checkout can only be opened in a browser"));
  }
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const el = existing ?? document.createElement("script");
    el.src = SCRIPT_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      // Cleared so a later attempt can retry. A cached rejected promise would
      // make one flaky network moment permanent for the rest of the session.
      scriptPromise = null;
      reject(new Error("Could not load the payment window. Check your connection and try again."));
    };
    if (!existing) document.body.appendChild(el);
  });

  return scriptPromise;
}

export interface CheckoutOrder {
  order: { id: string; amount: number; currency: string };
  keyId: string;
  plan: { id: string; name: string };
}

export interface CheckoutOutcome {
  status: "paid" | "pending" | "dismissed" | "failed";
  message?: string;
}

/**
 * Opens the payment window and resolves once the customer is done with it.
 *
 * The three outcomes are all normal. `dismissed` means they closed it without
 * paying, which is not an error and must not be reported as one — the most
 * common reason to close a payment window is deciding not to pay just yet.
 */
export async function openCheckout(
  data: CheckoutOrder,
  customer: { name?: string; email?: string }
): Promise<CheckoutOutcome> {
  await loadScript();

  const Ctor = window.Razorpay;
  if (!Ctor) throw new Error("The payment window did not load. Please try again.");

  return new Promise<CheckoutOutcome>((resolve) => {
    /*
     * Guards the resolve. Razorpay can fire `payment.failed` and then the
     * dismiss handler for the same attempt, and the second would otherwise
     * overwrite a real failure message with a bare "dismissed".
     */
    let settled = false;
    const settle = (outcome: CheckoutOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const instance = new Ctor({
      key: data.keyId,
      amount: data.order.amount,
      currency: data.order.currency,
      name: "Circuvent",
      description: `${data.plan.name} plan`,
      order_id: data.order.id,
      prefill: { name: customer.name, email: customer.email },
      notes: { plan: data.plan.id },
      theme: { color: "#7c3aed" },
      modal: {
        ondismiss: () => settle({ status: "dismissed" }),
      },
      handler: (response) => {
        // Confirmed server-side before anything is treated as paid.
        void (async () => {
          try {
            const res = await fetch("/api/billing/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              // Posted exactly as Razorpay handed it over. The route reads
              // Razorpay's own field names, so there is nothing to rename and
              // no chance of renaming it wrongly.
              body: JSON.stringify(response),
              });
            const body = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              pending?: boolean;
              error?: string;
            };

            // `ok` decides, not the status class: a payment that has not
            // settled comes back 202, which would otherwise read as success.
            if (body.pending) {
              settle({
                status: "pending",
                message: body.error ?? "Payment received. It will be applied shortly.",
              });
              return;
            }

            if (!res.ok || !body.ok) {
              settle({
                status: "failed",
                message:
                  body.error ??
                  // The money may well have left their account. Saying
                  // "payment failed" here would be a guess, and the wrong one
                  // often enough to matter — the webhook still settles it.
                  "We could not confirm the payment. If you were charged, it will be reconciled shortly.",
              });
              return;
            }
            settle({ status: "paid" });
          } catch {
            settle({
              status: "failed",
              message:
                "Payment went through but the confirmation did not reach us. It will be reconciled shortly.",
            });
          }
        })();
      },
    });

    instance.on("payment.failed", (payload) => {
      const description =
        typeof payload === "object" && payload !== null && "error" in payload
          ? (payload as { error?: { description?: string } }).error?.description
          : undefined;
      settle({ status: "failed", message: description ?? "The payment did not go through." });
    });

    instance.open();
  });
}
