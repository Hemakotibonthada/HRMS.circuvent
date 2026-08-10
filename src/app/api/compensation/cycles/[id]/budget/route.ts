// GET /api/compensation/cycles/[id]/budget — where each pool stands.
//
// Reports allocated, already committed and still proposed separately. A single
// "remaining" figure hides whether a pool is over because of decisions already
// made or because of proposals that can still be changed — and those call for
// entirely different responses.

import { NextResponse, type NextRequest } from "next/server";
import { NeonCompensationRepository } from "@/db/repositories/compensation.neon";
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

  if (!["owner", "admin", "hr", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot view this budget" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const pools = await new NeonCompensationRepository(ctx).budgetSummary(id);
    return NextResponse.json({
      cycleId: id,
      pools,
      overspent: pools.filter((p) => !p.withinBudget).length,
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Budget summary failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
