// POST /api/helpdesk/escalations — recompute SLA state and fire escalations.
//
// Meant to be called on a schedule. Idempotent: fired escalations are recorded
// on the ticket, so running it every minute does not re-notify. An engine that
// re-fires teaches people to mute the channel, and then they miss the real one.

import { NextResponse, type NextRequest } from "next/server";
import { NeonHelpdeskRepository } from "@/db/repositories/helpdesk.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // Scheduled work runs as an admin service account rather than as a person.
  if (!["owner", "admin"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot run escalations" }, { status: 403 });
  }

  // The sweep reads every open ticket and its pauses; running it in a tight
  // loop would be a self-inflicted denial of service.
  const limit = checkRateLimit(`escalations:${ctx.orgId}`, 4, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const result = await new NeonHelpdeskRepository(ctx).runEscalations();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Escalation sweep failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
