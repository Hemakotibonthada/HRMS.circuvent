// ═══════════════════════════════════════════════════════════════
// SENDING WHAT A DOCUMENT EVENT REQUIRES
// ═══════════════════════════════════════════════════════════════
//
// Ties the routing in `document-notify.ts` to the bodies in `document-mail.ts`
// and puts them on the wire.
//
// Kept out of the repository on purpose. Sending happens after the transaction
// that caused it has committed: SMTP is a third-party network call that can
// hang, and holding a document's row lock — and its signature rows with it —
// for the length of one is how a signing endpoint starts timing out under no
// load at all.
//
// Nothing here throws. Every caller is a route that has already done the thing
// the email is about: the signature is recorded, the offer is withdrawn. An
// exception raised while announcing a committed fact would turn a successful
// signing into a 500, and the candidate would try again against a token that
// has already been consumed.

import type { TenantContext } from "@/db/client";
import { loadOrgIdentity } from "@/db/repositories/org-identity";
import {
  documentSignedNotice,
  offerAcceptedEmail,
  offerReminderEmail,
  offerRevokedEmail,
  type EmailBody,
} from "@/lib/document-mail";
import {
  recipientsFor,
  type DocumentEvent,
  type SignatorySlot,
} from "@/lib/document-notify";
import { mailConfigured, sendMail } from "@/lib/mailer";

export interface DispatchDocument {
  id: string;
  title: string;
  status: string;
  expiresAt?: string;
  signatures: SignatorySlot[];
}

export interface DispatchOutcome {
  email: string;
  audience: "candidate" | "internal";
  sent: boolean;
  reason?: string;
}

export interface DispatchOptions {
  /** Whoever caused the event, so they are not told about their own action. */
  actorEmail?: string;
  /** Reason recorded for a withdrawal or a decline. */
  reason?: string;
  /** Signing link, for a reminder. Never included in an internal message. */
  signUrl?: string;
}

/**
 * Announces a document event to the people it concerns.
 *
 * Returns what happened per recipient rather than a boolean. A partial
 * delivery is the interesting case and the one an operator has to act on;
 * collapsing it to true or false is how "the candidate never got it" becomes
 * invisible.
 */
export async function dispatchDocumentEvent(
  ctx: TenantContext,
  document: DispatchDocument,
  event: DocumentEvent,
  options: DispatchOptions = {}
): Promise<DispatchOutcome[]> {
  const targets = recipientsFor(document.signatures, event, options.actorEmail);
  if (targets.length === 0) return [];

  if (!mailConfigured()) {
    return targets.map((t) => ({
      email: t.email,
      audience: t.audience,
      sent: false,
      reason: "no-smtp",
    }));
  }

  let companyName = "your employer";
  try {
    const identity = await loadOrgIdentity(ctx);
    if (identity?.name) companyName = identity.name;
  } catch (error) {
    // A missing org row must not stop a signed contract being acknowledged.
    console.error("[documents] Could not read tenant identity for mail:", error);
  }

  const signedCount = document.signatures.filter((s) => s.signedAt).length;
  const remaining = Math.max(0, document.signatures.length - signedCount);

  const results: DispatchOutcome[] = [];

  for (const target of targets) {
    const body = bodyFor({
      event,
      audience: target.audience,
      companyName,
      document,
      recipientName: target.name,
      remaining,
      actorName: actorNameFrom(document, options.actorEmail),
      actorRole: actorRoleFrom(document, options.actorEmail),
      reason: options.reason,
      signUrl: options.signUrl,
    });

    if (!body) continue;

    const sent = await sendMail({
      to: target.email,
      subject: body.subject,
      html: body.html,
      text: body.text,
    });

    results.push({
      email: target.email,
      audience: target.audience,
      sent,
      reason: sent ? undefined : "send-failed",
    });
  }

  return results;
}

function actorNameFrom(document: DispatchDocument, actorEmail?: string): string | undefined {
  if (!actorEmail) return undefined;
  const email = actorEmail.trim().toLowerCase();
  return document.signatures.find((s) => s.email.trim().toLowerCase() === email)?.name;
}

function actorRoleFrom(document: DispatchDocument, actorEmail?: string): string {
  if (!actorEmail) return "someone";
  const email = actorEmail.trim().toLowerCase();
  return (
    document.signatures.find((s) => s.email.trim().toLowerCase() === email)?.role ?? "someone"
  );
}

function bodyFor(input: {
  event: DocumentEvent;
  audience: "candidate" | "internal";
  companyName: string;
  document: DispatchDocument;
  recipientName?: string;
  remaining: number;
  actorName?: string;
  actorRole: string;
  reason?: string;
  signUrl?: string;
}): EmailBody | null {
  const base = {
    recipientName: input.recipientName,
    companyName: input.companyName,
    positionTitle: input.document.title,
  };

  switch (input.event) {
    case "completed":
      return input.audience === "candidate"
        ? offerAcceptedEmail(base)
        : documentSignedNotice({
            companyName: input.companyName,
            documentTitle: input.document.title,
            signatoryName: input.actorName,
            signatoryRole: input.actorRole,
            remaining: 0,
          });

    case "signed":
      return documentSignedNotice({
        companyName: input.companyName,
        documentTitle: input.document.title,
        signatoryName: input.actorName,
        signatoryRole: input.actorRole,
        remaining: input.remaining,
      });

    // A decline reuses the signed notice deliberately: the company needs the
    // same three facts — which document, who, what is outstanding — and the
    // reason is recorded against the document where it belongs rather than
    // being retyped into an email that nobody can search.
    case "declined":
      return {
        ...documentSignedNotice({
          companyName: input.companyName,
          documentTitle: input.document.title,
          signatoryName: input.actorName,
          signatoryRole: input.actorRole,
          remaining: input.remaining,
        }),
        subject: `Declined: ${input.document.title}`,
      };

    case "voided":
      return offerRevokedEmail({ ...base, reason: input.reason });

    case "reminder":
      return offerReminderEmail({
        ...base,
        signUrl: input.signUrl,
        validUntil: input.document.expiresAt,
      });

    default:
      return null;
  }
}
