// ═══════════════════════════════════════════════════════════════
// DELIVERING TO A WEBHOOK
// ═══════════════════════════════════════════════════════════════
// Everything that leaves this application for a customer-supplied URL goes
// through here, so the safety rules are in one place rather than repeated at
// each call site — repeated rules are how one call site ends up without them.
//
// Four things this does that a bare fetch would not:
//
//   - refuses to send anywhere the endpoint check rejects, every time, not
//     only when the integration was first saved (DNS can change afterwards);
//   - signs the body, so the receiver can tell our messages from anyone
//     else's who has learned the URL;
//   - bounds the request in time, because a receiver that accepts the
//     connection and then never answers would otherwise hold a worker open;
//   - refuses to follow redirects, since a 302 to 169.254.169.254 would
//     otherwise walk straight past the check that was just done.

import { createHmac, timingSafeEqual } from "node:crypto";
import { checkEndpoint } from "./endpoint";

/** Long enough that a receiver on a slow link succeeds; short enough to bound a worker. */
const TIMEOUT_MS = 5_000;

/** A body large enough to be a mistake is a body we do not send. */
const MAX_BODY_BYTES = 256 * 1024;

export interface DeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface WebhookMessage {
  event: string;
  sentAt: string;
  data: Record<string, unknown>;
}

/**
 * The signature a receiver should check.
 *
 * `sha256=<hex>` over the exact bytes sent, keyed with the shared secret. The
 * timestamp is inside the signed body rather than only in a header, so a
 * captured message cannot be replayed later with a fresh timestamp bolted on.
 */
export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Constant-time comparison, for anything verifying one of our signatures. */
export function signatureMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function deliver(
  endpointUrl: string,
  message: WebhookMessage,
  secret: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryResult> {
  // Re-checked on every send, not just when the integration was saved. The
  // name may have been repointed at something internal since.
  const decision = await checkEndpoint(endpointUrl);
  if (!decision.ok) return { ok: false, error: decision.reason ?? "That endpoint is not allowed." };

  const body = JSON.stringify(message);
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    return { ok: false, error: "The payload is too large to send." };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "Circuvent-HRMS-Webhook/1",
    "x-circuvent-event": message.event,
  };
  if (secret) headers["x-circuvent-signature"] = signBody(body, secret);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

  try {
    const response = await fetchImpl(endpointUrl, {
      method: "POST",
      headers,
      body,
      signal: abort.signal,
      // A redirect is a second request to somewhere nothing has validated.
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: response.status, error: "The endpoint redirected, which is not followed." };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: `The endpoint answered ${response.status}.` };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: `No answer within ${TIMEOUT_MS / 1000} seconds.` };
    }
    return { ok: false, error: error instanceof Error ? error.message : "Delivery failed." };
  } finally {
    clearTimeout(timer);
  }
}
