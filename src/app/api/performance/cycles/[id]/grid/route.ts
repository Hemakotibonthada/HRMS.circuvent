// GET /api/performance/cycles/[id]/grid — the nine-box talent grid.
//
// A succession list naming who is considered a star and who is a risk. It is
// among the most sensitive views in the system, and it is restricted
// accordingly — a manager reading their own placement would change how they
// behave, and reading a colleague's would change how they treat them.

import { NextResponse, type NextRequest } from "next/server";
import { NeonPerformanceRepository } from "@/db/repositories/performance.neon";
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

  if (!["owner", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot view the talent grid" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const grid = await new NeonPerformanceRepository(ctx).talentGrid(id);

    const byCell: Record<string, number> = {};
    for (const entry of grid) byCell[entry.cell] = (byCell[entry.cell] ?? 0) + 1;

    return NextResponse.json({ cycleId: id, placements: grid, byCell });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Talent grid lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
