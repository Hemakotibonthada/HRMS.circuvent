// GET /api/performance/cycles — the review cycles an employee can see, with
// their own goals in each.
//
// This route existed nowhere, which made the rest of the performance module
// unreachable from any client that had not been told a cycle id out of band.
// `/api/performance/goals` requires a `cycleId` and there was no way to
// discover one; the dashboard sidestepped the problem entirely by writing
// goals into the schemaless document store instead, so the real
// `performance_goals` table sat empty while the feature appeared to work.
//
// Goals are returned per cycle rather than behind a second round trip. A
// cycle with no goals in it and a cycle whose goals have not loaded yet look
// identical to a reader, and the difference decides whether they wait or start
// typing.

import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { performanceGoals, reviewCycles } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(clientIdentifier(request, ctx.userId), 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const url = new URL(request.url);
  const requested = url.searchParams.get("employeeId");
  const isManagerish = ["owner", "admin", "hr", "manager"].includes(ctx.role);

  try {
    // ctx.userId is the signing-in account, not the employment record goals
    // are keyed by — see lib/current-employee.ts.
    const self = await currentEmployeeId(ctx);

    // Same rule as check-ins: an ordinary employee sees their own goals and
    // nobody else's, and asking for somebody else's is refused rather than
    // quietly answered with their own.
    if (requested && requested !== self && !isManagerish) {
      return NextResponse.json({ error: "You can only view your own" }, { status: 403 });
    }
    const employeeId = requested ?? self;

    if (!employeeId) {
      return NextResponse.json({ cycles: [] });
    }

    const payload = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      // Draft cycles are excluded. A draft is HR still deciding the dates, and
      // showing one invites somebody to write goals against a period that then
      // moves underneath them.
      const cycles = await tx
        .select()
        .from(reviewCycles)
        .where(and(eq(reviewCycles.orgId, ctx.orgId), inArray(reviewCycles.status, ["active", "closed"])))
        .orderBy(desc(reviewCycles.periodStart));

      if (cycles.length === 0) return { cycles: [] };

      const goals = await tx
        .select()
        .from(performanceGoals)
        .where(
          and(
            eq(performanceGoals.orgId, ctx.orgId),
            eq(performanceGoals.employeeId, employeeId),
            // inArray, not `= ANY(...)`: binding an array as a scalar produces
            // "malformed array literal" at runtime, not at build time.
            inArray(
              performanceGoals.cycleId,
              cycles.map((c) => c.id)
            )
          )
        )
        .orderBy(desc(performanceGoals.createdAt));

      return {
        cycles: cycles.map((cycle) => ({
          id: cycle.id,
          name: cycle.name,
          periodStart: cycle.periodStart,
          periodEnd: cycle.periodEnd,
          status: cycle.status,
          selfReviewDueOn: cycle.selfReviewDueOn,
          includesSelfReview: cycle.includesSelfReview,
          goals: goals
            .filter((g) => g.cycleId === cycle.id)
            .map((g) => ({
              id: g.id,
              title: g.title,
              description: g.description,
              category: g.category,
              weightPercent: g.weightPercent,
              progressPercent: g.progressPercent,
              status: g.status,
              dueDate: g.dueDate,
              // Numeric comes back as a string from pg and is left as one.
              // Parsing to a float here would round a target of 1000000.05 on
              // its way to a client that only ever displays it.
              targetValue: g.targetValue,
              currentValue: g.currentValue,
              unit: g.unit,
            })),
        })),
      };
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Cycle lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
