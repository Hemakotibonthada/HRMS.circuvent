// GET /api/assets/clearance — what a leaver still holds.
//
// Valued at book value, not purchase cost. Charging someone the full price of
// a four-year-old laptop is neither defensible nor, in most jurisdictions,
// lawful — and a clearance figure that cannot be defended is one that gets
// waived entirely.

import { NextResponse, type NextRequest } from "next/server";
import { NeonAssetsRepository } from "@/db/repositories/assets.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("employeeId");
  const privileged = ["owner", "admin", "hr", "manager"].includes(ctx.role);

  if (requested && requested !== ctx.userId && !privileged) {
    return NextResponse.json({ error: "You can only view your own" }, { status: 403 });
  }

  const employeeId = requested ?? ctx.userId;

  const asOf = searchParams.get("asOf") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return NextResponse.json({ error: "asOf must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const clearance = await new NeonAssetsRepository(ctx).clearanceFor(employeeId, asOf);
    return NextResponse.json({ employeeId, asOf, ...clearance });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Clearance lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
