// GET/POST /api/ats/applications/[id]/scorecards
//
// GET returns the panel only to someone who has already submitted their own
// assessment, or to the hiring manager. Panels converge hard on the first
// opinion voiced, and showing previous scores while the next interviewer is
// still typing turns four independent assessments into one repeated four
// times — which is worse than one, because it looks like corroboration.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonAtsRepository } from "@/db/repositories/ats.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  interviewId: z.string().uuid().optional(),
  scores: z.record(z.string().min(1).max(80), z.number().int().min(1).max(5)),
  recommendation: z.enum(["strong_hire", "hire", "no_hire", "strong_no_hire"]),
  strengths: z.string().trim().max(5000).optional(),
  concerns: z.string().trim().max(5000).optional(),
  notes: z.string().trim().max(5000).optional(),
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

  const { id } = await params;

  // Owner and HR act as the hiring manager for visibility purposes: somebody
  // has to be able to read the panel in order to decide.
  const isHiringManager = ["owner", "hr"].includes(ctx.role);

  try {
    const result = await new NeonAtsRepository(ctx).panelFor(id, ctx.userId, isHiringManager);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Panel lookup failed:", error);
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

  const limit = checkRateLimit(`ats-scorecard:${ctx.userId}`, 60, 60_000);
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
    // The interviewer is always the caller. Taking it from the body would let
    // one person fill in the panel.
    const result = await new NeonAtsRepository(ctx).submitScorecard({
      applicationId: id,
      interviewerId: ctx.userId,
      ...parsed.data,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Scorecard submission failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
