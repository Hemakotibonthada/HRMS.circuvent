// GET /api/documents/[id] — a document with its signature trail.

import { NextResponse, type NextRequest } from "next/server";
import { NeonDocumentsRepository } from "@/db/repositories/documents.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

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

  const { id } = await params;

  try {
    const document = await new NeonDocumentsRepository(ctx).get(id);
    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Documents are personnel records. Someone may read their own; anyone
    // else's needs HR standing.
    const isOwn = document.employeeId === ctx.userId;
    if (!isOwn && !["owner", "admin", "hr"].includes(ctx.role)) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    return NextResponse.json(document);
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Document lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
