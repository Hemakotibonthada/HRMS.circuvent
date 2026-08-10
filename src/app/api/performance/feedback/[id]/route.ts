// POST /api/performance/feedback/[id] — submit 360° feedback.
//
// Once only. Allowing a rewrite would let someone be persuaded to revise what
// they said, which is precisely the pressure anonymity exists to remove.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonPerformanceRepository } from "@/db/repositories/performance.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  ratings: z.record(z.string().uuid(), z.number().int().min(1).max(5)),
  strengths: z.string().trim().max(5000).optional(),
  improvements: z.string().trim().max(5000).optional(),
  comments: z.string().trim().max(5000).optional(),
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

  const limit = checkRateLimit(`feedback-submit:${ctx.userId}`, 30, 60_000);
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

  try {
    // The respondent is always the caller; the repository refuses a request
    // that is not theirs. Taking it from the body would let someone submit
    // feedback in a colleague's name.
    const result = await new NeonPerformanceRepository(ctx).submitFeedback(
      id,
      ctx.userId,
      parsed.data
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Feedback request not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Feedback submission failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
