import "server-only";

import type { ApiContext } from "@/lib/api-context";
import { NeonDocumentsRepository, type DocumentRecord } from "@/db/repositories/documents.neon";
import { loadOrgIdentity } from "@/db/repositories/org-identity";
import { offerIssuedEmail } from "@/lib/document-mail";
import { renderDocumentPdf } from "@/lib/documents/render-pdf";
import { mailConfigured, sendMail } from "@/lib/mailer";

export interface DocumentDeliveryOutcome {
  email: string;
  role: string;
  url: string;
  sent: boolean;
  reason?: string;
  attachedPdf?: boolean;
}

export interface IssueDocumentResult {
  document: DocumentRecord;
  links: { email: string; role: string; url: string }[];
  delivery: DocumentDeliveryOutcome[];
  mailConfigured: boolean;
}

function safePdfFilename(title: string): string {
  const base = title.replace(/[^\w\s.-]/g, "").trim() || "document";
  return `${base}.pdf`;
}

async function renderLetterPdfAttachment(
  document: DocumentRecord,
  companyName: string
): Promise<{ filename: string; content: Buffer } | null> {
  const body = document.renderedBody?.trim();
  if (!body) return null;

  try {
    const bytes = await renderDocumentPdf({
      title: document.title,
      companyName,
      bodyHtmlOrText: body,
      signingReference: document.id,
      signatories: [],
    });
    return { filename: safePdfFilename(document.title), content: Buffer.from(bytes) };
  } catch (error) {
    console.warn("[issue-document] Could not render PDF attachment for email.", {
      documentId: document.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Marks a draft document sent, mints signing tokens, and emails each signatory.
 *
 * The email carries the letter as a PDF attachment *and* the signing link, so
 * the recipient can read it immediately while the signature flow stays unchanged.
 */
export async function issueDocumentAndEmail(
  ctx: ApiContext,
  documentId: string,
  origin: string
): Promise<IssueDocumentResult> {
  const { document, links } = await new NeonDocumentsRepository(ctx).send(documentId);

  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() || origin.replace(/\/+$/, "");
  const identity = await loadOrgIdentity(ctx);
  const companyName = identity?.name ?? "your new employer";
  const pdfAttachment = await renderLetterPdfAttachment(document, companyName);

  const signatoryName = (email: string) =>
    document.signatures.find((s) => s.email === email)?.name;

  const delivery = await Promise.all(
    links.map(async (link) => {
      const url = `${base}/sign/${document.id}?token=${link.token}`;

      if (!mailConfigured()) {
        return {
          email: link.email,
          role: link.role,
          url,
          sent: false,
          reason: "no-smtp",
          attachedPdf: false,
        };
      }

      const body = offerIssuedEmail({
        recipientName: signatoryName(link.email),
        companyName,
        positionTitle: document.title,
        signUrl: url,
        validUntil: document.expiresAt,
        contactEmail: ctx.email,
        pdfAttached: Boolean(pdfAttachment),
      });

      const sent = await sendMail({
        to: link.email,
        subject: body.subject,
        html: body.html,
        text: body.text,
        attachments: pdfAttachment
          ? [
              {
                filename: pdfAttachment.filename,
                content: pdfAttachment.content,
                contentType: "application/pdf",
              },
            ]
          : undefined,
      });

      return {
        email: link.email,
        role: link.role,
        url,
        sent,
        reason: sent ? undefined : "send-failed",
        attachedPdf: Boolean(pdfAttachment) && sent,
      };
    })
  );

  return {
    document,
    links: delivery.map(({ email, role, url }) => ({ email, role, url })),
    delivery,
    mailConfigured: mailConfigured(),
  };
}
