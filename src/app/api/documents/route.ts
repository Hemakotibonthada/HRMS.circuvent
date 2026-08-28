// GET /api/documents — every document the tenant has generated.
//
// The letters screen had no endpoint to read from, so it kept its history in a
// client-side store that emptied on reload. Anything generated before a
// refresh was still in the database and simply invisible, which reads as "the
// letter was never created".
//
// Bodies are deliberately not returned here. A list of fifty offers with their
// rendered HTML is megabytes, and every one of them contains somebody's salary;
// the detail route returns a body for one document at a time, where the access
// check is about that document.

import { NextResponse, type NextRequest } from "next/server";
import { NeonDocumentsRepository } from "@/db/repositories/documents.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

const STATUSES = new Set([
  "draft",
  "sent",
  "viewed",
  "partially_signed",
  "completed",
  "declined",
  "expired",
  "voided",
]);

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // A document carries salary, and often a candidate's personal details. The
  // people who may see the whole tenant's worth of them are the people who
  // issue them.
  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot list documents" }, { status: 403 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  if (status && !STATUSES.has(status)) {
    return NextResponse.json({ error: "Unknown status" }, { status: 400 });
  }

  const limitParam = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitParam) ? limitParam : 100;

  try {
    const documents = await new NeonDocumentsRepository(ctx).list({ status, limit });

    return NextResponse.json({
      documents: documents.map(({ renderedBody: _body, ...rest }) => rest),
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Document listing failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
