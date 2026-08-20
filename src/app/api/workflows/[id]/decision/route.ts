// POST /api/workflows/[id]/decision — approve or reject a workflow step.
//
// Authorisation is the repository's job, not this route's: it locks the
// instance, resolves who may act on the current step, and rejects anyone else.
// Duplicating that check here would create two places to keep in sync, and the
// repository's version is the one that holds the lock.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonWorkflowRepository } from "@/db/repositories/workflow.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { NoEmployeeRecordError, requireCurrentEmployeeId } from "@/lib/current-employee";

const schema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    comment: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.decision !== "rejected" || (v.comment && v.comment.length >= 3), {
    message: "A comment is required when rejecting",
    path: ["comment"],
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

  const limit = checkRateLimit(`workflow:${ctx.userId}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid workflow id" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    // The approver list is employee ids, so the actor must be one too — the
    // permission check inside `decide` compares them directly.
    const employeeId = await requireCurrentEmployeeId(ctx);
    const result = await new NeonWorkflowRepository(ctx).decide(
      id,
      employeeId,
      parsed.data.decision,
      parsed.data.comment
    );

    return NextResponse.json({
      status: result.state.status,
      completed: result.completed,
      currentStepIndex: result.state.currentStepIndex,
      // Returned so the client can show who it is now waiting on, rather than
      // saying "submitted" and leaving the requester to guess.
      nextApprovers: result.approvers,
      history: result.state.history,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }
    if (error instanceof NoEmployeeRecordError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Workflow decision failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
