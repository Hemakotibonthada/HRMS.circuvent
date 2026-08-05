// POST /api/roster/rosters/[id]/generate — fill a roster from coverage rules.
//
// Returns the roster including the gaps it could not fill. A partial roster
// plus an explicit shortfall list is actionable; refusing to generate anything
// because the problem is over-constrained is not.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonRosteringRepository } from "@/db/repositories/rostering.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  constraints: z
    .object({
      // Bounded rather than free: a "minimum rest" of zero is not a
      // configuration choice, it is a bug someone will blame the system for.
      minRestHours: z.number().min(8).max(24).optional(),
      maxHoursPerWeek: z.number().min(1).max(80).optional(),
      maxConsecutiveDays: z.number().int().min(1).max(14).optional(),
      maxShiftsPerDay: z.number().int().min(1).max(3).optional(),
      minDaysOffPerWeek: z.number().int().min(0).max(4).optional(),
    })
    .optional(),
  replaceExisting: z.boolean().optional(),
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

  if (!["owner", "admin", "hr", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot generate rosters" }, { status: 403 });
  }

  // Generation loads every eligible employee and their availability, so it is
  // far heavier than a normal write.
  const limit = checkRateLimit(`roster-generate:${ctx.userId}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id } = await params;

  let raw: unknown = {};
  try {
    const text = await request.text();
    if (text.trim()) raw = JSON.parse(text);
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
    const roster = await new NeonRosteringRepository(ctx).generate({
      rosterId: id,
      constraints: parsed.data.constraints,
      replaceExisting: parsed.data.replaceExisting,
    });
    return NextResponse.json(roster);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Roster not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Roster generation failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
