// POST /api/performance/calibration — record a rating change.
//
// A 422 here means someone tried to change a rating without saying why. "My
// manager rated me a 4 and I was given a 3" is a conversation that has to be
// answerable with who changed it and on what basis, and it is usually had
// months later at an appeal.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonPerformanceRepository } from "@/db/repositories/performance.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  reviewId: z.string().uuid(),
  newRating: z.number().min(1).max(5),
  justification: z
    .string()
    .trim()
    .min(10, "Explain why this rating is being changed")
    .max(2000),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot calibrate ratings" }, { status: 403 });
  }

  const limit = checkRateLimit(`calibration:${ctx.userId}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

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
    const result = await new NeonPerformanceRepository(ctx).adjustRating({
      ...parsed.data,
      adjustedById: ctx.userId,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Calibration adjustment failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
