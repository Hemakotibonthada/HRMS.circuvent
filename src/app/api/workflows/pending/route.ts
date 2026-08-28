// GET /api/workflows/pending — the caller's approval inbox.
//
// Ordered with breached items first: an approver with thirty requests needs
// the ones already past their deadline at the top, not buried by date.

import { NextResponse, type NextRequest } from "next/server";
import { NeonWorkflowRepository } from "@/db/repositories/workflow.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";

export async function GET(request: NextRequest) {
  let ctx;
  try {
    // Anyone can be named an approver by a workflow definition, so this is not
    // restricted by role — the repository decides who is an approver for each
    // step and returns only that person's items.
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    // Approvers are employees — a workflow routes to a manager or a department
    // head, both of which are employment records rather than logins.
    const employeeId = await currentEmployeeId(ctx);
    if (!employeeId) {
      return NextResponse.json({ pending: [], counts: { total: 0, overdue: 0 } });
    }

    const pending = await new NeonWorkflowRepository(ctx).pendingFor(employeeId);
    return NextResponse.json({
      pending,
      counts: {
        total: pending.length,
        overdue: pending.filter((p) => p.isOverdue).length,
      },
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Approval inbox failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
