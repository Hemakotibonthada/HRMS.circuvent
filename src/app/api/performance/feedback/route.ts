// GET/POST /api/performance/feedback — 360° requests.
//
// GET returns what the caller still owes. POST asks a set of people for
// feedback on a subject.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonPerformanceRepository } from "@/db/repositories/performance.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";

const bodySchema = z.object({
  cycleId: z.string().uuid(),
  subjectId: z.string().uuid(),
  respondentIds: z.array(z.string().uuid()).min(1).max(50),
  relationship: z.enum(["peer", "direct_report", "manager", "self", "external"]),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  isNominatedBySubject: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    // Always the caller's own list. Whose feedback someone owes reveals who is
    // being reviewed by whom, which is part of what anonymity protects.
    //
    // `feedback_requests.respondent_id` is an employee, not an account.
    const employeeId = await currentEmployeeId(ctx);
    if (!employeeId) return NextResponse.json({ pending: [] });

    const pending = await new NeonPerformanceRepository(ctx).pendingFeedbackFor(employeeId);
    return NextResponse.json({ pending });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Feedback lookup failed:", error);
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

  const limit = checkRateLimit(`feedback-request:${ctx.userId}`, 30, 60_000);
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

  const privileged = ["owner", "admin", "hr", "manager"].includes(ctx.role);
  const isOwnNomination = parsed.data.subjectId === ctx.userId;

  // Someone may nominate their own reviewers; asking for feedback on a
  // colleague is a management action.
  if (!isOwnNomination && !privileged) {
    return NextResponse.json(
      { error: "You cannot request feedback about someone else" },
      { status: 403 }
    );
  }

  try {
    const result = await new NeonPerformanceRepository(ctx).requestFeedback({
      ...parsed.data,
      isNominatedBySubject: isOwnNomination,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Feedback request failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
