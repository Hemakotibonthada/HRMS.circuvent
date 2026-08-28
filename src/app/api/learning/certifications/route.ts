// GET /api/learning/certifications — certifications approaching expiry.
//
// The point of this endpoint is lead time. A lapsed safety certification found
// on the day it expires leaves no time to arrange a renewal.

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

  if (!["owner", "admin", "hr", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot view this report" }, { status: 403 });
  }

  const raw = Number(new URL(request.url).searchParams.get("withinDays"));
  const withinDays = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 365) : 60;

  const today = new Date().toISOString().slice(0, 10);

  try {
    const expiring = await new NeonLearningRepository(ctx).expiringCertifications(
      today,
      withinDays
    );
    return NextResponse.json({ withinDays, expiring });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Certification lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
