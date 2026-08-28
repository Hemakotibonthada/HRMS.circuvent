// GET /api/learning/compliance — mandatory-training status across the org.
//
// Includes people with no enrolment at all. A report built only from enrolment
// rows shows 100% compliance the day a mandatory course is created and nobody
// has been assigned it, which is the most misleading number the system could
// produce.

import { NextResponse, type NextRequest } from "next/server";
import { NeonLearningRepository } from "@/db/repositories/learning.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // A whole-org training record is personnel data, not a dashboard widget.
  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot view this report" }, { status: 403 });
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const report = await new NeonLearningRepository(ctx).complianceReport(today);
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Compliance report failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
