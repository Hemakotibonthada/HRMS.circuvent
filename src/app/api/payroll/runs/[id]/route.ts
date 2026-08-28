// ═══════════════════════════════════════════════════════════════
// POST /api/payroll/runs/[id] — advance a run through its lifecycle
// ═══════════════════════════════════════════════════════════════
//   draft → process → processed → approve → approved → pay → paid
//
// Approval is the control that matters: the approver must not be the person
// who processed the run. That is checked in the repository and enforced by a
// CHECK constraint in drizzle/0001, so no code path can skip it.
//
// Marking a run paid is admin-only. Processing calculates, approving
// authorises, but paying is the point of no return — the bank file goes out.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonPayrollRepository } from "@/db/repositories/payroll.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

const schema = z.object({
  action: z.enum(["process", "approve", "pay"]),
  transactionRef: z.string().trim().max(120).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  try {
    const repo = new NeonPayrollRepository(ctx);
    const run = await repo.getRun(id);
    if (!run) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });

    const records = await repo.listRecords(id, { pageSize: 500 });
    return NextResponse.json({ run, records });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Payroll run lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "action must be process, approve or pay" }, { status: 400 });
  }

  try {
    const repo = new NeonPayrollRepository(ctx);

    switch (parsed.data.action) {
      case "process":
        return NextResponse.json(await repo.processRun(id, ctx.userId));

      case "approve":
        return NextResponse.json(await repo.approveRun(id, ctx.userId));

      case "pay":
        if (!["owner", "admin"].includes(ctx.role)) {
          return NextResponse.json(
            { error: "Only an administrator can release payment" },
            { status: 403 }
          );
        }
        return NextResponse.json(await repo.markPaid(id, parsed.data.transactionRef));
    }
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Payroll action failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
