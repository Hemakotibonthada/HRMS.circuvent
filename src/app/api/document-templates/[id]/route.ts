// GET/PATCH /api/document-templates/[id] — one template's current body and
// metadata, and the endpoint that saves an edit.
//
// PATCH never accepts a "previous body" from the client: the repository's
// update() re-reads the locked, currently-saved row itself before validating
// or writing anything. If a client's own claim about what the template used
// to say were trusted, a forged previous body could make an invented token
// look self-referentially known to validateTemplateEdit (see that function's
// header comment) and let a broken token straight through.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonDocumentTemplatesRepository } from "@/db/repositories/document-templates.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { roleHasPermission } from "@/lib/rbac";

const patchSchema = z.object({
  body: z.string().min(1).max(100_000),
  changeNote: z.string().trim().max(500).optional(),
});

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
    const template = await new NeonDocumentTemplatesRepository(ctx).getById(id);
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    return NextResponse.json(template);
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Template lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
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

  const limit = checkRateLimit(`document-templates:update:${ctx.userId}`, 30, 60_000);
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

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const updated = await new NeonDocumentTemplatesRepository(ctx).update({
      id,
      newBody: parsed.data.body,
      changeNote: parsed.data.changeNote,
      editedById: ctx.userId,
      editedByEmail: ctx.email ?? null,
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      // update() already ran validateTemplateEdit and its message names the
      // specific bad token(s) — see that function's message-building logic —
      // so there is nothing to add here beyond passing it through.
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Template update failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
