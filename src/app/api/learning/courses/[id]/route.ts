// GET /api/learning/courses/[id] — a course with its modules, for the learner.
//
// Assessment answers are stripped by the repository before this responds.
// Sending them to the browser would make every assessment decorative.

import { NextResponse, type NextRequest } from "next/server";
import { NeonLearningRepository } from "@/db/repositories/learning.neon";
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

  const { id } = await params;

  try {
    const result = await new NeonLearningRepository(ctx).courseForLearner(id, ctx.userId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Course lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
