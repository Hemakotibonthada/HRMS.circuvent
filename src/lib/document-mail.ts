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
  /** Person to reply to with questions. */
  contactName?: string;
  contactEmail?: string;
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

  return {
    subject: `Your offer from ${ctx.companyName} — ${ctx.positionTitle}`,
    html:
      WRAPPER_OPEN(`Your offer from ${company}`) +
      paragraph(`Hi ${escapeHtml(greet(ctx.recipientName))},`) +
      paragraph(
        `We are pleased to offer you the position of <strong>${position}</strong> at ${company}${escapeHtml(basis)}.`
      ) +
      paragraph("The full terms are in the letter linked below. Please read it before signing.") +
      linkHtml +
      expiryHtml +
      contact.html +
      WRAPPER_CLOSE,
    text:
      `Hi ${greet(ctx.recipientName)},\n\n` +
      `We are pleased to offer you the position of ${ctx.positionTitle} at ${ctx.companyName}` +
      `${basis}.\n\n` +
      `The full terms are in the letter linked below. Please read it before signing.` +
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

/** Confirmation to the candidate once every signature is in. */
export function offerAcceptedEmail(ctx: OfferMailContext): EmailBody {
  const company = escapeHtml(ctx.companyName);
  const position = escapeHtml(ctx.positionTitle);
  const contact = contactLine(ctx);

  return {
    subject: `Welcome to ${ctx.companyName}`,
    html:
      WRAPPER_OPEN(`Welcome to ${company}`) +
      paragraph(`Hi ${escapeHtml(greet(ctx.recipientName))},`) +
      paragraph(
        `Your offer for <strong>${position}</strong> is signed by everyone it needed to be. Welcome aboard.`
      ) +
      paragraph("We will be in touch shortly with your onboarding details and what to bring.") +
      footNote("A signed copy is attached to your record and can be sent to you on request.") +
      contact.html +
      WRAPPER_CLOSE,
    text:
      `Hi ${greet(ctx.recipientName)},\n\n` +
      `Your offer for ${ctx.positionTitle} is signed by everyone it needed to be. Welcome aboard.\n\n` +
      `We will be in touch shortly with your onboarding details and what to bring.\n\n` +
      `A signed copy is attached to your record and can be sent to you on request.` +
      contact.text,
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
