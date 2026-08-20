// GET /api/documents/[id]/pdf — download a signed document's archived PDF.
//
// The document row (`renderedBody`, signature trail) has always been readable
// through `GET /api/documents/[id]`; the actual PDF only exists once
// `document-pdf-outbox.ts` has rendered and uploaded it, so this is a
// separate route rather than a field inlined into that response — the bytes
// are typically tens to low hundreds of KB and belong in their own request,
// not the JSON payload every document list re-fetches.
//
// R2 is private and `generatedDocuments.blobUrl` holds an object *key*, not a
// public URL (see that column's comment in `documents.neon.ts`), so this
// route — checking the same authorisation as every other document read — is
// the only way a stored PDF is meant to leave the bucket.

import { NextResponse, type NextRequest } from "next/server";
import { NeonDocumentsRepository } from "@/db/repositories/documents.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { getObjectBytes, StorageConfigError, StorageRequestError } from "@/lib/storage/object-store";

/**
 * Turns a person-typed document title into a filename a browser can trust.
 *
 * Not the storage key — that is derived only from server-assigned ids and a
 * content hash (`documentPdfKey`) and never touches this. This is purely the
 * suggested filename in `Content-Disposition`, which a raw title cannot be
 * used for directly: an embedded quote or newline can break out of the header
 * value, and accented or non-Latin characters are not valid in the bare
 * `filename=` form without the `filename*=` encoding this route does not
 * bother implementing for a one-line convenience name.
 */
function safeDownloadFilename(title: string): string {
  const cleaned = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : "document";
}

export async function GET(
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

  // Deliberately staff-only, unlike the plain `GET /api/documents/[id]` (which
  // also lets an employee read their own record): the archived PDF is the
  // durable, printable artefact of a signed envelope, and this feature's own
  // brief scopes downloading it to authorised staff rather than self-service.
  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot download this document" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const document = await new NeonDocumentsRepository(ctx).get(id);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (!document.blobUrl) {
      // Distinct from "not found": the document exists, and may already be
      // fully signed, but the PDF storage outbox has not landed a copy yet —
      // its first attempt may have failed and be waiting on backoff, or it
      // simply has not run. A generic 404 here would send whoever hit this
      // chasing the wrong problem.
      return NextResponse.json(
        {
          error:
            "This document's PDF has not been stored yet. Storage is retried automatically; try again shortly.",
        },
        { status: 404 }
      );
    }

    const bytes = await getObjectBytes(document.blobUrl);

    // `.slice()` copies into a freshly allocated, exactly-sized `ArrayBuffer`
    // — the same fix `sha256Hex` in `object-store.ts` uses and explains: the
    // bytes above are typed `Uint8Array<ArrayBufferLike>` (the S3 SDK's
    // stream reader does not guarantee a plain `ArrayBuffer`), which the DOM
    // `BodyInit` typing does not accept directly.
    return new NextResponse(bytes.slice(), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeDownloadFilename(document.title)}.pdf"`,
        // Personnel records; never let a shared cache or browser back/forward
        // cache hold a copy after the tab that requested it closes.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof StorageConfigError || error instanceof StorageRequestError) {
      console.error("Document PDF download failed:", error);
      return NextResponse.json({ error: "Could not retrieve the stored PDF right now." }, { status: 502 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Document PDF lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
