// GET/POST /api/performance/check-ins — continuous one-to-ones.
//
// The annual review is a poor feedback mechanism on its own: a problem raised
// in March and first mentioned in December has had nine months to become
// someone's reason for leaving.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonPerformanceRepository } from "@/db/repositories/performance.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  employeeId: z.string().uuid(),
  heldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employeeNotes: z.string().trim().max(10_000).optional(),
  managerNotes: z.string().trim().max(10_000).optional(),
  privateNotes: z.string().trim().max(10_000).optional(),
  moodRating: z.number().int().min(1).max(5).optional(),
  agreedActions: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(500),
        dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
    )
    .max(20)
    .optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const requested = new URL(request.url).searchParams.get("employeeId");
  const isManagerish = ["owner", "admin", "hr", "manager"].includes(ctx.role);

  if (requested && requested !== ctx.userId && !isManagerish) {
    return NextResponse.json({ error: "You can only view your own" }, { status: 403 });
  }

  const employeeId = requested ?? ctx.userId;

  try {
    // Private notes are stripped by the repository unless the caller is the
    // manager who wrote them — selecting and filtering later would put them in
    // a response body one mistake away from being rendered.
    const history = await new NeonPerformanceRepository(ctx).checkInHistory(
      employeeId,
      ctx.userId,
      isManagerish
    );
    return NextResponse.json({ employeeId, checkIns: history });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Check-in lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`check-ins:${ctx.userId}`, 30, 60_000);
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

  const isManagerish = ["owner", "admin", "hr", "manager"].includes(ctx.role);
  const isOwn = parsed.data.employeeId === ctx.userId;

  if (!isOwn && !isManagerish) {
    return NextResponse.json({ error: "You cannot record this check-in" }, { status: 403 });
  }

  // A private note is the manager's own aide-memoire, not part of the
  // employee's record. Someone writing about themselves has no use for one,
  // and accepting it would put text in a field the employee cannot see on a
  // record that is theirs.
  if (parsed.data.privateNotes && isOwn) {
    return NextResponse.json(
      { error: "Private notes can only be added by a manager" },
      { status: 403 }
    );
  }

  try {
    const result = await new NeonPerformanceRepository(ctx).recordCheckIn({
      ...parsed.data,
      managerId: isOwn ? undefined : ctx.userId,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Check-in failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
