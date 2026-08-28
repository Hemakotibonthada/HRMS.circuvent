// POST /api/roster/rosters — create a roster period to schedule into.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonRosteringRepository } from "@/db/repositories/rostering.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  periodStart: z.string().regex(DATE, "Dates must be YYYY-MM-DD"),
  periodEnd: z.string().regex(DATE, "Dates must be YYYY-MM-DD"),
  departmentId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!["owner", "admin", "hr", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot create rosters" }, { status: 403 });
  }

  const limit = checkRateLimit(`roster-create:${ctx.userId}`, 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const roster = await new NeonRosteringRepository(ctx).createRoster({
      ...parsed.data,
      createdById: ctx.userId,
    });
    return NextResponse.json(roster, { status: 201 });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Roster creation failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET — rosters overlapping a period. Only a single roster could be fetched
// by id; nothing could list them, so there was no way to find the id.
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    const params = new URL(request.url).searchParams;
    const rosters = await new NeonRosteringRepository(ctx).listRosters({
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      status: params.get("status") ?? undefined,
    });
    return NextResponse.json({ rosters });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Roster list failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
