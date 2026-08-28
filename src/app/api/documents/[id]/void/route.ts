// POST /api/documents/[id]/void — withdraw a document.
//
// Never deletes. An offer that was withdrawn is part of the record, and a
// disappeared document is indistinguishable from one that never existed.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonDocumentsRepository } from "@/db/repositories/documents.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { dispatchDocumentEvent } from "@/lib/document-dispatch";

const bodySchema = z.object({
  reason: z.string().trim().min(5, "Say why this document is being voided").max(500),
});

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
    return NextResponse.json({ error: "You cannot void documents" }, { status: 403 });
  }

  const limit = checkRateLimit(`doc-void:${ctx.userId}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id } = await params;

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

  try {
    const document = await new NeonDocumentsRepository(ctx).voidDocument(id, parsed.data.reason);

    // The candidate is told, because the signing link they were sent has just
    // stopped working. Without this they discover the withdrawal by clicking a
    // link that errors, and conclude the system is broken rather than that the
    // offer is gone. Failures are logged, never raised: the document is
    // already voided and re-voiding it returns 409.
    let delivery: Awaited<ReturnType<typeof dispatchDocumentEvent>> = [];
    try {
      delivery = await dispatchDocumentEvent(ctx, document, "voided", {
        reason: parsed.data.reason,
      });
    } catch (error) {
      console.error(`[documents] Could not announce withdrawal of ${id}:`, error);
    }

    return NextResponse.json({ ...document, delivery });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Document void failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
