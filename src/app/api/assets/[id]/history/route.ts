// GET /api/assets/[id]/history — who held this asset, and when.
//
// "Who had this laptop when the data was leaked?" is a question the current
// assignment cannot answer, and it is the question that actually gets asked.

import { NextResponse, type NextRequest } from "next/server";
import { NeonAssetsRepository } from "@/db/repositories/assets.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

export async function GET(
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

  // The custody chain names every previous holder, which is personnel data
  // rather than an equipment detail.
  if (!["owner", "admin", "hr", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot view asset history" }, { status: 403 });
  }

  const { id } = await params;

  try {
    return NextResponse.json(await new NeonAssetsRepository(ctx).history(id));
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Asset history lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
