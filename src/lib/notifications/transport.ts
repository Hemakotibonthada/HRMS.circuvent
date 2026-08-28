// ═══════════════════════════════════════════════════════════════
// NOTIFICATION TRANSPORTS
// ═══════════════════════════════════════════════════════════════
// Delivery. The engine in ./engine.ts decides what to send and when; this
// actually sends it.
//
// Every transport is optional and fails independently. A missing SMS provider
// must not stop the email going out, and an email bounce must not lose the
// in-app record — that record is the audit trail of what the system told
// someone, and it is the one channel that has to survive.
//
// Transports are looked up rather than imported directly so a test can
// substitute a fake, and so a channel with no configured provider degrades to
// a no-op instead of throwing at import time.

import type { Channel, DispatchDecision } from "./engine";
import { mailConfigured, sendMail } from "@/lib/mailer";

export interface DeliveryResult {
  channel: Channel;
  ok: boolean;
  error?: string;
  /** Provider-side id, for tracing a complaint back to a specific send. */
  externalId?: string;
}

export interface Recipient {
  userId: string;
  email?: string;
  phone?: string;
  /** Expo push tokens; a user may be signed in on several devices. */
  pushTokens?: string[];
}

export interface Transport {
  channel: Channel;
  /** False when the provider is not configured; the channel is then skipped. */
  isConfigured(): boolean;
  send(decision: DispatchDecision, recipient: Recipient): Promise<DeliveryResult>;
}

// ─── Email (SMTP, via src/lib/mailer.ts) ─────────────────────

/**
 * Email, over the same SMTP path as every other message this product sends.
 *
 * This used to POST to the Resend API and gate itself on `RESEND_API_KEY`,
 * which left two unrelated mail systems in one product. `mailer.ts` states the
 * position plainly — "There is no third-party sending service ... routing it
 * through an external provider is how the storefront ended up silently
 * dropping every verification code" — and password resets and offer letters
 * already go through it.
 *
 * The practical cost of the split was worse than the inconsistency. The
 * notification engine was wired to nothing, so nobody had noticed that
 * `RESEND_API_KEY` appears in no example configuration and no deployment
 * document. The first leave approval routed through here would have found the
 * transport unconfigured and sent nothing at all — the exact failure the
 * comment in `mailer.ts` was written about.
 *
 * The HTML and plain-text builders are unchanged; only the wire is.
 */
class EmailTransport implements Transport {
  readonly channel: Channel = "email";

  isConfigured(): boolean {
    return mailConfigured();
  }

  async send(decision: DispatchDecision, recipient: Recipient): Promise<DeliveryResult> {
    if (!recipient.email) {
      return { channel: "email", ok: false, error: "Recipient has no email address" };
    }

    try {
      const ok = await sendMail({
        to: recipient.email,
        subject: decision.subject,
        text: buildPlainText(decision),
        html: buildHtml(decision),
      });

      return ok
        ? { channel: "email", ok: true }
        : { channel: "email", ok: false, error: "The mail server rejected the message" };
    } catch (error) {
      return { channel: "email", ok: false, error: describe(error) };
    }
  }
}


// ─── Push (Expo) ─────────────────────────────────────────────

class PushTransport implements Transport {
  readonly channel: Channel = "push";

  isConfigured(): boolean {
    // Expo's push endpoint accepts unauthenticated sends for tokens it issued,
    // so this is enabled unless explicitly switched off.
    return process.env.EXPO_PUSH_ENABLED !== "false";
  }

  async send(decision: DispatchDecision, recipient: Recipient): Promise<DeliveryResult> {
    const tokens = recipient.pushTokens ?? [];
    if (tokens.length === 0) {
      return { channel: "push", ok: false, error: "Recipient has no registered devices" };
    }

    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(
          tokens.map((to) => ({
            to,
            title: decision.subject,
            // Push notifications are truncated by the OS anyway, and a wall of
            // text in a banner is unreadable.
            body: truncate(decision.body, 178),
            data: { url: decision.actionUrl, type: decision.type },
            priority: decision.priority === "critical" ? "high" : "normal",
            // Critical alerts bypass the OS summary so they are seen.
            ...(decision.priority === "critical" ? { sound: "default" } : {}),
          }))
        ),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        return { channel: "push", ok: false, error: `Expo responded ${response.status}` };
      }

      const json = (await response.json()) as { data?: { status: string; id?: string }[] };
      const delivered = json.data?.filter((d) => d.status === "ok") ?? [];

      // Partial success is still success: one stale token on an old device
      // must not mark the whole notification as failed.
      return {
        channel: "push",
        ok: delivered.length > 0,
        externalId: delivered[0]?.id,
        error:
          delivered.length === tokens.length
            ? undefined
            : `${tokens.length - delivered.length} of ${tokens.length} device(s) rejected`,
      };
    } catch (error) {
      return { channel: "push", ok: false, error: describe(error) };
    }
  }
}

// ─── In-app ──────────────────────────────────────────────────

/**
 * The in-app record.
 *
 * Always configured, and written by the caller inside the same transaction as
 * the change that triggered it, so the notification cannot exist without the
 * event or vice versa. This transport is therefore a no-op that reports
 * success — it exists so the channel appears in delivery results alongside the
 * others rather than being a special case everywhere.
 */
class InAppTransport implements Transport {
  readonly channel: Channel = "in_app";
  isConfigured(): boolean {
    return true;
  }
  async send(): Promise<DeliveryResult> {
    return { channel: "in_app", ok: true };
  }
}

// ─── Registry ────────────────────────────────────────────────

const TRANSPORTS: Transport[] = [new InAppTransport(), new EmailTransport(), new PushTransport()];

export function transportFor(channel: Channel): Transport | null {
  return TRANSPORTS.find((t) => t.channel === channel) ?? null;
}

/**
 * Delivers one notification over every channel it was planned for.
 *
 * Channels are attempted in parallel and independently: a failure on one is
 * recorded and the rest still go. Returning results rather than throwing lets
 * the caller log which channels worked without having to decide whether a
 * partial delivery counts as an error.
 */
export async function deliver(
  decision: DispatchDecision,
  recipient: Recipient
): Promise<DeliveryResult[]> {
  if (decision.suppressedReason) return [];

  const attempts = decision.channels.map(async (channel): Promise<DeliveryResult> => {
    const transport = transportFor(channel);

    if (!transport) {
      return { channel, ok: false, error: `No transport implements ${channel}` };
    }
    if (!transport.isConfigured()) {
      // Not an error: a tenant without an SMS provider simply does not get SMS.
      return { channel, ok: false, error: `${channel} is not configured` };
    }

    try {
      return await transport.send(decision, recipient);
    } catch (error) {
      // A transport that throws instead of returning must not take down the
      // batch.
      return { channel, ok: false, error: describe(error) };
    }
  });

  return Promise.all(attempts);
}

// ─── Helpers ─────────────────────────────────────────────────

function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "Provider did not respond within 10s";
  }
  return error instanceof Error ? error.message : String(error);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Escapes HTML so a name like `O'Brien & Co <script>` cannot inject markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPlainText(decision: DispatchDecision): string {
  const url = decision.actionUrl
    ? `\n\n${new URL(decision.actionUrl, "https://hrms.circuvent.com").toString()}`
    : "";
  // A plain-text part is always sent: some clients prefer it, and an
  // HTML-only message scores worse with spam filters.
  return `${decision.body}${url}\n\n— Circuvent HRMS`;
}

function buildHtml(decision: DispatchDecision): string {
  const link = decision.actionUrl
    ? `<p style="margin:24px 0"><a href="${escapeHtml(
        new URL(decision.actionUrl, "https://hrms.circuvent.com").toString()
      )}" style="background:#8b5cf6;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open HRMS</a></p>`
    : "";

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f8;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;padding:28px">
<h1 style="margin:0 0 12px;font-size:18px;font-weight:600">${escapeHtml(decision.subject)}</h1>
<p style="margin:0;font-size:14px;line-height:1.6;white-space:pre-line">${escapeHtml(decision.body)}</p>
${link}
<p style="margin:24px 0 0;font-size:12px;color:#71717a">Circuvent HRMS · You can change which notifications you receive in Settings.</p>
</div></body></html>`;
}
