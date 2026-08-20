// ═══════════════════════════════════════════════════════════════
// MAIL SERVER — the three calls a mailbox move needs
// ═══════════════════════════════════════════════════════════════
// Mail.circuvent's admin API lives on the mail VM itself (mx.circuvent.com),
// authenticated with a bearer secret, and is the only way to change what
// Dovecot and Postfix believe. This module is HRMS's side of that.
//
// Modelled on ATS's `onboarding/mailbox.ts`, deliberately including its two
// hard-won conventions:
//
//   - The endpoint is `/api/mailboxes`. ATS previously posted to
//     `/api/admin/create-user` on the strength of a comment claiming HRMS did
//     the same; it did not, the path 404'd, and the 404 was retried five times
//     as though it were a transient failure.
//   - Not configured is not an error. A deployment without `MAIL_ADMIN_URL`
//     provisions mailboxes some other way, or not yet. That is `blocked` with
//     a reason, not `failed` — the difference between a fact somebody should
//     read and an error somebody should chase.
//
// ── Why there is no rename here ──
// Because the mail server has none. A Maildir path is derived from the
// address, so moving an address is create + delete + alias, and the alias
// endpoint refuses while the old address is still a real mailbox. Each step
// is exposed separately so the caller can resume from wherever it stopped
// rather than repeating one that already succeeded.

const TIMEOUT_MS = 45_000;

export type MailAdminStatus = "done" | "blocked" | "failed";

export interface MailAdminOutcome {
  status: MailAdminStatus;
  detail?: string;
}

interface MailAdminConfig {
  baseUrl: string;
  secret: string;
}

/**
 * Reads the configuration, or explains what is missing.
 *
 * `MAIL_SERVER_ADMIN_SECRET` is accepted as well as `MAIL_ADMIN_SECRET`
 * because the mail server's own service reads the former and both spellings
 * are in use across the suite's deployments.
 */
function config(): MailAdminConfig | { missing: string } {
  const baseUrl = process.env.MAIL_ADMIN_URL?.trim();
  const secret =
    process.env.MAIL_ADMIN_SECRET?.trim() || process.env.MAIL_SERVER_ADMIN_SECRET?.trim();

  if (!baseUrl) return { missing: "MAIL_ADMIN_URL is not set" };
  if (!secret) return { missing: "MAIL_ADMIN_SECRET is not set" };
  return { baseUrl: baseUrl.replace(/\/+$/, ""), secret };
}

async function call(
  path: string,
  method: string,
  body: Record<string, unknown>
): Promise<MailAdminOutcome> {
  const cfg = config();
  if ("missing" in cfg) return { status: "blocked", detail: cfg.missing };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.secret}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    if (response.ok) return { status: "done" };

    // 404 is a wrong path, not a transient fault — see the header. Reported as
    // blocked so a sweep records it once instead of retrying it forever.
    if (response.status === 404) {
      return { status: "blocked", detail: `${method} ${path} answered 404; the endpoint is wrong` };
    }
    return { status: "failed", detail: `${response.status}: ${text.slice(0, 300)}` };
  } catch (error) {
    const detail =
      error instanceof Error && error.name === "AbortError"
        ? `timed out after ${TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    return { status: "failed", detail };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Creates a mailbox, or confirms one already exists.
 *
 * Idempotent at the server: an address it already holds is reported as a
 * success rather than a conflict, so a retry after a partial run does not
 * fail on the step that had already worked.
 *
 * No password is supplied. The person sets their own when they claim the
 * mailbox; a password generated here would have to be transmitted somehow,
 * and every way of doing that is worse than not having one.
 */
export function createMailbox(email: string, quotaGB = 5): Promise<MailAdminOutcome> {
  return call("/api/mailboxes", "POST", { email, quotaGB });
}

/**
 * Removes a mailbox, keeping its stored mail.
 *
 * `purge` is deliberately not passed. The move this supports is somebody
 * keeping their job, not leaving it: deleting the Maildir would destroy the
 * correspondence the move exists to preserve.
 */
export function deleteMailbox(email: string): Promise<MailAdminOutcome> {
  return call("/api/mailboxes", "DELETE", { email });
}

/**
 * Points one address at another.
 *
 * Ordering matters and is not negotiable: the alias endpoint answers 409
 * while `alias` is still a real mailbox, so the old mailbox must be deleted
 * first. That is why the caller drives create → delete → alias in that order.
 */
export function createAlias(alias: string, target: string): Promise<MailAdminOutcome> {
  return call("/api/aliases", "POST", { alias, targets: [target] });
}

/** True when this deployment can talk to the mail server at all. */
export function mailAdminConfigured(): boolean {
  return !("missing" in config());
}
