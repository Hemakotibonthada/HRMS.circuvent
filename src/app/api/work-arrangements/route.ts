// ═══════════════════════════════════════════════════════════════
// /api/work-arrangements — working from home, or on duty elsewhere
// ═══════════════════════════════════════════════════════════════
//
// GET    the caller's own, or a manager's queue with ?queue=1.
// POST   raise one.
// PATCH  approve, reject, or withdraw.
//
// These are not leave. Somebody working from home is working: the day should
// count as present and no balance should move. Modelling this as a leave type
// is how people lose a day's entitlement for turning up in their own front
// room, and it is the single most common way an HRMS gets this wrong.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq, gte, lte, ne, or } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { employees, workArrangementRequests } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

const APPROVERS = ["owner", "admin", "hr", "manager"];

/** How far ahead somebody may book. Beyond this it is a plan, not a request. */
const MAX_FUTURE_DAYS = 90;
/** How far back. A request for last month is a regularisation, not this. */
const MAX_PAST_DAYS = 7;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    kind: z.enum(["wfh", "on_duty"]),
    startDate: z.string().regex(DATE),
    endDate: z.string().regex(DATE),
    reason: z.string().trim().max(500).optional(),
    location: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "The last day cannot be before the first",
    path: ["endDate"],
  })
  .refine((v) => v.kind !== "on_duty" || !!v.location?.trim(), {
    message: "Say where you will be. That is the difference between on duty and working from home.",
    path: ["location"],
  });

const decideSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["approved", "rejected", "cancelled"]),
  reason: z.string().trim().max(500).optional(),
});

const iso = (d: Date) => d.toISOString().slice(0, 10);

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
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
          id: workArrangementRequests.id,
          employeeId: workArrangementRequests.employeeId,
          kind: workArrangementRequests.kind,
          startDate: workArrangementRequests.startDate,
          endDate: workArrangementRequests.endDate,
          reason: workArrangementRequests.reason,
          location: workArrangementRequests.location,
          status: workArrangementRequests.status,
          decisionReason: workArrangementRequests.decisionReason,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(workArrangementRequests)
        .innerJoin(employees, eq(employees.id, workArrangementRequests.employeeId));

      return queue
        ? await base
            .where(eq(workArrangementRequests.status, "pending"))
            .orderBy(desc(workArrangementRequests.startDate))
            .limit(100)
        : await base
            .where(eq(workArrangementRequests.employeeId, ctx.userId))
            .orderBy(desc(workArrangementRequests.startDate))
            .limit(60);
    });

    return NextResponse.json({
      requests: rows.map((r) => ({
        ...r,
        employeeName: `${r.firstName} ${r.lastName}`.trim(),
      })),
      limits: { maxFutureDays: MAX_FUTURE_DAYS, maxPastDays: MAX_PAST_DAYS },
    });
  } catch (error) {
    console.error("Work arrangement list failed:", error);
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

  const today = iso(new Date());
  const startsIn = daysBetween(today, body.startDate);

  if (startsIn > MAX_FUTURE_DAYS) {
    return NextResponse.json(
      { error: `Requests can be raised up to ${MAX_FUTURE_DAYS} days ahead.` },
      { status: 422 }
    );
  }
  if (startsIn < -MAX_PAST_DAYS) {
    return NextResponse.json(
      {
        error:
          `A day more than ${MAX_PAST_DAYS} days past is corrected through attendance ` +
          `regularisation rather than requested here.`,
      },
      { status: 422 }
    );
  }

  try {
    const outcome = await withTenant(ctx, async (tx) => {
      // Overlapping requests are the quiet failure here: two approved WFH
      // ranges covering the same day means the attendance record has two
      // reasons for one day and payroll picks whichever it reads first.
      const clash = await tx
        .select({ id: workArrangementRequests.id })
        .from(workArrangementRequests)
        .where(
          and(
            eq(workArrangementRequests.employeeId, ctx.userId),
            ne(workArrangementRequests.status, "rejected"),
            ne(workArrangementRequests.status, "cancelled"),
            lte(workArrangementRequests.startDate, body.endDate),
            gte(workArrangementRequests.endDate, body.startDate)
          )
        )
        .limit(1);

      if (clash.length > 0) return { clash: true as const };

      const [row] = await tx
        .insert(workArrangementRequests)
        .values({
          orgId: ctx.orgId,
          employeeId: ctx.userId,
          kind: body.kind,
          startDate: body.startDate,
          endDate: body.endDate,
          reason: body.reason ?? null,
          location: body.location ?? null,
        })
        .returning({ id: workArrangementRequests.id });

      return { clash: false as const, id: row.id };
    });

    if (outcome.clash) {
      return NextResponse.json(
        {
          error:
            "You already have a request covering one of those days. Withdraw it before " +
            "raising another, or the attendance record has two reasons for one day.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ id: outcome.id, status: "pending" });
  } catch (error) {
    console.error("Work arrangement create failed:", error);
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
        .from(workArrangementRequests)
        .where(eq(workArrangementRequests.id, body.id))
        .limit(1);

      if (!existing) return { code: 404 as const };
      if (existing.status !== "pending") return { code: 409 as const };

      if (body.status === "cancelled") {
        if (existing.employeeId !== ctx.userId) return { code: 403 as const };
        await tx
          .update(workArrangementRequests)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(workArrangementRequests.id, body.id));
        return { code: 200 as const };
      }

      if (!APPROVERS.includes(ctx.role)) return { code: 403 as const };

      // The database refuses this too. Both, because the route is not the only
      // writer a system ends up with.
      if (existing.employeeId === ctx.userId) {
        return { code: 422 as const, message: "You cannot decide your own request." };
      }

      if (body.status === "rejected" && !body.reason?.trim()) {
        return {
          code: 422 as const,
          message: "Say why. Somebody rearranging their week is owed a reason.",
        };
      }

      await tx
        .update(workArrangementRequests)
        .set({
          status: body.status,
          decidedById: ctx.userId,
          decidedAt: new Date(),
          decisionReason: body.reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(workArrangementRequests.id, body.id));

      return { code: 200 as const };
    });

    switch (result.code) {
      case 404:
        return NextResponse.json({ error: "Request not found" }, { status: 404 });
      case 403:
        return NextResponse.json({ error: "Not permitted" }, { status: 403 });
      case 409:
        return NextResponse.json({ error: "Already decided." }, { status: 409 });
      case 422:
        return NextResponse.json({ error: result.message }, { status: 422 });
      default:
        return NextResponse.json({ ok: true });
    }
  } catch (error) {
    console.error("Work arrangement decision failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
