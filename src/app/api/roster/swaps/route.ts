// POST /api/roster/swaps — offer one of your own shifts to a colleague.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonRosteringRepository } from "@/db/repositories/rostering.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  assignmentId: z.string().uuid(),
  targetEmployeeId: z.string().uuid().optional(),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`roster-swap:${ctx.userId}`, 20, 60_000);
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
    // The requester is always the caller. Taking it from the body would let
    // someone give away a colleague's shift.
    const swap = await new NeonRosteringRepository(ctx).requestSwap({
      assignmentId: parsed.data.assignmentId,
      requestedById: ctx.userId,
      targetEmployeeId: parsed.data.targetEmployeeId,
      reason: parsed.data.reason,
    });
    return NextResponse.json(swap, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Swap request failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
