// ═══════════════════════════════════════════════════════════════
// INTERN LIFECYCLE EMAIL
// ═══════════════════════════════════════════════════════════════
// Branded HTML for the three moments the intern lifecycle sends mail:
// a last-working-day reminder to the intern, the same news to HR and the
// intern's manager, and a "please sign" notice once a lifecycle document has
// been generated and sent for signature.
//
// The visual model is referral-invite-email.ts: it is the only existing
// template with an actual logo image rather than a plain gradient bar, and
// the task specifically calls for branded mail with the logo. The sending
// mechanism is mailer.ts's sendMail/mailConfigured directly, the same as
// document-dispatch.ts, rather than the notifications/transport.ts channel
// abstraction referral-invite-email.ts uses — there is no non-email channel
// to route to here, so the extra layer would have nothing to add.
//
// Every builder returns { subject, html, text } and sends nothing itself,
// matching document-mail.ts and referral-invite-email.ts: building the
// message and delivering it are different failure modes (a bad template is a
// bug, a bad SMTP config is an environment problem) and keeping them apart is
// what makes both independently testable.

import { escapeHtml } from "@/lib/document-rules";

/**
 * Absolute https URL for the logo, duplicated from referral-invite-email.ts
 * rather than imported: that function is not exported, and every mail
 * template file in this codebase is self-contained rather than sharing a
 * "components" module, so re-declaring four lines here matches how the rest
 * of the codebase already does this.
 */
function logoUrl(): string {
  const configured = process.env.MAIL_LOGO_URL?.trim();
  if (configured) return configured;
  const careers = process.env.NEXT_PUBLIC_CAREERS_URL?.trim() || "https://career.circuvent.com";
  return `${careers.replace(/\/$/, "")}/logo-mark-128.png`;
}

interface EmailBody {
  subject: string;
  html: string;
  text: string;
}

/** The table-based header and footer every intern-lifecycle email shares. */
function wrap(companyName: string, eyebrow: string, title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#10111a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f7;">
    <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;">
      <tr>
        <td style="padding:22px 32px;background:linear-gradient(135deg,#7c3aed,#6d28d9);">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td valign="middle" style="padding-right:12px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" valign="middle" bgcolor="#ffffff" style="width:40px;height:40px;background:#ffffff;border-radius:9px;padding:4px;">
                      <img src="${escapeHtml(logoUrl())}" width="32" height="32" alt="${escapeHtml(companyName)}"
                           style="display:block;width:32px;height:32px;border:0;outline:none;text-decoration:none;">
                    </td>
                  </tr>
                </table>
              </td>
              <td valign="middle">
                <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.01em;">${escapeHtml(companyName)}</span>
                <span style="display:block;margin-top:3px;color:#d8c9ff;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;">${escapeHtml(eyebrow)}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr><td style="padding:32px;">
      <h1 style="margin:0 0 16px;font-size:19px;color:#10111a;">${escapeHtml(title)}</h1>
      ${bodyHtml}
      </td></tr>
      <tr>
        <td style="padding:20px 32px;background:#faf9fc;border-top:1px solid #ecebf1;font-size:12px;line-height:1.6;color:#6b6878;">
          Sent by ${escapeHtml(companyName)} HRMS. This is an automated message from the intern lifecycle workflow.
        </td>
      </tr>
    </table>
    </td></tr>
    </table>
  </body>
</html>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:0 0 24px;">
    <a href="${escapeHtml(url)}" style="display:inline-block;background:#783ff5;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;">
      ${escapeHtml(label)}
    </a>
  </p>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#2c2d38;">${text}</p>`;
}

export interface ReminderEmailInput {
  companyName: string;
  internName: string;
  endDate: string;
  daysRemaining: number;
}

/** Sent to the intern themselves. */
export function internshipEndingReminderEmail(input: ReminderEmailInput): EmailBody {
  const when =
    input.daysRemaining <= 0
      ? "today"
      : input.daysRemaining === 1
        ? "tomorrow"
        : `in ${input.daysRemaining} days`;

  const subject = `Your internship at ${input.companyName} ends ${when}`;
  const text =
    `Hi ${input.internName},\n\n` +
    `This is a reminder that your internship at ${input.companyName} is scheduled to end on ${input.endDate} (${when}).\n\n` +
    `If you are converting to a permanent role, or if this date has changed, please speak with your manager or HR ` +
    `before your last day so your records and final paperwork are accurate.\n\n` +
    `Thank you for your work during your internship.`;

  const html = wrap(
    input.companyName,
    "Internship ending",
    "Your internship is ending soon",
    paragraph(
      `Hi ${escapeHtml(input.internName)}, this is a reminder that your internship at ` +
        `<strong>${escapeHtml(input.companyName)}</strong> is scheduled to end on ` +
        `<strong>${escapeHtml(input.endDate)}</strong> (${escapeHtml(when)}).`,
    ) +
      paragraph(
        "If you are converting to a permanent role, or this date has changed, please speak with your " +
          "manager or HR before your last day so your records and final paperwork are accurate.",
      ) +
      paragraph("Thank you for your work during your internship."),
  );

  return { subject, html, text };
}

export interface ReminderNoticeInput {
  companyName: string;
  recipientName: string;
  internName: string;
  internEmail: string;
  endDate: string;
  daysRemaining: number;
  managerName?: string;
}

/** Sent to HR and to the intern's manager. */
export function internshipEndingNoticeEmail(input: ReminderNoticeInput): EmailBody {
  const when =
    input.daysRemaining <= 0
      ? "today"
      : input.daysRemaining === 1
        ? "tomorrow"
        : `in ${input.daysRemaining} days`;

  const subject = `${input.internName}'s internship ends ${when} — ${input.endDate}`;
  const text =
    `Hi ${input.recipientName},\n\n` +
    `${input.internName} (${input.internEmail}) is scheduled to complete their internship on ${input.endDate} (${when}).\n\n` +
    `If they are converting to a permanent role, start that process now so their employee code, leave balance and ` +
    `reporting line carry over without a gap. If they are not converting, the usual exit paperwork — relieving letter, ` +
    `experience certificate and final settlement — will be needed once they are marked as exited.\n\n` +
    `This is an automated reminder; no action is needed if this is already in hand.`;

  const html = wrap(
    input.companyName,
    "Internship ending",
    "An internship is ending soon",
    paragraph(
      `Hi ${escapeHtml(input.recipientName)}, <strong>${escapeHtml(input.internName)}</strong> ` +
        `(${escapeHtml(input.internEmail)})${input.managerName ? `, reporting to ${escapeHtml(input.managerName)},` : ""} ` +
        `is scheduled to complete their internship on <strong>${escapeHtml(input.endDate)}</strong> (${escapeHtml(when)}).`,
    ) +
      paragraph(
        "If they are converting to a permanent role, start that process now so their employee code, leave balance " +
          "and reporting line carry over without a gap. If they are not converting, the relieving letter, experience " +
          "certificate and final settlement will be needed once they are marked as exited.",
      ) +
      paragraph("This is an automated reminder; no action is needed if this is already in hand."),
  );

  return { subject, html, text };
}

export interface DocumentReadySignInput {
  companyName: string;
  recipientName?: string;
  documentTitle: string;
  employeeName: string;
  signUrl: string;
  expiresAt?: string;
}

/**
 * Sent to each signatory once a lifecycle document (joining letter, relieving
 * letter, completion or experience certificate) has been generated and a
 * signing link issued. Deliberately generic rather than reusing
 * document-mail.ts's offerIssuedEmail: that copy says "we are pleased to
 * offer you the position of X", which is true for a joining letter and false
 * for a relieving letter or a certificate signed on someone's way out.
 */
export function documentReadyToSignEmail(input: DocumentReadySignInput): EmailBody {
  const who = input.recipientName?.trim() || "there";
  const expiry = input.expiresAt
    ? ` This link expires on ${input.expiresAt} and can be used once.`
    : " This link can be used once.";

  const subject = `${input.documentTitle} ready for signature — ${input.employeeName}`;
  const text =
    `Hi ${who},\n\n` +
    `A document from ${input.companyName} is ready for your signature: "${input.documentTitle}" for ${input.employeeName}.\n\n` +
    `Sign it here:\n${input.signUrl}\n\n${expiry.trim()}`;

  const html = wrap(
    input.companyName,
    "Signature requested",
    "A document is ready for your signature",
    paragraph(
      `Hi ${escapeHtml(who)}, <strong>${escapeHtml(input.documentTitle)}</strong> for ` +
        `${escapeHtml(input.employeeName)} is ready for your signature.`,
    ) +
      button(input.signUrl, "Review and sign") +
      paragraph(escapeHtml(expiry.trim())),
  );

  return { subject, html, text };
}
