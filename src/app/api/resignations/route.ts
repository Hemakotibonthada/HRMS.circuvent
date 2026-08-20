// ═══════════════════════════════════════════════════════════════
// HRMS API — resignations
// ═══════════════════════════════════════════════════════════════
// The start of the leaver path: an employee submits their intended last
// working day and a reason, exactly like `leave/route.ts` lets them apply for
// leave. The same rule shapes both handlers here that shapes that file — an
// employee acts on their own resignation and nobody else's, and only HR may
// record one on somebody else's behalf (a resignation given in person or on
// paper, not filed through the app).
//
// What is deliberately not here: accepting, adjusting the last working day,
// and triggering exit processing are each their own route under
// `resignations/[id]/`, not an `action` discriminator on this one — see
// `interns/[id]/convert/route.ts`'s comment for why a route with exactly one
// job does not need a body flag to say so, and here there are three
// different jobs with three different role gates, which is reason enough to
// keep them apart rather than force one schema to describe all three.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonResignationRepository } from "@/db/repositories/resignation.neon";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { currentEmployeeId, NoEmployeeRecordError } from "@/lib/current-employee";
import { roleHasPermission } from "@/lib/rbac";
import { notifyEmployee } from "@/lib/notifications/notify";
import { validationFailed } from "@/lib/validation-response";

const submitSchema = z.object({
  employeeId: z.string().uuid().optional(),
  reason: z.string().trim().min(3, "Give a reason for leaving").max(2000),
  intendedLastWorkingDay: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Intended last working day must be YYYY-MM-DD"),
});

const listSchema = z.object({
  status: z.enum(["submitted", "accepted"]).optional(),
  employeeId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

function fail(error: unknown) {
  if (error instanceof NoEmployeeRecordError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Resignations API failure:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(request.url);
  const parsed = listSchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return validationFailed(parsed.error);
  }

  // Whoever can see the whole leaver queue (HR, admins, a manager checking
  // their reports) may ask for anyone; everybody else only ever sees their
  // own — the same split `leave/route.ts` makes, scoped in the handler
  // rather than trusted from the query string.
  const seesAll = roleHasPermission(ctx.role, "resignation.view_all");

  try {
    // ctx.userId is the signing-in account, not the employment record a
    // resignation is filed against — see lib/current-employee.ts.
    const self = seesAll ? null : await currentEmployeeId(ctx);
    const employeeId = seesAll ? parsed.data.employeeId : (self ?? undefined);

    if (!seesAll && !self) {
      return NextResponse.json({
        items: [],
        total: 0,
        page: parsed.data.page ?? 1,
        pageSize: parsed.data.pageSize ?? 50,
        hasMore: false,
      });
    }

    const repo = new NeonResignationRepository(ctx);
    const page = await repo.list({
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      filters: { status: parsed.data.status, employeeId },
    });
    return NextResponse.json(page);
  } catch (error) {
    return fail(error);
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

  if (!roleHasPermission(ctx.role, "resignation.apply")) {
    return NextResponse.json({ error: "You cannot submit a resignation" }, { status: 403 });
  }

  const limit = checkRateLimit(`resignation-submit:${clientIdentifier(request, ctx.userId)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = submitSchema.safeParse(raw);
  if (!parsed.success) {
    return validationFailed(parsed.error);
  }

  // Filing for someone else is an HR action — recording a resignation that
  // was handed in on paper or given verbally, not something a manager does
  // to a report. Silently rewriting the id would hide that it happened;
  // refusing makes the boundary explicit, same as `leave/route.ts`.
  try {
    // ctx.userId is the signing-in account, not the employment record a
    // resignation is filed against — see lib/current-employee.ts.
    const self = await currentEmployeeId(ctx);
    const target = parsed.data.employeeId ?? self;

    if (target !== self && !["owner", "admin", "hr"].includes(ctx.role)) {
      return NextResponse.json(
        { error: "You can only submit your own resignation" },
        { status: 403 }
      );
    }
    if (!target) {
      throw new NoEmployeeRecordError(ctx.userId);
    }

    const repo = new NeonResignationRepository(ctx);
    const created = await repo.submit({
      employeeId: target,
      reason: parsed.data.reason,
      intendedLastWorkingDay: parsed.data.intendedLastWorkingDay,
    });

    // The manager finds out there is a decision to make instead of finding
    // out by a direct report mentioning it in a 1:1. Best-effort and never
    // allowed to fail the submission that already committed — the same
    // trade `leave/[id]/decision/route.ts` makes for its own notification.
    void (async () => {
      const employee = await new NeonEmployeeRepository(ctx).getById(target);
      if (!employee?.reportingToId) return;
      await notifyEmployee(ctx, {
        employeeId: employee.reportingToId,
        type: "resignation.submitted",
        data: {
          employeeName: employee.fullName,
          intendedLastWorkingDay: created.intendedLastWorkingDay,
          reason: created.reason,
        },
        actionUrl: "/resignation",
        // One submission, one notification — a retried request must not
        // page the manager twice for the same resignation.
        idempotencyKey: `resignation-submitted:${created.id}`,
      });
    })().catch((error) => {
      console.error(`[resignations] Could not notify manager of ${created.id}:`, error);
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
