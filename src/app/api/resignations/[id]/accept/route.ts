// ═══════════════════════════════════════════════════════════════
// POST /api/resignations/[id]/accept
// ═══════════════════════════════════════════════════════════════
// A direct manager or HR accepts a resignation, which is the moment
// `NeonResignationRepository.accept` computes the agreed last working day
// from notice policy and starts the offboarding checklist. There is no
// reject: a resignation is not a request for permission the company can
// decline, only one HR may adjust the timing of (see
// `adjust-last-working-day/route.ts`) or, later, act on.
//
// The self-approval guard matters here exactly as much as it does in
// `leave/[id]/decision/route.ts`: someone with `resignation.approve` who is
// also the person resigning must not be able to accept their own notice and
// set their own last working day.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonResignationRepository } from "@/db/repositories/resignation.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { roleHasPermission } from "@/lib/rbac";
import { currentEmployeeId } from "@/lib/current-employee";
import { notifyEmployee } from "@/lib/notifications/notify";

const paramsSchema = z.object({ id: z.string().uuid("Invalid resignation id") });

function fail(error: unknown) {
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: "Resignation not found" }, { status: 404 });
  }
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Resignation acceptance failed:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!roleHasPermission(ctx.role, "resignation.approve")) {
    return NextResponse.json({ error: "You cannot accept a resignation" }, { status: 403 });
  }

  const idResult = paramsSchema.safeParse(await params);
  if (!idResult.success) {
    return NextResponse.json({ error: "Invalid resignation id" }, { status: 400 });
  }
  const { id } = idResult.data;

  try {
    const repo = new NeonResignationRepository(ctx);
    const existing = await repo.getById(id);
    if (!existing) {
      return NextResponse.json({ error: "Resignation not found" }, { status: 404 });
    }

    // Defeats the control entirely otherwise, same as leave's own guard —
    // a manager who also happens to be the leaver cannot accept their own
    // notice and pick their own last working day. ctx.userId is the login,
    // not the employment record the resignation is keyed by, and an
    // unresolved caller must never be treated as "this is my own notice".
    const self = await currentEmployeeId(ctx);
    if (self !== null && existing.employeeId === self) {
      return NextResponse.json(
        { error: "You cannot accept your own resignation" },
        { status: 403 }
      );
    }

    const updated = await repo.accept(id, ctx.userId);

    // Told the outcome rather than left to notice their status changed to
    // "notice period" on a page they were not looking at. Best-effort and
    // never allowed to fail an acceptance that already committed —
    // `notifyEmployee` itself already treats a missing recipient as a
    // no-op, so there is nothing else to look up here first.
    notifyEmployee(ctx, {
      employeeId: existing.employeeId,
      type: "resignation.accepted",
      data: {
        approverName: ctx.email ?? "HR",
        agreedLastWorkingDay: updated.agreedLastWorkingDay ?? updated.intendedLastWorkingDay,
      },
      actionUrl: "/resignation",
      idempotencyKey: `resignation-accepted:${id}`,
    }).catch((error) => {
      console.error(`[resignations] Could not notify employee of acceptance for ${id}:`, error);
    });

    return NextResponse.json(updated);
  } catch (error) {
    return fail(error);
  }
}
