// POST /api/learning/enrolments/[id]/progress — mark a module complete.
//
// Progress is recomputed from the stored module ids, never incremented by the
// client. A client-supplied percentage is a self-certified completion.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonLearningRepository } from "@/db/repositories/learning.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  moduleId: z.string().uuid(),
  // Capped: a client claiming eight hours on a ten-minute module is either
  // broken or gaming a training-hours report.
  minutesSpent: z.number().int().min(0).max(600).optional(),
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

  const limit = checkRateLimit(`learning-progress:${ctx.userId}`, 120, 60_000);
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
    const enrolment = await new NeonLearningRepository(ctx).completeModule(
      id,
      parsed.data.moduleId,
      ctx.userId,
      parsed.data.minutesSpent ?? 0
    );
    return NextResponse.json(enrolment);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Enrolment not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Progress update failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
