import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonLifecycleRepository } from "@/db/repositories/lifecycle.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { roleHasPermission } from "@/lib/rbac";

const schema = z.object({
  employeeId: z.string().uuid(),
  kind: z.enum(["onboarding", "offboarding"]).optional().default("onboarding"),
  taskKey: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  phase: z.string().min(1).max(50),
  phaseOrder: z.number().int().optional(),
  mandatory: z.boolean().optional(),
  completed: z.boolean(),
  notes: z.string().trim().max(2000).optional(),
});

export async function POST(request: NextRequest) {
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
    const repo = new NeonLifecycleRepository(ctx);
    const journey = await repo.toggleTaskByKey({
      employeeId: parsed.data.employeeId,
      kind: parsed.data.kind,
      taskKey: parsed.data.taskKey,
      title: parsed.data.title,
      phase: parsed.data.phase,
      phaseOrder: parsed.data.phaseOrder,
      mandatory: parsed.data.mandatory,
      completed: parsed.data.completed,
      actorId: ctx.userId,
      notes: parsed.data.notes,
    });

    return NextResponse.json({ data: journey });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Lifecycle toggle failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
