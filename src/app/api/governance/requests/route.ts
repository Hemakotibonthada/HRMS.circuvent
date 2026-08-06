// GET/POST /api/governance/requests — data subject requests.
//
// A POST returns the erasure plan alongside the request id. The plan is for
// review; nothing is destroyed until it is approved and executed separately.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonGovernanceRepository } from "@/db/repositories/governance.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  requestType: z.enum([
    "access",
    "erasure",
    "rectification",
    "portability",
    "restriction",
    "objection",
  ]),
  subjectEmail: z.string().email(),
  subjectName: z.string().trim().max(120).optional(),
  subjectEmployeeId: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot view these requests" }, { status: 403 });
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const outstanding = await new NeonGovernanceRepository(ctx).overdueRequests(today);
    return NextResponse.json({
      outstanding,
      // Surfaced separately because a missed statutory deadline is a breach in
      // itself, regardless of what the request asked about.
      overdue: outstanding.filter((r) => r.daysLeft < 0).length,
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Request lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot log these requests" }, { status: 403 });
  }

  const limit = checkRateLimit(`dsr:${ctx.userId}`, 30, 60_000);
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
    const repo = new NeonGovernanceRepository(ctx);
    const result = await repo.recordRequest({ ...parsed.data, handledById: ctx.userId });

    const plan = parsed.data.subjectEmployeeId
      ? await repo.planErasureFor(parsed.data.subjectEmployeeId)
      : null;

    return NextResponse.json({ ...result, plan }, { status: 201 });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Request logging failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
