// GET /api/assets/[id]/schedule — the month-by-month depreciation schedule.
//
// Auditors ask for this, and it cannot be reconstructed from a single book
// value.

import { NextResponse, type NextRequest } from "next/server";
import { NeonAssetsRepository } from "@/db/repositories/assets.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
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

  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot view depreciation" }, { status: 403 });
  }

  const { id } = await params;

  try {
    return NextResponse.json({ schedule: await new NeonAssetsRepository(ctx).scheduleFor(id) });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Schedule lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
