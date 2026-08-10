// POST /api/ats/applications — register an application.
//
// A duplicate is reported, not blocked. People legitimately apply again after
// a year or for a different role — but an unnoticed duplicate means a previous
// rejection, and the reason for it, is invisible to the person about to
// interview them.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonAtsRepository } from "@/db/repositories/ats.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  jobId: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80),
  phone: z.string().trim().max(30).optional(),
  resumeUrl: z.string().url().max(2000).optional(),
  source: z.string().trim().max(60).optional(),
  referrerId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!["owner", "admin", "hr", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot register applications" }, { status: 403 });
  }

  const limit = checkRateLimit(`ats-apply:${ctx.userId}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

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
    const result = await new NeonAtsRepository(ctx).apply(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Application registration failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
