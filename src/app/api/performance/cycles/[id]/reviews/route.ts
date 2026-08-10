// POST /api/performance/cycles/[id]/reviews — open reviews for a cycle.
//
// The ineligible come back with a reason rather than being silently omitted. A
// new starter who never appears and never hears why assumes they were
// forgotten, and someone on long-term leave being quietly excluded looks like
// exactly the discrimination the exclusion exists to avoid.

import { NextResponse, type NextRequest } from "next/server";
import { NeonPerformanceRepository } from "@/db/repositories/performance.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

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

  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot open a review cycle" }, { status: 403 });
  }

  // Opening a cycle reads every active employee.
  const limit = checkRateLimit(`open-reviews:${ctx.orgId}`, 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id } = await params;

  try {
    return NextResponse.json(await new NeonPerformanceRepository(ctx).openReviews(id));
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Review cycle not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Opening reviews failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
