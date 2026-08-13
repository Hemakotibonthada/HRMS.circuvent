// ═══════════════════════════════════════════════════════════════
// REFERRAL INVITE EMAIL
// ═══════════════════════════════════════════════════════════════
// The message a referred candidate receives. Written for someone who does not
// work here, did not ask for this, and may not recognise the company name —
// so it leads with who referred them, which is the only part they will
// recognise.
//
// Sending is best-effort by design, and the caller is expected to treat it
// that way: a referral that is recorded but whose email bounced is a
// recoverable problem a recruiter can see and act on. A referral that failed
// to record because an email provider was down is lost work.

import { transportFor } from "@/lib/notifications/transport";

export interface InviteEmailInput {
  to: string;
  candidateName: string;
  referrerName?: string;
  organizationName: string;
  positionTitle: string;
  url: string;
  expiresAt: string;
}

function escapeHtml(value: string): string {
  // The candidate's name and the role both come from whatever the referrer
  // typed. Interpolating that into HTML unescaped is a script injection into
  // an email — and into the inbox of someone outside the company.
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function expiryWords(expiresAt: string): string {
  const days = Math.max(
    1,
    Math.round((new Date(expiresAt).getTime() - Date.now()) / 86_400_000)
  );
  return days === 1 ? "1 day" : `${days} days`;
}

export function buildInviteEmail(input: InviteEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const who = input.referrerName
    ? `${input.referrerName} has referred you`
    : "You have been referred";

  const subject = input.referrerName
    ? `${input.referrerName} referred you to ${input.organizationName}`
    : `You have been referred to ${input.organizationName}`;

  const text = [
    `Hello ${input.candidateName},`,
    "",
    `${who} for the ${input.positionTitle} role at ${input.organizationName}.`,
    "",
    "If you are interested, add your details here:",
    input.url,
    "",
    `The link works for the next ${expiryWords(input.expiresAt)} and can be used once.`,
    "",
    "Only your name and email are needed — everything else is optional.",
    "",
    "If this is not for you, you can ignore this message and nothing further will happen.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#10111a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;padding:32px;">
      <p style="margin:0 0 16px;font-size:16px;">Hello ${escapeHtml(input.candidateName)},</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">
        ${escapeHtml(who)} for the <strong>${escapeHtml(input.positionTitle)}</strong> role at
        <strong>${escapeHtml(input.organizationName)}</strong>.
      </p>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
        If you are interested, add your details using the button below.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${escapeHtml(input.url)}"
           style="display:inline-block;background:#783ff5;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;">
          Add my details
        </a>
      </p>
      <p style="margin:0 0 16px;font-size:14px;color:#535461;line-height:1.5;">
        The link works for the next ${escapeHtml(expiryWords(input.expiresAt))} and can be used once.
        Only your name and email are needed — everything else is optional.
      </p>
      <p style="margin:0;font-size:14px;color:#535461;line-height:1.5;">
        If this is not for you, ignore this message and nothing further will happen.
      </p>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

/**
 * Sends the invitation.
 *
 * Never throws. The referral is already recorded by the time this runs, and
 * losing that because an email provider timed out would be the worse
 * trade — the failure is returned so it can be stored against the invite and
 * shown to a recruiter.
 */
export async function sendInviteEmail(input: InviteEmailInput): Promise<{ error?: string }> {
  const transport = transportFor("email");
  if (!transport?.isConfigured()) {
    // Not an error worth failing the request over, but recorded rather than
    // swallowed: in development there is no provider, and a referral whose
    // invite silently never sent looks identical to one that did.
    return { error: "Email is not configured, so no invitation was sent" };
  }

  const { subject, text, html } = buildInviteEmail(input);

  try {
    const result = await transport.send(
      {
        subject,
        body: text,
        html,
        channel: "email",
      } as never,
      { userId: "external-candidate", email: input.to }
    );
    return result.ok ? {} : { error: result.error ?? "Delivery failed" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Delivery failed" };
  }
}
