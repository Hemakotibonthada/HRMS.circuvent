// GET /api/performance/cycles/[id]/distribution — the calibration curve.
//
// Reports what the distribution is, never reshapes it. Forced distribution is
// contentious enough without software silently moving someone down a band to
// make a curve fit — a manager should have to look at the number of people
// they are about to re-rate and decide that deliberately.

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

  if (!["owner", "admin", "hr", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot view the distribution" }, { status: 403 });
  }

  const { id } = await params;
  const departmentId = new URL(request.url).searchParams.get("departmentId") ?? undefined;

  try {
    return NextResponse.json(
      await new NeonPerformanceRepository(ctx).distributionFor(id, departmentId)
    );
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Distribution lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
