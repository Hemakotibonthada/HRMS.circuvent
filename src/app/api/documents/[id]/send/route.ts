// POST /api/documents/[id]/send — issue signing links and email them.
//
// The links are single-use and their tokens are stored hashed, so the response
// from `send()` is the only moment the plaintext exists. Until now that moment
// was wasted: the route returned the links to the caller with a comment saying
// they were "for the caller to put in the emails", and no caller ever did.
// Generating an offer produced a row in the database, a URL nobody received,
// and a candidate waiting for a letter that was never sent.
//
// Two things decide the shape of this route.
//
// Mail is dispatched *after* the transaction commits, never inside it. SMTP is
// a network call to a third party that can take seconds or hang; holding the
// row lock on a document — and the signature rows with it — for that long
// blocks every other operation on the envelope.
//
// A failed send does not fail the request. The document is already sent and
// the tokens are already hashed, so rolling back would leave the envelope in a
// state whose links nobody can ever recover. Instead every recipient's outcome
// is reported individually and the links are returned regardless, so an
// operator whose SMTP is misconfigured can still deliver the offer by hand
// rather than being told only that something went wrong.

import { NextResponse, type NextRequest } from "next/server";
import { NeonDocumentsRepository } from "@/db/repositories/documents.neon";
import { loadOrgIdentity } from "@/db/repositories/org-identity";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { offerIssuedEmail } from "@/lib/document-mail";
import { mailConfigured, sendMail } from "@/lib/mailer";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot send documents" }, { status: 403 });
  }

  const limit = checkRateLimit(`doc-send:${ctx.userId}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id } = await params;

  try {
    const { document, links } = await new NeonDocumentsRepository(ctx).send(id);

    const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    const identity = await loadOrgIdentity(ctx);

    const signatoryName = (email: string) =>
      document.signatures.find((s) => s.email === email)?.name;

    const delivery = await Promise.all(
      links.map(async (link) => {
        const url = `${base}/sign/${document.id}?token=${link.token}`;

        if (!mailConfigured()) {
          return { email: link.email, role: link.role, url, sent: false, reason: "no-smtp" };
        }

        const body = offerIssuedEmail({
          recipientName: signatoryName(link.email),
          companyName: identity?.name ?? "your new employer",
          positionTitle: document.title,
          signUrl: url,
          validUntil: document.expiresAt,
          contactEmail: ctx.email,
        });

        const sent = await sendMail({
          to: link.email,
          subject: body.subject,
          html: body.html,
          text: body.text,
        });

        return { email: link.email, role: link.role, url, sent, reason: sent ? undefined : "send-failed" };
      })
    );

    return NextResponse.json({
      document,
      // Kept for the operator, not for display. When SMTP is down this is the
      // only way the offer reaches the candidate at all.
      links: delivery.map(({ email, role, url }) => ({ email, role, url })),
      delivery: delivery.map(({ email, role, sent, reason }) => ({ email, role, sent, reason })),
      mailConfigured: mailConfigured(),
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Document dispatch failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
