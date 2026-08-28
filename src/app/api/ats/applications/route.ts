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

// ─────────────────────────────────────────────────────────────
// GET /api/ats/applications — the pipeline.
//
// This did not exist. The route exposed POST alone, so an application could
// be created, advanced, rejected and reported on, but never listed — the
// pipeline board had nothing to read, and the funnel reports described data
// no screen could show.

const listSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  jobId: z.string().uuid().optional(),
  stage: z.string().trim().max(40).optional(),
  status: z.string().trim().max(40).optional(),
  search: z.string().trim().max(120).optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    // Applications carry a candidate's contact details and a rejection
    // reason. A reporting line is not a reason to read either, so this is
    // restricted to the people running hiring.
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const parsed = listSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query" },
      { status: 400 }
    );
  }

  try {
    const page = await new NeonAtsRepository(ctx).listApplications(parsed.data);
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Application list failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
