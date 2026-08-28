// GET /api/roster/rosters/[id] — a roster with its shifts, gaps and violations.
//
// Violations are recomputed on read rather than stored. A roster that was
// valid at generation can be invalidated by leave approved afterwards, and
// showing a stale "all clear" is worse than showing nothing.

import { NextResponse, type NextRequest } from "next/server";
import { NeonRosteringRepository } from "@/db/repositories/rostering.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

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
    const roster = await new NeonRosteringRepository(ctx).getRoster(id);
    if (!roster) {
      return NextResponse.json({ error: "Roster not found" }, { status: 404 });
    }

    // A draft roster is a work in progress; showing it to the people in it
    // would have them planning around shifts that may still change.
    if (
      roster.status !== "published" &&
      !["owner", "admin", "hr", "manager"].includes(ctx.role)
    ) {
      return NextResponse.json({ error: "Roster not found" }, { status: 404 });
    }

    return NextResponse.json(roster);
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Roster lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
