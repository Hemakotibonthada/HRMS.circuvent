// POST /api/compensation/cycles/[id]/approve — commit against the budget.
//
// The budget check and the commit happen in one locked transaction inside the
// repository. Checking outside it lets two managers both read the same
// remaining figure and both fit, and the overspend is only found when finance
// reconciles — by which point the increases have been communicated.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonCompensationRepository } from "@/db/repositories/compensation.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  recommendationIds: z.array(z.string().uuid()).min(1).max(1000),
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

  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot approve increases" }, { status: 403 });
  }

  const limit = checkRateLimit(`comp-approve:${ctx.userId}`, 30, 60_000);
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
    const result = await new NeonCompensationRepository(ctx).approve(
      id,
      parsed.data.recommendationIds,
      ctx.userId
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Approval failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
