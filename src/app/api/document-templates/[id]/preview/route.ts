// POST /api/document-templates/[id]/preview — render a draft against sample
// data and validate it, without saving anything.
//
// The single most valuable endpoint in this feature: it is how someone finds
// out their draft is broken from a dry run instead of from a real candidate's
// offer letter. It never writes — not to document_templates, not to a
// version row — so it can be called on every keystroke's pause without
// consequence, and a template that fails here has still cost nobody
// anything.
//
// Takes the current saved body from the database, not from the request: the
// same self-referential "known token" grandfather clause that makes a
// forged previous body dangerous for PATCH (see that route's header comment)
// applies here too — a client-supplied previous body could make an invented
// token pass silently instead of showing up as a generic placeholder.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonDocumentTemplatesRepository } from "@/db/repositories/document-templates.neon";
import { RepositoryError } from "@/db/repositories/types";
import { previewTemplate, validateTemplateEdit } from "@/lib/document-templates/validation";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { roleHasPermission } from "@/lib/rbac";

const previewSchema = z.object({
  body: z.string().max(100_000),
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

  if (!roleHasPermission(ctx.role, "templates.manage")) {
    return NextResponse.json({ error: "You cannot manage templates" }, { status: 403 });
  }

  // Generous but bounded: a preview is cheap, but nothing here should be
  // callable without limit any more than a save should be.
  const limit = checkRateLimit(`document-templates:preview:${ctx.userId}`, 120, 60_000);
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

  const parsed = previewSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const current = await new NeonDocumentTemplatesRepository(ctx).getById(id);
    if (!current) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const draftBody = parsed.data.body;

    const preview = previewTemplate(current.name, current.body, draftBody);
    const validation = validateTemplateEdit({
      name: current.name,
      category: current.category,
      previousBody: current.body,
      newBody: draftBody,
      requiresSignature: current.requiresSignature,
      signatoryRoles: current.signatoryRoles,
    });

    return NextResponse.json({ preview, validation });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Template preview failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
