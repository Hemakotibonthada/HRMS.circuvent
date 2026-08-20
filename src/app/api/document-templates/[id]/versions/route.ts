// GET /api/document-templates/[id]/versions — the edit history for one
// template, newest first.
//
// Every row here is a past version of a legal document (offer and relieving
// letters are contracts) with who changed it and when. This endpoint is the
// only way a human can answer "what did this letter say before, and who
// changed it" without reading raw SQL — the liability the task calls out
// exists precisely because that question used to have no answer at all.

import { NextResponse, type NextRequest } from "next/server";
import { NeonDocumentTemplatesRepository } from "@/db/repositories/document-templates.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { roleHasPermission } from "@/lib/rbac";

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

  if (!roleHasPermission(ctx.role, "templates.manage")) {
    return NextResponse.json({ error: "You cannot manage templates" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const repo = new NeonDocumentTemplatesRepository(ctx);
    const template = await repo.getById(id);
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    const versions = await repo.listVersions(id);
    return NextResponse.json({ versions });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Template version history failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
