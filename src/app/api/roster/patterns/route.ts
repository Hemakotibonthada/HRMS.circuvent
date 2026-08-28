// GET/POST /api/roster/patterns — the shift definitions a roster is built from.
//
// Patterns are org configuration, not employee data: creating one changes what
// everybody can be scheduled onto, so writes are restricted to HR and admins.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonRosteringRepository } from "@/db/repositories/rostering.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9_-]+$/, "Codes are uppercase letters, numbers, hyphens and underscores"),
  description: z.string().trim().max(500).optional(),
  colour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value like #64748b")
    .optional(),
  startTime: z.string().regex(CLOCK, "Start time must be HH:MM"),
  endTime: z.string().regex(CLOCK, "End time must be HH:MM"),
  breakMinutes: z.number().int().min(0).max(600).optional(),
  crossesMidnight: z.boolean().optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  // A multiplier below 1 would cut pay for working an unsociable shift, which
  // is the opposite of what a shift premium is for.
  payMultiplier: z.number().min(1).max(5).optional(),
  allowanceMinor: z.number().int().min(0).max(10_000_000).optional(),
  departmentId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const includeInactive =
    new URL(request.url).searchParams.get("includeInactive") === "true" &&
    ["owner", "admin", "hr"].includes(ctx.role);

  try {
    const patterns = await new NeonRosteringRepository(ctx).listPatterns(includeInactive);
    return NextResponse.json({ patterns });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Shift pattern lookup failed:", error);
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

  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot manage shift patterns" }, { status: 403 });
  }

  const limit = checkRateLimit(`roster-patterns:${ctx.userId}`, 30, 60_000);
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
    const pattern = await new NeonRosteringRepository(ctx).createPattern(parsed.data);
    return NextResponse.json(pattern, { status: 201 });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Shift pattern creation failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
