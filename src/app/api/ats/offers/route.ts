// POST /api/ats/offers — draft an offer.
//
// A revision is a new version rather than an edit, so a renegotiation keeps
// both figures and the record shows what was first proposed.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonAtsRepository } from "@/db/repositories/ats.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  applicationId: z.string().uuid(),
  designation: z.string().trim().min(1).max(120),
  // A string, because an annual CTC in minor units exceeds the safe integer
  // range for high-inflation currencies and JSON has no bigint.
  annualCtcMinor: z.string().regex(/^\d{1,19}$/, "Amounts are minor units as digits"),
  gradeCode: z.string().trim().max(20).optional(),
  joiningBonusMinor: z.string().regex(/^\d{1,19}$/).optional(),
  equityUnits: z.number().int().min(0).max(10_000_000).optional(),
  proposedStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // A signing window that never closes is not a window.
  expiresInDays: z.number().int().min(1).max(180).optional(),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!["owner", "admin", "hr"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot draft offers" }, { status: 403 });
  }

  const limit = checkRateLimit(`ats-offer:${ctx.userId}`, 30, 60_000);
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
    const offer = await new NeonAtsRepository(ctx).createOffer({
      ...parsed.data,
      annualCtcMinor: BigInt(parsed.data.annualCtcMinor),
      joiningBonusMinor: parsed.data.joiningBonusMinor
        ? BigInt(parsed.data.joiningBonusMinor)
        : undefined,
      createdById: ctx.userId,
    });
    return NextResponse.json(offer, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Offer creation failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
