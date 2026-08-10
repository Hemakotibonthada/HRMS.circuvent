// GET /api/ats/reports — funnel, time to hire, sources, stalled applications.
//
// The funnel is counted from the event log rather than from current stage, so
// someone who reached interview and was then rejected still counts as having
// reached it. Counting current stage alone makes every funnel look like a
// cliff at whichever stage people happen to be sitting in.

import { NextResponse, type NextRequest } from "next/server";
import { NeonAtsRepository } from "@/db/repositories/ats.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const REPORTS = ["funnel", "time-to-hire", "sources", "stalled"] as const;

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!["owner", "admin", "hr", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot view hiring reports" }, { status: 403 });
  }

  // These aggregate across every application; they are not free.
  const limit = checkRateLimit(`ats-reports:${ctx.userId}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const report = searchParams.get("report") ?? "funnel";
  const jobId = searchParams.get("jobId") ?? undefined;

  if (!REPORTS.includes(report as (typeof REPORTS)[number])) {
    return NextResponse.json(
      { error: `Unknown report. Available: ${REPORTS.join(", ")}` },
      { status: 400 }
    );
  }

  const repo = new NeonAtsRepository(ctx);

  try {
    switch (report) {
      case "funnel":
        return NextResponse.json({ report, jobId, stages: await repo.funnelFor(jobId) });
      case "time-to-hire":
        return NextResponse.json({ report, jobId, ...(await repo.timeToHireFor(jobId)) });
      case "sources":
        return NextResponse.json({ report, sources: await repo.sourceReport() });
      default:
        return NextResponse.json({ report, applications: await repo.stalled() });
    }
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Hiring report failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
