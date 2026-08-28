// ═══════════════════════════════════════════════════════════════
// GET /api/expenses/[id]
// ═══════════════════════════════════════════════════════════════
// One claim. Separate from the list because `collection-service.getDocument`
// fetches by id, and because a claim detail view should not have to page
// through everything to find itself.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonExpenseRepository } from "@/db/repositories/expense.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { roleHasPermission } from "@/lib/rbac";
import { currentEmployeeId } from "@/lib/current-employee";

export async function GET(
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

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid expense claim id" }, { status: 400 });
  }

  try {
    const claim = await new NeonExpenseRepository(ctx).getById(id);
    if (!claim) {
      return NextResponse.json({ error: "Expense claim not found" }, { status: 404 });
    }

    // A claim carries what someone spent and where they were. Anyone without
    // `expenses.view_all` sees only their own — reported as not found rather
    // than forbidden, so the response does not confirm the claim exists.
    // ctx.userId is the signing-in account, not the employment record a claim
    // is keyed by — see lib/current-employee.ts. An unresolved caller is
    // never "their own".
    const self = await currentEmployeeId(ctx);
    const isOwn = self !== null && claim.employeeId === self;
    if (!isOwn && !roleHasPermission(ctx.role, "expenses.view_all")) {
      return NextResponse.json({ error: "Expense claim not found" }, { status: 404 });
    }

    return NextResponse.json(claim);
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Expense lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
