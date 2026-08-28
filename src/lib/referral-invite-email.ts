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

/**
 * Absolute https URL for the logo. A relative path resolves against nothing in
 * an inbox and a data: URI is stripped by Gmail and Outlook, so this has to be
 * hosted. Read at call time, not module load, so a variable set later in a
 * serverless runtime is still picked up.
 */
function logoUrl(): string {
  const configured = process.env.MAIL_LOGO_URL?.trim();
  if (configured) return configured;
  const careers = process.env.NEXT_PUBLIC_CAREERS_URL?.trim() || "https://career.circuvent.com";
  return `${careers.replace(/\/$/, "")}/logo-mark-128.png`;
}

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
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f7;">
    <tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;">
      <tr>
        <td style="padding:22px 32px;background:linear-gradient(135deg,#7c3aed,#6d28d9);">
          <!--
            Logo beside a live-text wordmark, matching the ATS layout so a
            candidate who gets an invite here and an update from the ATS sees
            the same sender. Most clients block images by default, so a header
            that is only a picture arrives empty — the text carries the brand
            when the image does not load.

            The white tile is the cell rather than the image: the mark is a
            transparent PNG that loses contrast against this purple, and a
            background on an img element is composited unreliably by Outlook.
          -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td valign="middle" style="padding-right:12px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" valign="middle" bgcolor="#ffffff" style="width:40px;height:40px;background:#ffffff;border-radius:9px;padding:4px;">
                      <img src="${escapeHtml(logoUrl())}" width="32" height="32" alt="${escapeHtml(input.organizationName)}"
                           style="display:block;width:32px;height:32px;border:0;outline:none;text-decoration:none;">
                    </td>
                  </tr>
                </table>
              </td>
              <td valign="middle">
                <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.01em;">${escapeHtml(input.organizationName)}</span>
                <span style="display:block;margin-top:3px;color:#d8c9ff;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;">Employee referral</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr><td style="padding:32px;">
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
      </td></tr>
      <tr>
        <td style="padding:20px 32px;background:#faf9fc;border-top:1px solid #ecebf1;font-size:12px;line-height:1.6;color:#6b6878;">
          You received this because someone at ${escapeHtml(input.organizationName)} referred you.
          We will not add you to any mailing list.
        </td>
      </tr>
    </table>
    </td></tr>
    </table>
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
