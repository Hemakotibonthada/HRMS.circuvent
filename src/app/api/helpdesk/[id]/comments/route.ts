// POST /api/helpdesk/[id]/comments — reply to a ticket.
//
// An internal note is agent-only, and the check is here as well as in the
// repository. An internal note shown to a requester is how a disciplinary
// discussion reaches the person it is about.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonHelpdeskRepository } from "@/db/repositories/helpdesk.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  body: z.string().trim().min(1, "Write something").max(20_000),
  isInternal: z.boolean().optional(),
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

  const limit = checkRateLimit(`helpdesk-comment:${ctx.userId}`, 60, 60_000);
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

  const repo = new NeonHelpdeskRepository(ctx);
  const isAgent = ["owner", "admin", "hr", "manager"].includes(ctx.role);

  try {
    // Reading first applies the same visibility rules as GET, so nobody can
    // comment on a ticket they cannot see.
    await repo.getTicket(id, ctx.userId, ctx.role);

    const result = await repo.comment(id, ctx.userId, parsed.data.body, {
      isInternal: parsed.data.isInternal,
      isAgent,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Comment failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
