// GET /api/helpdesk/knowledge — search articles before raising a ticket.
//
// The cheapest ticket is the one nobody needed to raise. This is meant to be
// called as the requester types the subject, so an answer is offered before
// the form is submitted.

import { NextResponse, type NextRequest } from "next/server";
import { NeonHelpdeskRepository } from "@/db/repositories/helpdesk.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // Generous, because this fires while someone is typing.
  const limit = checkRateLimit(`kb:${ctx.userId}`, 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const query = new URL(request.url).searchParams.get("q") ?? "";
  if (query.trim().length < 3) {
    // Not an error: the caller is mid-word, and an error banner appearing
    // after three keystrokes is worse than nothing.
    return NextResponse.json({ articles: [] });
  }

  try {
    const articles = await new NeonHelpdeskRepository(ctx).searchKnowledge(
      query.slice(0, 200),
      ctx.role
    );
    return NextResponse.json({ articles });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Knowledge search failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
