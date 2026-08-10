// PATCH /api/compensation/recommendations/[id] — a manager's proposal.
//
// A 422 here means the manager departed from the guideline without saying why.
// That is not a UI nicety: at calibration somebody has to defend why two
// similar people got different numbers, and an unexplained override is exactly
// what an equal-pay claim is built from.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonCompensationRepository } from "@/db/repositories/compensation.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  percent: z.number().min(0).max(100),
  overrideReason: z.string().trim().max(1000).optional(),
  promotionToGradeCode: z.string().trim().max(20).optional(),
});

export async function PATCH(
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

  if (!["owner", "admin", "hr", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot propose increases" }, { status: 403 });
  }

  const limit = checkRateLimit(`comp-propose:${ctx.userId}`, 120, 60_000);
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
    const recommendation = await new NeonCompensationRepository(ctx).propose(
      id,
      parsed.data,
      ctx.userId
    );
    return NextResponse.json(recommendation);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Proposal failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
