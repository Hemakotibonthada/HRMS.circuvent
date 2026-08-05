// POST /api/roster/swaps/[id] — accept an offered shift, or approve a swap.
//
// Two steps by design. A colleague accepting does not make the resulting
// roster legal, so the constraint check runs again at approval — by then the
// accepter's own schedule may have changed.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  NeonRosteringRepository,
  RosterConstraintError,
} from "@/db/repositories/rostering.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const acceptSchema = z.object({ action: z.literal("accept") });

const decideSchema = z.object({
  action: z.literal("decide"),
  approve: z.boolean(),
  rejectionReason: z.string().trim().max(500).optional(),
});

const bodySchema = z.discriminatedUnion("action", [acceptSchema, decideSchema]);

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

  const limit = checkRateLimit(`roster-swap-decide:${ctx.userId}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id } = await params;

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
    const repo = new NeonRosteringRepository(ctx);

    if (parsed.data.action === "accept") {
      const result = await repo.acceptSwap(id, ctx.userId);
      return NextResponse.json(result);
    }

    if (!["owner", "admin", "hr", "manager"].includes(ctx.role)) {
      return NextResponse.json({ error: "You cannot approve swaps" }, { status: 403 });
    }

    const result = await repo.approveSwap(
      id,
      ctx.userId,
      parsed.data.approve,
      parsed.data.rejectionReason
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RosterConstraintError) {
      return NextResponse.json(
        { error: error.message, violations: error.violations },
        { status: 422 }
      );
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Swap request not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Swap decision failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
