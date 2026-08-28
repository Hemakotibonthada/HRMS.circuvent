// GET/POST /api/helpdesk — tickets.
//
// This replaces a stub that authenticated the caller and then returned
// `data: []` with a summary of all zeroes — which reads as "you have no
// tickets" rather than "this is not built", and is the worse of the two.
//
// Confidentiality is enforced in the repository's WHERE clause, not here. An
// HR helpdesk carries grievances about managers, and a filter applied after
// fetching is one refactor away from a leak.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonHelpdeskRepository } from "@/db/repositories/helpdesk.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { helpdeskViewerId, requireHelpdeskViewerId } from "@/lib/helpdesk-actor";
import { ensureHelpdeskDefaults } from "@/lib/helpdesk-bootstrap";

const states = [
  "new",
  "open",
  "pending_requester",
  "pending_third_party",
  "resolved",
  "closed",
] as const;

const createSchema = z.object({
  subject: z.string().trim().min(3, "Give the ticket a subject").max(200),
  body: z.string().trim().min(1, "Describe the problem").max(20_000),
  categoryId: z.string().uuid().optional(),
  priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  /** Raising on someone else's behalf, which HR does for people who ring in. */
  requesterId: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state");

  if (state && !states.includes(state as (typeof states)[number])) {
    return NextResponse.json({ error: "Unknown state" }, { status: 400 });
  }

  try {
    // `raised_by_id` and the assignment column are foreign keys to `employees`,
    // so the viewer has to be an employee id or "my tickets" matches nothing.
    // Without an employment record there is nothing of one's own to see, and
    // an empty string can never equal a uuid — so confidential tickets stay
    // hidden rather than being widened by a null.
    const viewerId = (await helpdeskViewerId(ctx)) ?? "";
    const items = await new NeonHelpdeskRepository(ctx).listVisible(viewerId, ctx.role, {
      state: (state as (typeof states)[number]) ?? undefined,
      assignedToMe: searchParams.get("assignedToMe") === "true",
      breachRisk: searchParams.get("breachRisk") === "true",
    });

    return NextResponse.json({
      tickets: items,
      // Counted from what this caller can actually see, so the summary and
      // the list can never disagree.
      summary: {
        total: items.length,
        open: items.filter((t) => t.state === "new" || t.state === "open").length,
        waiting: items.filter((t) => t.state.startsWith("pending_")).length,
        resolved: items.filter((t) => t.state === "resolved" || t.state === "closed").length,
        breached: items.filter((t) => t.responseBreached || t.resolutionBreached).length,
      },
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Ticket lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`helpdesk:${ctx.userId}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    await ensureHelpdeskDefaults(ctx);
    const requesterEmployeeId = await requireHelpdeskViewerId(ctx);

    const onBehalf =
      parsed.data.requesterId && parsed.data.requesterId !== requesterEmployeeId;
    if (onBehalf && !["owner", "admin", "hr"].includes(ctx.role)) {
      return NextResponse.json(
        { error: "You cannot raise a ticket for someone else" },
        { status: 403 }
      );
    }

    const ticket = await new NeonHelpdeskRepository(ctx).createTicket({
      subject: parsed.data.subject,
      body: parsed.data.body,
      requesterId: onBehalf ? parsed.data.requesterId! : requesterEmployeeId,
      raisedById: onBehalf ? requesterEmployeeId : undefined,
      categoryId: parsed.data.categoryId,
      priority: parsed.data.priority,
      tags: parsed.data.tags,
    });

    return NextResponse.json(ticket, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Ticket creation failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
