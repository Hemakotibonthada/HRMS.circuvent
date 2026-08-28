// POST/DELETE /api/governance/holds — suspend retention for a matter.
//
// A hold beats both the retention schedule and an erasure request. Destroying
// evidence during litigation is a far worse outcome than keeping a record
// longer than a schedule says.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonGovernanceRepository } from "@/db/repositories/governance.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const placeSchema = z.object({
  reference: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(5).max(500),
  entityType: z.string().trim().min(1).max(60),
  /** Omit to hold every record of the type — a blanket hold on a matter. */
  entityId: z.string().uuid().optional(),
  reviewOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A review date is required"),
});

const releaseSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(5, "Say why the hold is being lifted").max(500),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!["owner", "admin"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot place legal holds" }, { status: 403 });
  }

  const limit = checkRateLimit(`holds:${ctx.userId}`, 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = placeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const hold = await new NeonGovernanceRepository(ctx).placeHold({
      ...parsed.data,
      placedById: ctx.userId,
    });
    return NextResponse.json(hold, { status: 201 });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Legal hold failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!["owner", "admin"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot lift legal holds" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = releaseSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    await new NeonGovernanceRepository(ctx).releaseHold(
      parsed.data.id,
      parsed.data.reason,
      ctx.userId
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Hold not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Legal hold release failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET — legal holds. A hold exists so somebody checks, before an erasure or a
// retention sweep, whether a record is subject to one. Nothing could list
// them, so nobody could check.
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    const active = new URL(request.url).searchParams.get("active");
    const holds = await new NeonGovernanceRepository(ctx).listHolds({
      active: active === null ? undefined : active !== "false",
    });
    return NextResponse.json({ holds });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Legal hold list failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
