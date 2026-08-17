// ═══════════════════════════════════════════════════════════════
// POST /api/expenses/[id]/decision
// ═══════════════════════════════════════════════════════════════
// Approve, reject, cancel or reimburse. One route rather than four, because
// the guards are shared and splitting them invites four copies drifting apart
// — the same reasoning as the leave decision route.
//
// The controls that matter:
//
//   * **Nobody approves their own claim.** Checked here, regardless of role.
//     A finance manager submitting a claim is still a claimant.
//   * **A claim moves forward once.** The repository locks the row and refuses
//     an illegal transition, so a double-clicked Approve cannot reach
//     reimbursement twice — which would be paying somebody twice.
//   * **Reimbursement is separate from approval.** Approving says the spend
//     was legitimate; reimbursing says the money has gone out. Collapsing them
//     means no record of which claims are still owed.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonExpenseRepository } from "@/db/repositories/expense.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { roleHasPermission } from "@/lib/rbac";

const schema = z
  .object({
    action: z.enum(["approve", "reject", "cancel", "reimburse"]),
    reason: z.string().trim().max(1000).optional(),
    /** Exact paise. Omit to approve the full amount. */
    approvedAmountMinor: z.string().regex(/^\d+$/).optional(),
  })
  .refine((v) => v.action !== "reject" || (v.reason && v.reason.length >= 3), {
    message: "A reason is required when rejecting",
    path: ["reason"],
  });

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

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid expense claim id" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const repo = new NeonExpenseRepository(ctx);
    const existing = await repo.getById(id);
    if (!existing) {
      return NextResponse.json({ error: "Expense claim not found" }, { status: 404 });
    }

    const { action, reason, approvedAmountMinor } = parsed.data;

    if (action === "cancel") {
      // Claimants withdraw their own; HR can cancel on anyone's behalf.
      const mayCancel =
        existing.employeeId === ctx.userId || roleHasPermission(ctx.role, "expenses.view_all");
      if (!mayCancel) {
        return NextResponse.json(
          { error: "You can only cancel your own expense claim" },
          { status: 403 }
        );
      }
      return NextResponse.json(await repo.cancel(id, reason ?? "Withdrawn"));
    }

    if (!roleHasPermission(ctx.role, "expenses.approve")) {
      return NextResponse.json({ error: "You cannot approve expenses" }, { status: 403 });
    }

    // Self-approval defeats the control entirely, regardless of role.
    if (existing.employeeId === ctx.userId) {
      return NextResponse.json(
        { error: "You cannot approve your own expense claim" },
        { status: 403 }
      );
    }

    if (action === "approve") {
      return NextResponse.json(await repo.approve(id, ctx.userId, approvedAmountMinor));
    }

    if (action === "reject") {
      return NextResponse.json(await repo.reject(id, ctx.userId, reason!));
    }

    // Paying out is a finance action, not a line-manager one: a manager may
    // agree the spend was legitimate without being able to move money.
    if (!roleHasPermission(ctx.role, "payroll.process")) {
      return NextResponse.json(
        { error: "You cannot record a reimbursement" },
        { status: 403 }
      );
    }

    return NextResponse.json(await repo.reimburse(id));
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Expense claim not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Expense decision failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
