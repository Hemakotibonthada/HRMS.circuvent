// ═══════════════════════════════════════════════════════════════
// POST /api/leave/[id]/decision
// ═══════════════════════════════════════════════════════════════
// Approve, reject or cancel. One route rather than three, because the guard
// logic is shared and splitting it invites the three copies drifting apart.
//
// The control that matters: nobody approves their own leave. It is checked
// here and the repository refuses a non-pending transition, so a double-click
// cannot deduct the balance twice.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonLeaveRepository } from "@/db/repositories/leave.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

const schema = z
  .object({
    action: z.enum(["approve", "reject", "cancel"]),
    reason: z.string().trim().max(1000).optional(),
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
    return NextResponse.json({ error: "Invalid leave request id" }, { status: 400 });
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
    const repo = new NeonLeaveRepository(ctx);
    const existing = await repo.getById(id);
    if (!existing) {
      return NextResponse.json({ error: "Leave request not found" }, { status: 404 });
    }

    if (parsed.data.action === "cancel") {
      // Employees withdraw their own; HR can cancel on anyone's behalf.
      const mayCancel =
        existing.employeeId === ctx.userId || ["owner", "admin", "hr"].includes(ctx.role);
      if (!mayCancel) {
        return NextResponse.json(
          { error: "You can only cancel your own leave" },
          { status: 403 }
        );
      }
      return NextResponse.json(await repo.cancel(id, parsed.data.reason ?? "Withdrawn"));
    }

    if (!["owner", "admin", "hr", "manager"].includes(ctx.role)) {
      return NextResponse.json({ error: "You cannot approve leave" }, { status: 403 });
    }

    // Self-approval defeats the control entirely, regardless of role.
    if (existing.employeeId === ctx.userId) {
      return NextResponse.json(
        { error: "You cannot approve your own leave request" },
        { status: 403 }
      );
    }

    const updated =
      parsed.data.action === "approve"
        ? await repo.approve(id, ctx.userId)
        : await repo.reject(id, ctx.userId, parsed.data.reason!);

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Leave request not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Leave decision failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
