// GET/POST /api/ats/applications/[id] — history, and pipeline movement.
//
// A rejection needs a reason. "Rejected" with no basis is what a
// discrimination claim looks for, and its absence is read as its own kind of
// answer.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonAtsRepository } from "@/db/repositories/ats.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("advance"), toStageId: z.string().uuid().optional() }),
  z.object({
    action: z.literal("reject"),
    reason: z.string().trim().min(5, "Give a reason for the rejection").max(2000),
  }),
]);

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

  if (!["owner", "admin", "hr", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot view applications" }, { status: 403 });
  }

  const { id } = await params;

  try {
    return NextResponse.json({ events: await new NeonAtsRepository(ctx).history(id) });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Application history lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
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

  if (!["owner", "admin", "hr", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot move applications" }, { status: 403 });
  }

  const limit = checkRateLimit(`ats-move:${ctx.userId}`, 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const repo = new NeonAtsRepository(ctx);

    if (parsed.data.action === "reject") {
      return NextResponse.json(await repo.reject(id, ctx.userId, parsed.data.reason));
    }

    return NextResponse.json(await repo.advance(id, ctx.userId, parsed.data.toStageId));
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Application move failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
