// GET /api/compensation/equity — vesting position for a grant holder.
//
// Someone may always see their own. Anyone else's is restricted, because an
// equity register is a list of who has how much of the company.

import { NextResponse, type NextRequest } from "next/server";
import { NeonCompensationRepository } from "@/db/repositories/compensation.neon";
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
  const privileged = ["owner", "admin", "hr"].includes(ctx.role);

  if (requested && requested !== ctx.userId && !privileged) {
    return NextResponse.json({ error: "You can only view your own grants" }, { status: 403 });
  }

  const employeeId = requested ?? ctx.userId;

  const asOf = searchParams.get("asOf") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return NextResponse.json({ error: "asOf must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const grants = await new NeonCompensationRepository(ctx).vestingFor(employeeId, asOf);
    return NextResponse.json({
      employeeId,
      asOf,
      grants,
      totalVested: grants.reduce((sum, g) => sum + g.vestedUnits, 0),
      totalUnvested: grants.reduce((sum, g) => sum + g.unvestedUnits, 0),
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Vesting lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
