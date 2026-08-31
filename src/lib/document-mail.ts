// ═══════════════════════════════════════════════════════════════
// DOCUMENT AND OFFER EMAIL
// ═══════════════════════════════════════════════════════════════
//
// The messages that carry a document to the person who has to act on it.
//
// Until now the document pipeline sent nothing. `/api/documents/[id]/send`
// issued single-use signing links and returned them to the caller with the
// comment "for the caller to put in the emails" — and no caller ever did, so
// generating an offer produced a database row, a signing URL nobody received,
// and a candidate waiting for an email that was never written. `sendMail` had
// exactly one caller in the whole product: password reset.
//
// These are pure functions returning subject, html and text. They touch no
// transport, so they are testable without SMTP, and the decision about whether
// a failed send should fail the request stays with the route rather than being
// buried in a template.
//
// Two things every message here gets right, because getting them wrong is how
// this kind of code fails in production:
//
//  1. **Everything interpolated is escaped.** A candidate controls their own
//     name, and that name is rendered into an HTML email that goes to an
//     internal recruiter. `document-rules.ts` escapes template tokens for
//     exactly this reason; an email assembled with template literals bypasses
//     that unless it escapes too.
//
//  2. **There is always a text alternative.** Plenty of corporate clients
//     strip HTML, and an offer that arrives as a blank message is worse than
//     one that arrives plain — the candidate cannot tell it was sent at all.
//     The signing link therefore appears as a bare URL in the text part.

import { escapeHtml } from "@/lib/document-rules";

export interface EmailBody {
  subject: string;
  html: string;
  text: string;
}

export interface OfferMailContext {
  /** Who the message is addressed to. */
  recipientName?: string;
  /** The tenant's own name — never this product's. */
  companyName: string;
  positionTitle: string;
  /**
   * "Internship", "Full-time employment" and so on, from the engagement rule.
   *
   * Optional because the sender does not always know it: a document row
   * records the template it came from, not the engagement that was offered.
   * When it is absent the sentence simply omits the phrase, rather than
   * guessing — telling a contractor they are joining "on a letter basis" is
   * worse than not saying it at all.
   */
  engagementLabel?: string;
  /** Single-use signing URL. Present only where the recipient must sign. */
  signUrl?: string;
  /** ISO date the offer lapses, if it does. */
  validUntil?: string;
  /** Mailbox claim URL for domain email registration. */
  claimUrl?: string;
  /** Person to reply to with questions. */
  contactName?: string;
  contactEmail?: string;
  /** True when a PDF copy of the letter is attached to this message. */
  pdfAttached?: boolean;
}

/** Greeting that reads correctly when the name is missing. */
function greet(name?: string): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : "there";
}

/**
 * Formats an ISO date for a human.
 *
 * Uses an explicit IST timezone rather than the server's. A document generated
 * from a server running in UTC would otherwise tell an Indian candidate their
 * offer expires a day earlier than it does, which is the same class of bug
 * that `date-keys.ts` exists to prevent elsewhere in this product.
 */
export function formatDateForEmail(iso?: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00+05:30` : iso);
  if (Number.isNaN(date.getTime())) return undefined;

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

const WRAPPER_OPEN = (heading: string) => `
      <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:24px;border-radius:12px 12px 0 0">
          <h1 style="color:#fff;margin:0;font-size:20px">${heading}</h1>
        </div>
        <div style="background:#f8fafc;padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">`;

const WRAPPER_CLOSE = `
        </div>
      </div>`;

function paragraph(html: string): string {
  return `<p style="font-size:14px;color:#0c1222;margin:0 0 16px;line-height:1.6">${html}</p>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:0 0 18px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:11px 20px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>`;
}

function footNote(html: string): string {
  return `<p style="font-size:12px;color:#64748b;margin:0 0 6px">${html}</p>`;
}

function contactLine(ctx: OfferMailContext): { html: string; text: string } {
  if (!ctx.contactEmail) return { html: "", text: "" };
  const name = ctx.contactName?.trim();
  const who = name ? `${escapeHtml(name)} (${escapeHtml(ctx.contactEmail)})` : escapeHtml(ctx.contactEmail);
  const whoText = name ? `${name} (${ctx.contactEmail})` : ctx.contactEmail;

  return {
    html: footNote(`Questions? Write to ${who}.`),
    text: `\n\nQuestions? Write to ${whoText}.`,
  };
}

/**
 * The offer itself, with the link that lets the candidate read and sign it.
 *
 * The link is single-use and the token is stored hashed, so this message is
 * the only copy that will ever exist. That is stated plainly rather than left
 * implicit: a candidate who deletes it needs to know to ask for a new one
 * instead of waiting.
 */
export function offerIssuedEmail(ctx: OfferMailContext): EmailBody {
  const company = escapeHtml(ctx.companyName);
  const position = escapeHtml(ctx.positionTitle);
  const validUntil = formatDateForEmail(ctx.validUntil);
  const contact = contactLine(ctx);

  const expiryHtml = validUntil
    ? paragraph(`This offer is open until <strong>${escapeHtml(validUntil)}</strong>.`)
    : "";
  const expiryText = validUntil ? `\n\nThis offer is open until ${validUntil}.` : "";

  const linkHtml = ctx.signUrl
    ? button(ctx.signUrl, "Read and sign your offer") +
      footNote("This link is personal to you and can be used once.")
    : "";
  const linkText = ctx.signUrl
    ? `\n\nRead and sign your offer:\n${ctx.signUrl}\n\nThis link is personal to you and can be used once.`
    : "";

  const basis = ctx.engagementLabel?.trim()
    ? `, on a ${ctx.engagementLabel.trim().toLowerCase()} basis`
    : "";

  const attachmentNote = ctx.pdfAttached
    ? paragraph(
        "A PDF copy of the letter is attached to this email. You can also read and sign it online using the link below."
      )
    : paragraph("The full terms are in the letter linked below. Please read it before signing.");

  const attachmentText = ctx.pdfAttached
    ? "\n\nA PDF copy of the letter is attached to this email. You can also read and sign it online using the link below."
    : "\n\nThe full terms are in the letter linked below. Please read it before signing.";

  return {
    subject: `Your offer from ${ctx.companyName} — ${ctx.positionTitle}`,
    html:
      WRAPPER_OPEN(`Your offer from ${company}`) +
      paragraph(`Hi ${escapeHtml(greet(ctx.recipientName))},`) +
      paragraph(
        `We are pleased to offer you the position of <strong>${position}</strong> at ${company}${escapeHtml(basis)}.`
      ) +
      attachmentNote +
      linkHtml +
      expiryHtml +
      contact.html +
      WRAPPER_CLOSE,
    text:
      `Hi ${greet(ctx.recipientName)},\n\n` +
      `We are pleased to offer you the position of ${ctx.positionTitle} at ${ctx.companyName}` +
      `${basis}.` +
      attachmentText +
      linkText +
      expiryText +
      contact.text,
  };
}

/** Nudge before an unsigned offer lapses. */
export function offerReminderEmail(ctx: OfferMailContext): EmailBody {
  const company = escapeHtml(ctx.companyName);
  const position = escapeHtml(ctx.positionTitle);
  const validUntil = formatDateForEmail(ctx.validUntil);
  const contact = contactLine(ctx);

  const deadlineHtml = validUntil
    ? paragraph(`It is open until <strong>${escapeHtml(validUntil)}</strong>.`)
    : "";
  const deadlineText = validUntil ? `\n\nIt is open until ${validUntil}.` : "";

  return {
    subject: `Reminder: your offer from ${ctx.companyName} is waiting`,
    html:
      WRAPPER_OPEN("Your offer is waiting") +
      paragraph(`Hi ${escapeHtml(greet(ctx.recipientName))},`) +
      paragraph(
        `You have an unsigned offer for <strong>${position}</strong> at ${company}.`
      ) +
      deadlineHtml +
      (ctx.signUrl ? button(ctx.signUrl, "Read and sign your offer") : "") +
      // Signing tokens are stored hashed, so a reminder cannot re-send the
      // original link — it mints a new one and the old link stops working.
      // Saying so is the difference between a candidate using this email and a
      // candidate clicking the first one, getting an error, and assuming the
      // offer was withdrawn.
      (ctx.signUrl
        ? footNote("This link replaces the one in our earlier email, which no longer works.")
        : footNote("Please use the link in our earlier email to sign.")) +
      footNote("If you have decided against it, just reply and tell us — that is genuinely fine.") +
      contact.html +
      WRAPPER_CLOSE,
    text:
      `Hi ${greet(ctx.recipientName)},\n\n` +
      `You have an unsigned offer for ${ctx.positionTitle} at ${ctx.companyName}.` +
      deadlineText +
      (ctx.signUrl
        ? `\n\nRead and sign your offer:\n${ctx.signUrl}\n\nThis link replaces the one in our earlier email, which no longer works.`
        : `\n\nPlease use the link in our earlier email to sign.`) +
      `\n\nIf you have decided against it, just reply and tell us — that is genuinely fine.` +
      contact.text,
  };
}

/** Confirmation to the candidate once every signature is in with Domain Email Setup prompt. */
export function offerAcceptedEmail(ctx: OfferMailContext): EmailBody {
  const company = escapeHtml(ctx.companyName);
  const position = escapeHtml(ctx.positionTitle);
  const contact = contactLine(ctx);
  const claimUrl = ctx.claimUrl || process.env.MAIL_REGISTER_URL || "https://mail.circuvent.com/register";

  return {
    subject: `Welcome to ${ctx.companyName} — Set up your Domain Email`,
    html:
      WRAPPER_OPEN(`Welcome to ${company}!`) +
      paragraph(`Hi ${escapeHtml(greet(ctx.recipientName))},`) +
      paragraph(
        `Congratulations! Your offer for <strong>${position}</strong> at ${company} is officially confirmed. We are thrilled to welcome you aboard!`
      ) +
      paragraph(
        `<strong>Next Step: Set Up Your Company Email Address</strong><br/>` +
        `Before your first day, please register your official work email address. This domain mailbox is your primary identity for company webmail, HRMS, attendance, and employee self-service.`
      ) +
      button(claimUrl, "Create Your Company Email") +
      paragraph(
        `<em>Address format: &lt;your name&gt;@domain (or cvi-&lt;name&gt;@domain for interns).</em><br/>` +
        `Once registered, your mailbox request is approved by IT / HR Operations and your credentials will be activated.`
      ) +
      footNote("A signed copy of your offer letter is attached to your employee record.") +
      contact.html +
      WRAPPER_CLOSE,
    text:
      `Hi ${greet(ctx.recipientName)},\n\n` +
      `Congratulations! Your offer for ${ctx.positionTitle} at ${ctx.companyName} is officially confirmed. Welcome aboard!\n\n` +
      `NEXT STEP: SET UP YOUR COMPANY EMAIL ADDRESS\n` +
      `Before your first day, please register your official work email address. This domain mailbox is your primary identity for company webmail, HRMS, attendance, and employee self-service.\n\n` +
      `Create your company email:\n${claimUrl}\n\n` +
      `Address format: <your name>@domain (or cvi-<name>@domain for interns).\n` +
      `Once registered, your mailbox request is approved by IT / HR Operations and your credentials will be activated.\n\n` +
      `A signed copy of your offer letter is attached to your employee record.` +
      contact.text,
  };
}

/** Signed-link invitation to create a company mailbox after offer acceptance. */
export function mailboxInviteEmail(input: {
  candidateName: string;
  jobTitle?: string | null;
  startDate?: string | null;
  claimUrl: string;
  isIntern?: boolean;
  expiresInDays?: number;
}): EmailBody {
  const name = escapeHtml(greet(input.candidateName));
  const position = input.jobTitle ? escapeHtml(input.jobTitle) : null;
  const days = input.expiresInDays ?? 14;
  const formatNote = input.isIntern
    ? "cvi-&lt;your id&gt;@circuvent.com"
    : "&lt;your name&gt;@circuvent.com";

  return {
    subject: "Set up your Circuvent email address",
    html:
      WRAPPER_OPEN("Your company email") +
      paragraph(`Hi ${name},`) +
      paragraph(
        `Thank you for accepting your offer. Before your first day, please set up your company email address — it is how you sign in to mail, HRMS, and the rest of the suite.`
      ) +
      (position ? paragraph(`<strong>Role:</strong> ${position}`) : "") +
      (input.startDate ? paragraph(`<strong>Start date:</strong> ${escapeHtml(input.startDate)}`) : "") +
      paragraph(`<strong>Address format:</strong> ${formatNote}`) +
      button(input.claimUrl, "Create your company email") +
      paragraph(
        `Your request goes to HR for approval, so the mailbox will not work the moment you submit it. You will hear from us once it is active.`
      ) +
      footNote(`This link is personal to you and expires in ${days} days. Please do not forward it.`) +
      WRAPPER_CLOSE,
    text:
      `Hi ${greet(input.candidateName)},\n\n` +
      `Thank you for accepting your offer. Before your first day, please set up your company email address.\n\n` +
      (input.jobTitle ? `Role: ${input.jobTitle}\n` : "") +
      (input.startDate ? `Start date: ${input.startDate}\n` : "") +
      `Address format: ${input.isIntern ? "cvi-<your id>@circuvent.com" : "<your name>@circuvent.com"}\n\n` +
      `Create your company email:\n${input.claimUrl}\n\n` +
      `Your request goes to HR for approval before the mailbox is activated.\n\n` +
      `This link is personal to you and expires in ${days} days.`,
  };
}

/**
 * Told to the internal team, not the candidate.
 *
 * Carries no signing link. Forwarding an internal notification is routine, and
 * a link in it would be a working credential for somebody else's contract.
 */
export function documentSignedNotice(ctx: {
  companyName: string;
  documentTitle: string;
  signatoryName?: string;
  signatoryRole: string;
  remaining: number;
}): EmailBody {
  const title = escapeHtml(ctx.documentTitle);
  const who = escapeHtml(ctx.signatoryName?.trim() || ctx.signatoryRole);
  const outstanding =
    ctx.remaining > 0
      ? `${ctx.remaining} signature${ctx.remaining === 1 ? "" : "s"} still outstanding.`
      : "Every signature is now in.";

  return {
    subject: `Signed: ${ctx.documentTitle}`,
    html:
      WRAPPER_OPEN("A document was signed") +
      paragraph(`<strong>${who}</strong> signed <strong>${title}</strong>.`) +
      paragraph(escapeHtml(outstanding)) +
      WRAPPER_CLOSE,
    text: `${ctx.signatoryName?.trim() || ctx.signatoryRole} signed ${ctx.documentTitle}.\n\n${outstanding}`,
  };
}

/** Sent when an outstanding offer is withdrawn. */
export function offerRevokedEmail(
  ctx: OfferMailContext & { reason?: string }
): EmailBody {
  const company = escapeHtml(ctx.companyName);
  const position = escapeHtml(ctx.positionTitle);
  const contact = contactLine(ctx);

  // The reason is optional and is shown only when given. An empty "Reason:"
  // line reads as though something was withheld.
  const reasonHtml = ctx.reason?.trim()
    ? paragraph(`Reason given: ${escapeHtml(ctx.reason.trim())}`)
    : "";
  const reasonText = ctx.reason?.trim() ? `\n\nReason given: ${ctx.reason.trim()}` : "";

  return {
    subject: `Your offer from ${ctx.companyName} has been withdrawn`,
    html:
      WRAPPER_OPEN("Your offer has been withdrawn") +
      paragraph(`Hi ${escapeHtml(greet(ctx.recipientName))},`) +
      paragraph(
        `We are writing to let you know that the offer for <strong>${position}</strong> at ${company} has been withdrawn, and the signing link no longer works.`
      ) +
      reasonHtml +
      paragraph("We are sorry to send this, and we are grateful for the time you gave us.") +
      contact.html +
      WRAPPER_CLOSE,
    text:
      `Hi ${greet(ctx.recipientName)},\n\n` +
      `We are writing to let you know that the offer for ${ctx.positionTitle} at ${ctx.companyName} ` +
      `has been withdrawn, and the signing link no longer works.` +
      reasonText +
      `\n\nWe are sorry to send this, and we are grateful for the time you gave us.` +
      contact.text,
  };
}
