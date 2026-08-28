// POST /api/learning/enrolments/[id]/assessment — submit answers for grading.
//
// Grading happens on the server. The correct answers never reach the browser,
// so an assessment cannot be passed by reading the page source.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonLearningRepository } from "@/db/repositories/learning.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  moduleId: z.string().uuid(),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1).max(100),
        answer: z.union([z.string().max(2000), z.array(z.string().max(500)).max(50)]),
      })
    )
    .min(1)
    .max(200),
});

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

  // Tighter than other writes: each submission consumes an attempt, and a
  // burst is either a bug or someone brute-forcing a multiple-choice paper.
  const limit = checkRateLimit(`learning-assessment:${ctx.userId}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const result = await new NeonLearningRepository(ctx).submitAssessment(
      id,
      parsed.data.moduleId,
      ctx.userId,
      parsed.data.answers,
      today
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Enrolment not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Assessment submission failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
