// POST /api/compensation/cycles/[id]/apply — write approved increases through.
//
// The last irreversible step of the cycle: it changes what people are paid and
// writes salary history. Restricted to owner and admin, and the repository
// refuses a second application because applying twice would compound every
// increase.

import { NextResponse, type NextRequest } from "next/server";
import { NeonCompensationRepository } from "@/db/repositories/compensation.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

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

  if (!["owner", "admin"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot apply a compensation cycle" }, { status: 403 });
  }

  const limit = checkRateLimit(`comp-apply:${ctx.userId}`, 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id } = await params;

  try {
    const result = await new NeonCompensationRepository(ctx).apply(id, ctx.userId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Cycle application failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
