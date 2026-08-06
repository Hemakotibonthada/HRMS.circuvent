// GET/POST /api/governance/policies — retention schedules.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonGovernanceRepository } from "@/db/repositories/governance.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  entityType: z.string().trim().min(1).max(60),
  // Zero means "do not retain after the anchor", which is a real choice for
  // transient data. A century is the upper bound on anything defensible.
  retainForMonths: z.number().int().min(0).max(1200),
  anchor: z.enum(["created_at", "exit_date", "closed_at", "period_end"]),
  method: z.enum(["delete", "anonymise", "pseudonymise", "retain"]),
  basis: z.string().trim().min(3, "State the statute or policy this comes from").max(300),
  overridesErasure: z.boolean().optional(),
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
    return NextResponse.json({ error: "You cannot view retention policies" }, { status: 403 });
  }

  try {
    const policies = await new NeonGovernanceRepository(ctx).listPolicies();
    return NextResponse.json({ policies });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Retention policy lookup failed:", error);
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

  // A retention policy decides when data is destroyed. Only an owner or admin
  // should be able to shorten one.
  if (!["owner", "admin"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot set retention policies" }, { status: 403 });
  }

  const limit = checkRateLimit(`retention:${ctx.userId}`, 20, 60_000);
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
    const policy = await new NeonGovernanceRepository(ctx).savePolicy({
      ...parsed.data,
      createdById: ctx.userId,
    });
    return NextResponse.json(policy);
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Retention policy save failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
