// POST /api/documents/[id]/send — issue signing links and email them.

import { NextResponse, type NextRequest } from "next/server";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { issueDocumentAndEmail } from "@/lib/issue-document";

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
    const result = await issueDocumentAndEmail(
      ctx,
      id,
      new URL(request.url).origin
    );

    return NextResponse.json({
      document: result.document,
      links: result.links,
      delivery: result.delivery.map(({ email, role, sent, reason }) => ({
        email,
        role,
        sent,
        reason,
      })),
      mailConfigured: result.mailConfigured,
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
