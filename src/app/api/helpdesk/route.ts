import { NextRequest, NextResponse } from "next/server";
import { verifyRequest, authErrorResponse } from "@/lib/server-auth";

// ═══════════════════════════════════════════════════════════════
// HRMS API — Helpdesk & Tickets
// Create, assign, resolve support tickets
// ═══════════════════════════════════════════════════════════════

export async function GET(request: NextRequest) {
  try {
    await verifyRequest(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const priority = searchParams.get("priority");
  const assignee = searchParams.get("assignee");

  return NextResponse.json({
    data: [],
    summary: { total: 0, open: 0, inProgress: 0, resolved: 0, avgResolutionHours: 0 },
    filters: { status, category, priority, assignee },
  });
}

export async function POST(request: NextRequest) {
  try {
    await verifyRequest(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "create") {
      const required = ["title", "category", "priority", "description", "reporterId"];
      const missing = required.filter((f) => !body[f]);
      if (missing.length > 0) {
        return NextResponse.json({ error: `Missing: ${missing.join(", ")}` }, { status: 400 });
      }

      const ticket = {
        id: `TKT-${String(Date.now()).slice(-6)}`,
        ...body,
        status: "open",
        replies: 0,
        createdAt: new Date().toISOString(),
      };

      return NextResponse.json({ data: ticket, message: "Ticket created" }, { status: 201 });
    }

    if (action === "assign") {
      const { ticketId, assigneeId, assigneeName } = body;
      if (!ticketId || !assigneeId) {
        return NextResponse.json({ error: "ticketId and assigneeId required" }, { status: 400 });
      }
      return NextResponse.json({
        data: { ticketId, assigneeId, assigneeName, status: "in_progress" },
        message: "Ticket assigned",
      });
    }

    if (action === "reply") {
      const { ticketId, message, authorId, isInternal } = body;
      if (!ticketId || !message || !authorId) {
        return NextResponse.json({ error: "ticketId, message, and authorId required" }, { status: 400 });
      }
      const reply = {
        id: `RPL-${Date.now()}`,
        ticketId, message, authorId,
        isInternal: isInternal || false,
        createdAt: new Date().toISOString(),
      };
      return NextResponse.json({ data: reply, message: "Reply added" }, { status: 201 });
    }

    if (action === "resolve") {
      const { ticketId, resolution } = body;
      if (!ticketId) return NextResponse.json({ error: "ticketId required" }, { status: 400 });
      return NextResponse.json({
        data: { ticketId, status: "resolved", resolution, resolvedAt: new Date().toISOString() },
        message: "Ticket resolved",
      });
    }

    if (action === "close") {
      const { ticketId } = body;
      if (!ticketId) return NextResponse.json({ error: "ticketId required" }, { status: 400 });
      return NextResponse.json({
        data: { ticketId, status: "closed", closedAt: new Date().toISOString() },
        message: "Ticket closed",
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
