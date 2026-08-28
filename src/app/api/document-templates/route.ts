// GET /api/document-templates — every editable template, with who last
// changed it and whether it is still the shipped default.
//
// This is a distinct family from /api/documents/templates (documents.neon.ts's
// saveTemplate/listTemplates): that route pre-dates version history and
// writes document_templates.body directly with no validation, no origin
// tracking and no author trail. It is left alone here — outside this
// feature's ownership boundary — but nothing in this file, and nothing HR
// reaches through this UI, goes through it.

import { NextResponse, type NextRequest } from "next/server";
import { NeonDocumentTemplatesRepository } from "@/db/repositories/document-templates.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { roleHasPermission } from "@/lib/rbac";

export async function GET(request: NextRequest) {
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

  try {
    const templates = await new NeonDocumentTemplatesRepository(ctx).list();
    return NextResponse.json({ templates });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Template list failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
