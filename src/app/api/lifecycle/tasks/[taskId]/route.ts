// ═══════════════════════════════════════════════════════════════
// PATCH /api/lifecycle/tasks/[taskId]
// ═══════════════════════════════════════════════════════════════
// Tick or untick one checklist item.
//
// This is the request the old page never made. `toggleClearance` set React
// state and raised a "Clearance updated" toast; nothing left the browser.
//
// Returns the whole journey rather than the single task, because ticking an
// item changes the progress figure and the blocking list, and a client that
// has to re-fetch to learn that will show a stale percentage in between.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonLifecycleRepository } from "@/db/repositories/lifecycle.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { roleHasPermission } from "@/lib/rbac";

const schema = z.object({
  completed: z.boolean(),
  notes: z.string().trim().max(2000).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!roleHasPermission(ctx.role, "employees.edit")) {
    return NextResponse.json(
      { error: "You cannot change a checklist" },
      { status: 403 }
    );
  }

  const { taskId } = await params;
  if (!z.string().uuid().safeParse(taskId).success) {
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
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
    const journey = await new NeonLifecycleRepository(ctx).setTaskCompletion(
      taskId,
      parsed.data.completed,
      ctx.userId,
      parsed.data.notes
    );
    return NextResponse.json({ data: journey });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Lifecycle task update failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
