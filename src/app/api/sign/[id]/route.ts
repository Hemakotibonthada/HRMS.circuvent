// GET/POST /api/sign/[id] — the public signing endpoint.
//
// This is the one route in the application reachable without a session. A
// candidate signing an offer has no account; their only credential is the
// single-use token in the emailed link.
//
// Consequences, all deliberate:
//   - The token is compared against a stored hash in constant time.
//   - A wrong document id and a wrong token return the same 404, so the
//     response cannot be used to confirm that a document exists.
//   - Rate limiting keys on the document id, not the caller, because there is
//     no authenticated caller to key on.
//   - Nothing here trusts a body field for identity. The signatory is
//     whichever slot the token resolves to.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonDocumentsRepository } from "@/db/repositories/documents.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { checkRateLimit } from "@/lib/api-context";
import { dispatchDocumentEvent, type DispatchOptions } from "@/lib/document-dispatch";
import type { DocumentEvent } from "@/lib/document-notify";

/**
 * Announces an event without letting the announcement break the thing.
 *
 * By the time this runs the signature is committed and the token is burned. An
 * exception escaping here would turn a successful signing into a 500, and the
 * candidate would try again with a link that no longer works — losing a
 * legally significant act to a mail server being slow.
 */
async function announce(
  ctx: { orgId: string },
  document: Parameters<typeof dispatchDocumentEvent>[1],
  event: DocumentEvent,
  options: DispatchOptions
): Promise<void> {
  try {
    await dispatchDocumentEvent(ctx, document, event, options);
  } catch (error) {
    console.error(`[sign] Could not announce ${event} for ${document.id}:`, error);
  }
}

const signSchema = z.object({
  action: z.literal("sign"),
  token: z.string().regex(/^[0-9a-f]{64}$/),
  signatureImageUrl: z.string().url().max(2000).optional(),
});

const declineSchema = z.object({
  action: z.literal("decline"),
  token: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().trim().min(3, "Please say why you are declining").max(500),
});

const bodySchema = z.discriminatedUnion("action", [signSchema, declineSchema]);

/** The same response for every failure, so nothing can be probed. */
const notFound = () => NextResponse.json({ error: "Signing request not found" }, { status: 404 });

async function contextFor(documentId: string) {
  const orgId = await NeonDocumentsRepository.resolveSigningOrg(documentId);
  return orgId ? { orgId } : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const limit = checkRateLimit(`sign-open:${id}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{64}$/.test(token)) return notFound();

  const ctx = await contextFor(id);
  if (!ctx) return notFound();

  try {
    const result = await new NeonDocumentsRepository(ctx).openForSigning(id, token);

    // The signature trail carries other signatories' email addresses and IP
    // evidence. A candidate needs to see the document and their own slot, not
    // the countersignatory's audit record.
    return NextResponse.json({
      document: {
        id: result.document.id,
        title: result.document.title,
        category: result.document.category,
        status: result.document.status,
        renderedBody: result.document.renderedBody,
        expiresAt: result.document.expiresAt,
      },
      signatory: result.signatory,
      canSign: result.canSignNow,
      reason: result.reason,
    });
  } catch (error) {
    if (error instanceof NotFoundError) return notFound();
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Signing link lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Tighter than the read: this consumes a single-use token, and a burst is
  // either a bug or someone guessing.
  const limit = checkRateLimit(`sign-submit:${id}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const ctx = await contextFor(id);
  if (!ctx) return notFound();

  try {
    const repo = new NeonDocumentsRepository(ctx);

    if (parsed.data.action === "decline") {
      const { document, signatory } = await repo.decline(
        id,
        parsed.data.token,
        parsed.data.reason
      );

      // Announced after the decline is committed, and failures are swallowed:
      // the candidate's answer is recorded either way, and turning a working
      // decline into a 500 would send them back to a token already consumed.
      await announce(ctx, document, "declined", {
        actorEmail: signatory.email,
        reason: parsed.data.reason,
      });

      return NextResponse.json({ status: document.status });
    }

    const { document, signatory } = await repo.sign(id, parsed.data.token, {
      signatureImageUrl: parsed.data.signatureImageUrl,
      // Evidence of who signed and from where. Taken from the request, never
      // from the body: a self-reported IP address is not evidence of anything.
      ipAddress:
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        request.headers.get("x-real-ip") ??
        undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    // "completed" tells the candidate they are hired and closes the loop for
    // the company; "signed" only concerns the company, because a candidate
    // does not need an email confirming the thing they just did.
    await announce(
      ctx,
      document,
      document.status === "completed" ? "completed" : "signed",
      { actorEmail: signatory.email }
    );

    return NextResponse.json({
      status: document.status,
      signedAt: document.signatures.find((s) => s.signedAt)?.signedAt,
    });
  } catch (error) {
    if (error instanceof NotFoundError) return notFound();
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Signature submission failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
