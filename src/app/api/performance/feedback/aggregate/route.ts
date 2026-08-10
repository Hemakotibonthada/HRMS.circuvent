// GET /api/performance/feedback/aggregate — the 360° report.
//
// Groups with too few responses are withheld, and the reason is returned so
// the subject is told something was suppressed rather than shown a report that
// looks complete. Comments are pooled and shuffled: submission order is a
// channel, and a subject who knows their manager replied first can otherwise
// attribute the first comment.

import { NextResponse, type NextRequest } from "next/server";
import { NeonPerformanceRepository } from "@/db/repositories/performance.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`feedback-report:${ctx.userId}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const cycleId = searchParams.get("cycleId");
  const requested = searchParams.get("subjectId");

  if (!cycleId) {
    return NextResponse.json({ error: "A cycleId is required" }, { status: 400 });
  }

  const privileged = ["owner", "hr"].includes(ctx.role);
  if (requested && requested !== ctx.userId && !privileged) {
    // Not even a manager reads a report about someone else by default. The
    // respondents were told it was anonymous, and widening the audience after
    // the fact is how that promise stops being true.
    return NextResponse.json(
      { error: "You can only view your own feedback report" },
      { status: 403 }
    );
  }

  const subjectId = requested ?? ctx.userId;

  try {
    const report = await new NeonPerformanceRepository(ctx).aggregateFor(subjectId, cycleId);

    if (!report.canRelease) {
      // Deliberately not a partial report: releasing what is available while
      // saying "some was withheld" invites the subject to work out who is
      // missing from a small team.
      return NextResponse.json(
        {
          subjectId,
          cycleId,
          canRelease: false,
          responseCount: report.responseCount,
          suppressed: report.suppressed,
          message:
            "Not enough responses have been received for this report to be released without identifying the people who gave it",
        },
        { status: 200 }
      );
    }

    return NextResponse.json(report, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Feedback aggregation failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
