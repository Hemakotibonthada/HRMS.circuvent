// POST /api/roster/rosters/[id]/publish — turn a draft into a commitment.
//
// A 422 carries the violations, not just a count: the grid has to highlight
// the offending shifts, and "this roster breaks 3 rules" cannot be acted on
// without knowing which ones and whose.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  NeonRosteringRepository,
  RosterConstraintError,
} from "@/db/repositories/rostering.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  acceptedWarnings: z
    .array(
      z.object({
        code: z.string().min(1),
        employeeId: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        // An override with no reason recorded is indistinguishable from an
        // oversight when someone reviews it months later.
        justification: z
          .string()
          .trim()
          .min(10, "Explain why this warning is acceptable")
          .max(500),
      })
    )
    .max(200)
    .optional(),
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
    return NextResponse.json({ error: "You cannot publish rosters" }, { status: 403 });
  }

  const limit = checkRateLimit(`roster-publish:${ctx.userId}`, 20, 60_000);
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
    const roster = await new NeonRosteringRepository(ctx).publish(
      id,
      ctx.userId,
      parsed.data.acceptedWarnings ?? []
    );
    return NextResponse.json(roster);
  } catch (error) {
    if (error instanceof RosterConstraintError) {
      return NextResponse.json(
        { error: error.message, violations: error.violations },
        { status: 422 }
      );
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Roster not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Roster publication failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
