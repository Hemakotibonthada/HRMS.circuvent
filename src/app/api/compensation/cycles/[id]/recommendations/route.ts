// GET/POST /api/compensation/cycles/[id]/recommendations
//
// POST generates a defensible starting figure for everyone eligible. That
// matters more than convenience: an empty box is filled in from memory, and
// memory is where bias lives.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonCompensationRepository } from "@/db/repositories/compensation.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const ratings = [
  "outstanding",
  "exceeds",
  "meets",
  "partially_meets",
  "below",
] as const;

const bodySchema = z.object({
  ratings: z.record(z.string().uuid(), z.enum(ratings)),
});

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

  if (!["owner", "admin", "hr", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot view this cycle" }, { status: 403 });
  }

  const { id } = await params;
  const requested = new URL(request.url).searchParams.get("departmentId") ?? undefined;

  try {
    // A manager's scope is resolved from their own employment record inside
    // the repository, never from this query parameter. Everyone's proposed
    // increase is the most sensitive list this system holds, and a query
    // string is not a permission.
    const recommendations = await new NeonCompensationRepository(ctx).listRecommendations(id, {
      departmentId: ctx.role === "manager" ? undefined : requested,
      restrictToManagerId: ctx.role === "manager" ? ctx.userId : undefined,
    });
    return NextResponse.json({ cycleId: id, recommendations });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Recommendation lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

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
    return NextResponse.json({ error: "You cannot generate recommendations" }, { status: 403 });
  }

  // Generation reads every active employee, their band and their rating.
  const limit = checkRateLimit(`comp-generate:${ctx.userId}`, 5, 60_000);
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
    // The skip list comes back rather than being swallowed: someone with no
    // band or no rating is silently excluded from their own pay review
    // otherwise.
    const result = await new NeonCompensationRepository(ctx).generateRecommendations(
      id,
      parsed.data.ratings
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Recommendation generation failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
