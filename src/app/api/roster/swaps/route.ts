// POST /api/roster/swaps — offer one of your own shifts to a colleague.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonRosteringRepository } from "@/db/repositories/rostering.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { currentEmployeeId, NoEmployeeRecordError, requireCurrentEmployeeId } from "@/lib/current-employee";

const bodySchema = z.object({
  assignmentId: z.string().uuid(),
  targetEmployeeId: z.string().uuid().optional(),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`roster-swap:${ctx.userId}`, 20, 60_000);
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

  try {
    // The requester is always the caller — never the body, which would let
    // someone give away a colleague's shift — resolved to their employee id
    // since ctx.userId is the account, not the employment record. See
    // lib/current-employee.ts.
    const requestedById = await requireCurrentEmployeeId(ctx);
    const swap = await new NeonRosteringRepository(ctx).requestSwap({
      assignmentId: parsed.data.assignmentId,
      requestedById,
      targetEmployeeId: parsed.data.targetEmployeeId,
      reason: parsed.data.reason,
    });
    return NextResponse.json(swap, { status: 201 });
  } catch (error) {
    if (error instanceof NoEmployeeRecordError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Swap request failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET — swap requests. An approver had no queue to work from, and the person
// who asked could not see whether anyone had picked it up.
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const params = new URL(request.url).searchParams;
  const requested = params.get("employeeId") ?? undefined;

  // An ordinary employee sees only swaps they are part of, whatever they ask
  // for. Who is short-staffed, and who is trying to get out of a shift, is
  // not everybody's business.
  const privileged = ["owner", "admin", "hr", "manager"].includes(ctx.role);

  try {
    // ctx.userId is the signing-in account, not the employment record a swap
    // is keyed by — see lib/current-employee.ts.
    const self = privileged ? null : await currentEmployeeId(ctx);
    const employeeId = privileged ? requested : (self ?? undefined);

    if (!privileged && !self) {
      return NextResponse.json({ swaps: [] });
    }

    const swaps = await new NeonRosteringRepository(ctx).listSwaps({
      status: params.get("status") ?? undefined,
      employeeId,
    });
    return NextResponse.json({ swaps });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Swap list failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
