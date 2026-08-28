// ═══════════════════════════════════════════════════════════════
// HRMS API — convert intern to permanent
// ═══════════════════════════════════════════════════════════════
// One action, so no `action` discriminator like `expenses/[id]/decision` —
// there is only one thing this route does, and a body only that route would
// ever add complexity nothing here needs yet.
//
// Everything that makes this safe to click twice lives in
// `NeonEmployeeRepository.convertToPermanent`: the row lock plus the
// `employmentType !== "intern"` check inside it is the entire idempotency
// guarantee, so this handler does not attempt its own "already converted"
// check before calling through — doing so here, outside that lock, would
// just recreate the race it already closes.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";

const paramsSchema = z.object({ id: z.string().uuid("Invalid employee id") });

function fail(error: unknown) {
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: "Intern not found" }, { status: 404 });
  }
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Intern conversion failed:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  let ctx;
  try {
    // Matches `interns.manage` in rbac.ts — the same admin/HR pairing as
    // `onboarding.manage`/`offboarding.manage`, since converting someone is as
    // much an HR action as onboarding them was.
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`intern-convert:${clientIdentifier(request, ctx.userId)}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const idResult = paramsSchema.safeParse(await params);
  if (!idResult.success) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  try {
    const converted = await new NeonEmployeeRepository(ctx).convertToPermanent(idResult.data.id);
    return NextResponse.json(converted);
  } catch (error) {
    return fail(error);
  }
}
