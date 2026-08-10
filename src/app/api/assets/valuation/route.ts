// GET /api/assets/valuation — total book value, by category.
//
// The figure finance reconciles against the fixed-asset ledger, so it accepts
// an `asOf` date: a year-end reconciliation needs the value on 31 March, not
// the value today.

import { NextResponse, type NextRequest } from "next/server";
import { NeonAssetsRepository } from "@/db/repositories/assets.neon";
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

  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot view the valuation" }, { status: 403 });
  }

  const asOf = new URL(request.url).searchParams.get("asOf") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return NextResponse.json({ error: "asOf must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    return NextResponse.json(await new NeonAssetsRepository(ctx).valuation(asOf));
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Valuation failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
