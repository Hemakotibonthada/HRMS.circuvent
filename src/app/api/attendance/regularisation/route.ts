// ═══════════════════════════════════════════════════════════════
// /api/attendance/regularisation — correcting a day, with a trail
// ═══════════════════════════════════════════════════════════════
//
// GET    the caller's own requests, or a manager's queue with ?queue=1.
// POST   raise one. The rules in `attendance-regularisation.ts` decide.
// PATCH  approve or reject.
//
// The correction is never applied to the attendance record here. It is recorded
// as a request, decided, and then acted on — because the attendance record is
// what payroll computed from, and an edit with no trail is indistinguishable
// from somebody quietly awarding themselves a day.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { attendanceRegularisations, employees, payrollRuns } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId, NoEmployeeRecordError, requireCurrentEmployeeId } from "@/lib/current-employee";
import {
  DEFAULT_POLICY,
  canDecide,
  evaluate,
  type RegularisationReason,
} from "@/lib/attendance-regularisation";

const APPROVERS = ["owner", "admin", "hr", "manager"];

const REASONS: RegularisationReason[] = [
  "missed_punch",
  "wrong_time",
  "on_duty",
  "work_from_home",
  "system_error",
  "shift_change",
];

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  reason: z.enum(REASONS as [RegularisationReason, ...RegularisationReason[]]),
  note: z.string().trim().max(1000).optional(),
  inTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  outTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  hasProof: z.boolean().optional(),
});

const decideSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["approved", "rejected", "cancelled"]),
  reason: z.string().trim().max(500).optional(),
});

/** Today in the organisation's own reckoning, as YYYY-MM-DD. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthOf(date: string): { month: number; year: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const queue = new URL(request.url).searchParams.get("queue") === "1";
  if (queue && !APPROVERS.includes(ctx.role)) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }

  try {
    const rows = await withTenant(ctx, async (tx) => {
      const base = tx
        .select({
          id: attendanceRegularisations.id,
          employeeId: attendanceRegularisations.employeeId,
          employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
          attendanceDate: attendanceRegularisations.attendanceDate,
          reason: attendanceRegularisations.reason,
          note: attendanceRegularisations.note,
          inTime: attendanceRegularisations.inTime,
          outTime: attendanceRegularisations.outTime,
          status: attendanceRegularisations.status,
          routing: attendanceRegularisations.routing,
          decisionReason: attendanceRegularisations.decisionReason,
          createdAt: attendanceRegularisations.createdAt,
        })
        .from(attendanceRegularisations)
        .innerJoin(employees, eq(employees.id, attendanceRegularisations.employeeId));

      if (queue) {
        return base
          .where(eq(attendanceRegularisations.status, "pending"))
          .orderBy(desc(attendanceRegularisations.createdAt))
          .limit(100);
      }

      // ctx.userId is the signing-in account, not the employment record a
      // regularisation request is keyed by — see lib/current-employee.ts.
      const employeeId = await currentEmployeeId(ctx, tx);
      if (!employeeId) return null;

      return base
        .where(eq(attendanceRegularisations.employeeId, employeeId))
        .orderBy(desc(attendanceRegularisations.attendanceDate))
        .limit(60);
    });

    return NextResponse.json({
      requests: rows ?? [],
      policy: DEFAULT_POLICY,
    });
  } catch (error) {
    console.error("Regularisation list failed:", error);
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

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request", detail: (error as z.ZodError).issues?.[0]?.message },
      { status: 400 }
    );
  }

  try {
    const decided = await withTenant(ctx, async (tx) => {
      // ctx.userId is the signing-in account, not the employment record a
      // regularisation request is keyed by — see lib/current-employee.ts.
      const employeeId = await requireCurrentEmployeeId(ctx, tx);
      const { month, year } = monthOf(body.date);

      // Everything the rules need, read once. Asking the rules to fetch would
      // put database access inside a pure module and make it untestable.
      const open = await tx
        .select({ id: attendanceRegularisations.id })
        .from(attendanceRegularisations)
        .where(
          and(
            eq(attendanceRegularisations.employeeId, employeeId),
            eq(attendanceRegularisations.attendanceDate, body.date),
            eq(attendanceRegularisations.status, "pending")
          )
        )
        .limit(1);

      const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const approvedThisMonth = await tx
        .select({ id: attendanceRegularisations.id })
        .from(attendanceRegularisations)
        .where(
          and(
            eq(attendanceRegularisations.employeeId, employeeId),
            eq(attendanceRegularisations.status, "approved"),
            gte(attendanceRegularisations.attendanceDate, monthStart)
          )
        );

      const runs = await tx
        .select({ status: payrollRuns.status })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.orgId, ctx.orgId),
            eq(payrollRuns.periodMonth, month),
            eq(payrollRuns.periodYear, year)
          )
        );

      const locked = runs.some((r) => r.status === "approved" || r.status === "paid");

      const outcome = evaluate(
        {
          employeeId,
          date: body.date,
          reason: body.reason,
          note: body.note,
          inTime: body.inTime,
          outTime: body.outTime,
          hasProof: body.hasProof,
        },
        {
          today: todayIso(),
          policy: DEFAULT_POLICY,
          approvedThisMonth: approvedThisMonth.length,
          hasOpenRequestForDate: open.length > 0,
          payrollLockedForMonth: locked,
        }
      );

      if (!outcome.accepted) return { outcome };

      const [row] = await tx
        .insert(attendanceRegularisations)
        .values({
          orgId: ctx.orgId,
          employeeId,
          attendanceDate: body.date,
          reason: body.reason,
          note: body.note ?? null,
          inTime: body.inTime ?? null,
          outTime: body.outTime ?? null,
          hasProof: body.hasProof ?? false,
          routing: outcome.routing,
        })
        .returning({ id: attendanceRegularisations.id });

      return { outcome, id: row.id };
    });

    if (!decided.outcome.accepted) {
      return NextResponse.json(
        { error: "This correction cannot be raised", problems: decided.outcome.problems },
        { status: 422 }
      );
    }

    return NextResponse.json({
      id: decided.id,
      routing: decided.outcome.routing,
      notes: decided.outcome.notes,
    });
  } catch (error) {
    if (error instanceof NoEmployeeRecordError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Regularisation create failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  let body: z.infer<typeof decideSchema>;
  try {
    body = decideSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid decision", detail: (error as z.ZodError).issues?.[0]?.message },
      { status: 400 }
    );
  }

  try {
    const result = await withTenant(ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(attendanceRegularisations)
        .where(eq(attendanceRegularisations.id, body.id))
        .limit(1);

      if (!existing) return { code: 404 as const };

      // ctx.userId is the signing-in account, not the employment record a
      // regularisation request is keyed by — see lib/current-employee.ts.
      const employeeId = await requireCurrentEmployeeId(ctx, tx);

      // Withdrawing your own is not approving your own, and is the one action
      // the requester may take on their own request.
      if (body.status === "cancelled") {
        if (existing.employeeId !== employeeId) return { code: 403 as const };
        if (existing.status !== "pending") return { code: 409 as const };
        await tx
          .update(attendanceRegularisations)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(attendanceRegularisations.id, body.id));
        return { code: 200 as const };
      }

      if (!APPROVERS.includes(ctx.role)) return { code: 403 as const };
      if (existing.status !== "pending") return { code: 409 as const };

      const permitted = canDecide({
        approverId: employeeId,
        requesterId: existing.employeeId,
        status: body.status,
        reason: body.reason,
      });

      if (!permitted.allowed) return { code: 422 as const, message: permitted.message };

      await tx
        .update(attendanceRegularisations)
        .set({
          status: body.status,
          decidedById: employeeId,
          decidedAt: new Date(),
          decisionReason: body.reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(attendanceRegularisations.id, body.id));

      return { code: 200 as const };
    });

    switch (result.code) {
      case 404:
        return NextResponse.json({ error: "Request not found" }, { status: 404 });
      case 403:
        return NextResponse.json({ error: "Not permitted" }, { status: 403 });
      case 409:
        return NextResponse.json(
          { error: "This request has already been decided." },
          { status: 409 }
        );
      case 422:
        return NextResponse.json({ error: result.message }, { status: 422 });
      default:
        return NextResponse.json({ ok: true });
    }
  } catch (error) {
    if (error instanceof NoEmployeeRecordError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Regularisation decision failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
