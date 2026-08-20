// GET /api/learning/courses — the catalogue, with enrolment state resolved.

import { NextResponse, type NextRequest } from "next/server";
import { NeonLearningRepository } from "@/db/repositories/learning.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";

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

  const today = new Date().toISOString().slice(0, 10);

  try {
    // ctx.userId is the signing-in account, not the employment record the
    // catalogue's eligibility and enrolment state are keyed by — see
    // lib/current-employee.ts.
    const self = await currentEmployeeId(ctx);
    const employeeId = privileged && requested ? requested : self;

    if (!employeeId) {
      return NextResponse.json({ employeeId: null, courses: [] });
    }

    const catalogue = await new NeonLearningRepository(ctx).catalogue(employeeId, today);
    return NextResponse.json({ employeeId, courses: catalogue });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Course catalogue lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
