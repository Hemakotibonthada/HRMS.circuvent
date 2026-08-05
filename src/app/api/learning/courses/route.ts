// GET /api/learning/courses — the catalogue, with enrolment state resolved.

import { NextResponse, type NextRequest } from "next/server";
import { NeonLearningRepository } from "@/db/repositories/learning.neon";
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
  const employeeId = privileged && requested ? requested : ctx.userId;

  const today = new Date().toISOString().slice(0, 10);

  try {
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
