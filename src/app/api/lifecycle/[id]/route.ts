// ═══════════════════════════════════════════════════════════════
// GET/POST /api/lifecycle/[id]
// ═══════════════════════════════════════════════════════════════
// One checklist, and the decision to close it.
//
// `complete` is the interesting one. The repository re-checks the mandatory
// tasks against the rows under a lock rather than trusting what the client
// last saw, so an exit cannot be recorded as clean while "Access revoked" is
// still outstanding. The refusal names what is missing — "you cannot finish
// this" is not useful without "because these three things are not done".

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonLifecycleRepository } from "@/db/repositories/lifecycle.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { roleHasPermission } from "@/lib/rbac";
import { currentEmployeeId } from "@/lib/current-employee";

const decisionSchema = z
  .object({
    action: z.enum(["complete", "cancel"]),
    reason: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.action !== "cancel" || (v.reason && v.reason.length >= 3), {
    message: "A reason is required when cancelling",
    path: ["reason"],
  });

function fail(error: unknown) {
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: "Checklist not found" }, { status: 404 });
  }
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Lifecycle journey failure:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

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
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid checklist id" }, { status: 400 });
  }

  try {
    const journey = await new NeonLifecycleRepository(ctx).getById(id);
    if (!journey) {
      return NextResponse.json({ error: "Checklist not found" }, { status: 404 });
    }

    // Someone can read their own; everything else needs HR. Reported as not
    // found rather than forbidden, so the response does not confirm that a
    // named colleague is being offboarded. ctx.userId is the login, not the
    // employment record a checklist is keyed by — an unresolved caller is
    // never "their own".
    const self = await currentEmployeeId(ctx);
    const isOwn = self !== null && journey.employeeId === self;
    if (!isOwn && !roleHasPermission(ctx.role, "employees.edit")) {
      return NextResponse.json({ error: "Checklist not found" }, { status: 404 });
    }

    return NextResponse.json({ data: journey });
  } catch (error) {
    return fail(error);
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

  if (!roleHasPermission(ctx.role, "employees.edit")) {
    return NextResponse.json({ error: "You cannot close a checklist" }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid checklist id" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const repo = new NeonLifecycleRepository(ctx);
    const journey =
      parsed.data.action === "complete"
        ? await repo.complete(id)
        : await repo.cancel(id, parsed.data.reason!);

    return NextResponse.json({ data: journey });
  } catch (error) {
    return fail(error);
  }
}
