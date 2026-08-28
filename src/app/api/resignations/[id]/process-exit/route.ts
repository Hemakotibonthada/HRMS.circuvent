// ═══════════════════════════════════════════════════════════════
// POST /api/resignations/[id]/process-exit
// ═══════════════════════════════════════════════════════════════
// The manual half of `runExitProcessing`'s two callers (see
// `offboarding-exit.ts`'s file header): HR confirming an exit ahead of the
// agreed last working day, or re-running processing by hand after fixing
// whatever made an earlier attempt report a caveat (a broken letter
// template, a directory outage). The cron's `processDueExits` is the other
// caller, for the ordinary case where nobody needs to press anything.
//
// HR-only, same gate as adjusting the last working day and for the same
// reason: this is the action that freezes the settlement and starts
// removing access, not something a line manager triggers.
//
// The response is the full `ExitProcessingReport`, caveats included, on
// purpose — this route must never let a caller see only a 200 and assume
// everything is clean. "Report anything that could not be revoked rather
// than reporting success" is the task's own rule for this exact path, and
// the report already carries every reason it might not be: outstanding
// directory groups, withheld documents, failed documents, and the standing
// session-sign-out caveat that is never conditional on this run succeeding.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { runExitProcessing } from "@/lib/offboarding-exit";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";

const paramsSchema = z.object({ id: z.string().uuid("Invalid resignation id") });

function fail(error: unknown) {
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: "Resignation not found" }, { status: 404 });
  }
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Exit processing failed:", error);
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

  // Deliberately tighter than the read-only routes: this one prices money
  // and calls out to the directory SDK and the document pipeline, so it
  // should not be clickable fast enough to fire either twice a second on a
  // slow network retry.
  const limit = checkRateLimit(`resignation-process-exit:${clientIdentifier(request, ctx.userId)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const report = await runExitProcessing(ctx, idResult.data.id);
    return NextResponse.json(report);
  } catch (error) {
    return fail(error);
  }
}
