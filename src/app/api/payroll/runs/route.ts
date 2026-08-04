// ═══════════════════════════════════════════════════════════════
// HRMS API — payroll runs
// ═══════════════════════════════════════════════════════════════
// Payroll is restricted to HR and above throughout. There is no view here for
// employees: they read their own payslips from /api/payroll/payslips, which
// exposes only released runs.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonPayrollRepository } from "@/db/repositories/payroll.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const createSchema = z.object({
  periodMonth: z.number().int().min(1).max(12),
  periodYear: z.number().int().min(2000).max(2100),
  runType: z.enum(["regular", "off_cycle", "bonus", "arrears"]).optional(),
});

function fail(error: unknown) {
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Payroll API failure:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(request.url);
  try {
    const page = await new NeonPayrollRepository(ctx).listRuns({
      page: Number(searchParams.get("page")) || undefined,
      pageSize: Number(searchParams.get("pageSize")) || undefined,
      filters: { status: searchParams.get("status") ?? undefined },
    });
    return NextResponse.json(page);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`payroll-run:${ctx.orgId}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const run = await new NeonPayrollRepository(ctx).createRun(
      parsed.data.periodMonth,
      parsed.data.periodYear,
      parsed.data.runType
    );
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
