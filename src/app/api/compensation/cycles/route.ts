// POST /api/compensation/cycles — open a merit cycle.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonCompensationRepository } from "@/db/repositories/compensation.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const tier = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const bodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  periodStart: z.string().regex(DATE),
  periodEnd: z.string().regex(DATE),
  effectiveOn: z.string().regex(DATE),
  minimumTenureMonths: z.number().int().min(0).max(60).optional(),
  prorateNewJoiners: z.boolean().optional(),
  meritMatrix: z
    .object({
      outstanding: tier,
      exceeds: tier,
      meets: tier,
      partially_meets: tier,
      below: tier,
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot open a compensation cycle" }, { status: 403 });
  }

  const limit = checkRateLimit(`comp-cycle:${ctx.userId}`, 20, 60_000);
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
    const cycle = await new NeonCompensationRepository(ctx).createCycle({
      ...parsed.data,
      createdById: ctx.userId,
    });
    return NextResponse.json(cycle, { status: 201 });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Cycle creation failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET — compensation cycles, newest first. A cycle could be created,
// budgeted, recommended into and approved, but never listed, so there was no
// way to find last year's or see which one is open.
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    const cycles = await new NeonCompensationRepository(ctx).listCycles({ status });
    return NextResponse.json({ cycles });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Compensation cycle list failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
