// GET/PATCH /api/performance/goals — the cascading goal tree.
//
// Parent progress is computed from children on read, never stored. A manager
// typing 80% while their team sits at 30% is the most common way an OKR system
// stops meaning anything, and it stays invisible until the quarter ends.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonPerformanceRepository } from "@/db/repositories/performance.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const patchSchema = z.object({
  goalId: z.string().uuid(),
  /** Null detaches the goal from its parent. */
  parentGoalId: z.string().uuid().nullable(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const cycleId = new URL(request.url).searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "A cycleId is required" }, { status: 400 });
  }

  try {
    const goals = await new NeonPerformanceRepository(ctx).goalTree(cycleId);

    return NextResponse.json({
      cycleId,
      goals,
      // Surfaced so the UI can prompt a refresh rather than showing two
      // different numbers without explanation.
      staleCount: goals.filter((g) => g.isStale).length,
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Goal tree lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`goals:${ctx.userId}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    await new NeonPerformanceRepository(ctx).linkGoal(
      parsed.data.goalId,
      parsed.data.parentGoalId
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Goal link failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
