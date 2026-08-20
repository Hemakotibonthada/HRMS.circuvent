// POST /api/document-templates/[id]/revert — restore an earlier version as
// the live template.
//
// A revert is deliberately not re-validated against today's token rules (see
// planRevert's header comment in document-templates.neon.ts): this exact text
// was live once already, and refusing to restore it over some rule that
// changed since would leave a broken template with no way back to the last
// known-good state — the one outcome this endpoint exists to prevent.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonDocumentTemplatesRepository } from "@/db/repositories/document-templates.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { roleHasPermission } from "@/lib/rbac";

const revertSchema = z.object({
  toVersion: z.number().int().min(1),
  changeNote: z.string().trim().max(500).optional(),
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

  const limit = checkRateLimit(`document-templates:revert:${ctx.userId}`, 30, 60_000);
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

  const parsed = revertSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const reverted = await new NeonDocumentTemplatesRepository(ctx).revert({
      id,
      toVersion: parsed.data.toVersion,
      changeNote: parsed.data.changeNote,
      revertedById: ctx.userId,
      revertedByEmail: ctx.email ?? null,
    });
    return NextResponse.json(reverted);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Template revert failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
