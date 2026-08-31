// GET/PATCH /api/helpdesk/[id] — one ticket, and state or assignment changes.
//
// A ticket the caller may not see returns 404, not 403. Confirming that a
// confidential ticket exists is itself a disclosure: "there is a grievance you
// cannot read" tells a manager exactly what they should not know.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonHelpdeskRepository } from "@/db/repositories/helpdesk.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { helpdeskViewerId, requireHelpdeskViewerId } from "@/lib/helpdesk-actor";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("transition"),
    state: z.enum([
      "new",
      "open",
      "pending_requester",
      "pending_third_party",
      "resolved",
      "closed",
    ]),
  }),
  z.object({ action: z.literal("assign"), assigneeId: z.string().uuid() }),
  z.object({
    action: z.literal("rate"),
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).optional(),
  }),
]);

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
    const viewerId = (await helpdeskViewerId(ctx)) ?? "";
    const result = await new NeonHelpdeskRepository(ctx).getTicket(id, viewerId, ctx.role);
    return NextResponse.json({
      ...result,
      sla: {
        ...result.sla,
        responseDueAt: result.sla.responseDueAt.toISOString(),
        resolutionDueAt: result.sla.resolutionDueAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Ticket lookup failed:", error);
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

  const limit = checkRateLimit(`helpdesk-update:${ctx.userId}`, 60, 60_000);
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
    const viewerId = await requireHelpdeskViewerId(ctx);
    const { ticket } = await repo.getTicket(id, viewerId, ctx.role);

    if (parsed.data.action === "assign") {
      if (!isAgent) {
        return NextResponse.json({ error: "You cannot assign tickets" }, { status: 403 });
      }
      return NextResponse.json(await repo.assign(id, parsed.data.assigneeId, viewerId));
    }

    if (parsed.data.action === "rate") {
      if (ticket.requesterId !== viewerId) {
        return NextResponse.json(
          { error: "Only the person who raised the ticket can rate it" },
          { status: 403 }
        );
      }
      if (ticket.state !== "resolved" && ticket.state !== "closed") {
        return NextResponse.json(
          { error: "This ticket has not been resolved yet" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        await repo.rate(id, parsed.data.rating, parsed.data.comment)
      );
    }

    // A requester may close or reopen their own ticket; everything else is an
    // agent action.
    const requesterAllowed = ["closed", "open"];
    if (!isAgent && !requesterAllowed.includes(parsed.data.state)) {
      return NextResponse.json({ error: "You cannot make that change" }, { status: 403 });
    }

    return NextResponse.json(await repo.transition(id, parsed.data.state, viewerId));
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Ticket update failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
