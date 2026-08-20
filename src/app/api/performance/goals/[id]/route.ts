// PATCH /api/performance/goals/[id] — an employee moving their own goal along.
//
// Separate from the PATCH on the collection route, which only relinks a goal to
// a different parent. That is an HR action about the shape of the tree; this is
// the ordinary weekly act of saying how far you have got, and the two should
// not share a permission check.
//
// Progress is only ever written to leaf goals. A parent's progress is computed
// from its children on read and never stored, because a manager typing 80%
// while their team sits at 30% is the most common way an OKR system stops
// meaning anything, and it stays invisible until the quarter ends.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { performanceGoals } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";

const patchSchema = z
  .object({
    progressPercent: z.number().int().min(0).max(100).optional(),
    currentValue: z.string().trim().max(20).optional(),
    status: z.enum(["not_started", "in_progress", "at_risk", "completed", "dropped"]).optional(),
  })
  .refine(
    (b) => b.progressPercent !== undefined || b.currentValue !== undefined || b.status !== undefined,
    { message: "Nothing to update" }
  );

export async function PATCH(
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
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const limit = checkRateLimit(`goal-progress:${ctx.userId}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await request.json());
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message : "Invalid request";
    return NextResponse.json({ error: message ?? "Invalid request" }, { status: 400 });
  }

  const isManagerish = ["owner", "admin", "hr", "manager"].includes(ctx.role);

  try {
    const result = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const existing = await tx
        .select({
          id: performanceGoals.id,
          employeeId: performanceGoals.employeeId,
          status: performanceGoals.status,
        })
        .from(performanceGoals)
        .where(and(eq(performanceGoals.id, id), eq(performanceGoals.orgId, ctx.orgId)))
        .limit(1);

      const goal = existing[0];
      if (!goal) return { kind: "notFound" as const };
      // ctx.userId is the signing-in account, not the employment record a
      // goal is keyed by — see lib/current-employee.ts. Resolved inside the
      // same transaction; an unresolvable caller is never treated as owning
      // the goal.
      const self = await currentEmployeeId(ctx, tx);
      const isOwn = self !== null && goal.employeeId === self;
      if (!isOwn && !isManagerish) {
        return { kind: "forbidden" as const };
      }

      // A goal with children owns no progress of its own. Writing one would be
      // stored and then ignored on read, which is worse than refusing — the
      // person would believe they had recorded something.
      const children = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(performanceGoals)
        .where(and(eq(performanceGoals.parentGoalId, id), eq(performanceGoals.orgId, ctx.orgId)));

      if ((children[0]?.n ?? 0) > 0 && body.progressPercent !== undefined) {
        return { kind: "hasChildren" as const };
      }

      // Left alone unless the number implies a move. Dragging to 100 means
      // "done"; nudging 0 to 5 means it has started.
      const status =
        body.status ??
        (body.progressPercent === undefined
          ? undefined
          : body.progressPercent >= 100
            ? "completed"
            : body.progressPercent > 0 && goal.status === "not_started"
              ? "in_progress"
              : undefined);

      const rows = await tx
        .update(performanceGoals)
        .set({
          ...(body.progressPercent !== undefined && { progressPercent: body.progressPercent }),
          ...(body.currentValue !== undefined && { currentValue: body.currentValue }),
          ...(status !== undefined && { status }),
          ...(status === "completed" && { completedAt: new Date() }),
          updatedAt: new Date(),
        })
        .where(and(eq(performanceGoals.id, id), eq(performanceGoals.orgId, ctx.orgId)))
        .returning({
          id: performanceGoals.id,
          progressPercent: performanceGoals.progressPercent,
          status: performanceGoals.status,
          currentValue: performanceGoals.currentValue,
        });

      return { kind: "ok" as const, goal: rows[0] };
    });

    switch (result.kind) {
      case "notFound":
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      case "forbidden":
        return NextResponse.json({ error: "That is not your goal" }, { status: 403 });
      case "hasChildren":
        return NextResponse.json(
          {
            error:
              "This goal's progress is worked out from the goals underneath it. " +
              "Update those instead.",
          },
          { status: 409 }
        );
      default:
        return NextResponse.json(result.goal);
    }
  } catch (error) {
    console.error("Goal progress update failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
