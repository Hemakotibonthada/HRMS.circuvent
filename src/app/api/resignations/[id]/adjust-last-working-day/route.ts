// ═══════════════════════════════════════════════════════════════
// POST /api/resignations/[id]/adjust-last-working-day
// ═══════════════════════════════════════════════════════════════
// HR-only, deliberately narrower than `resignation.approve`: a manager can
// accept a direct report's resignation, but moving the agreed last working
// day earlier or later than notice policy alone would produce is an HR
// decision, not a line-management one — the same reasoning
// `interns/[id]/convert/route.ts` gives for gating on `["owner","admin","hr"]`
// rather than a broader permission.
//
// `NeonResignationRepository.adjustLastWorkingDay` is what actually refuses
// this once a settlement snapshot exists — see its own comment and
// `canAdjustLastWorkingDay` in offboarding-resignation.ts for why the
// snapshot, not the exit itself, is the cutoff. This route does not
// duplicate that check; a second one here would just be another place for
// the two to drift apart.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonResignationRepository } from "@/db/repositories/resignation.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { notifyEmployee } from "@/lib/notifications/notify";
import { validationFailed } from "@/lib/validation-response";

const paramsSchema = z.object({ id: z.string().uuid("Invalid resignation id") });
const bodySchema = z.object({
  lastWorkingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Last working day must be YYYY-MM-DD"),
});

function fail(error: unknown) {
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: "Resignation not found" }, { status: 404 });
  }
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Last working day adjustment failed:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const idResult = paramsSchema.safeParse(await params);
  if (!idResult.success) {
    return NextResponse.json({ error: "Invalid resignation id" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return validationFailed(parsed.error);
  }

  try {
    const repo = new NeonResignationRepository(ctx);
    const updated = await repo.adjustLastWorkingDay(idResult.data.id, parsed.data.lastWorkingDay, ctx.userId);

    // The employee is not left to discover a moved date from the settlement
    // they were expecting on a different day.
    void notifyEmployee(ctx, {
      employeeId: updated.employeeId,
      type: "resignation.lwd_adjusted",
      data: {
        adjustedByName: ctx.email ?? "HR",
        newLastWorkingDay: parsed.data.lastWorkingDay,
      },
      actionUrl: "/resignation",
      // Keyed on the new date, not just the resignation id: a second,
      // genuinely different adjustment to the same resignation must still
      // reach the employee, and only a retry of the exact same change
      // should be treated as the same notification.
      idempotencyKey: `resignation-lwd-adjusted:${idResult.data.id}:${parsed.data.lastWorkingDay}`,
    }).catch((error) => {
      console.error(`[resignations] Could not notify employee of LWD change for ${idResult.data.id}:`, error);
    });

    return NextResponse.json(updated);
  } catch (error) {
    return fail(error);
  }
}
