// GET/POST /api/compensation/bands — salary bands.
//
// Bands are the reference every compensation conversation starts from, so
// reading them is open to managers while setting them is not.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonCompensationRepository } from "@/db/repositories/compensation.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z
  .object({
    gradeCode: z.string().trim().min(1).max(20),
    name: z.string().trim().min(1).max(80),
    // Strings, because a band maximum in minor units exceeds Number.MAX_SAFE_INTEGER
    // for high-inflation currencies and JSON has no bigint.
    minMinor: z.string().regex(/^\d{1,19}$/, "Amounts are minor units as digits"),
    midMinor: z.string().regex(/^\d{1,19}$/, "Amounts are minor units as digits"),
    maxMinor: z.string().regex(/^\d{1,19}$/, "Amounts are minor units as digits"),
    currency: z.string().length(3).optional(),
    locationId: z.string().uuid().optional(),
    jobFamily: z.string().trim().max(60).optional(),
    benchmarkSource: z.string().trim().max(200).optional(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((v) => BigInt(v.minMinor) <= BigInt(v.midMinor), {
    message: "The minimum cannot exceed the midpoint",
  })
  .refine((v) => BigInt(v.midMinor) <= BigInt(v.maxMinor), {
    message: "The midpoint cannot exceed the maximum",
  });

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!["owner", "admin", "hr", "manager"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot view salary bands" }, { status: 403 });
  }

  try {
    const bands = await new NeonCompensationRepository(ctx).listBands();
    return NextResponse.json({
      bands: bands.map((b) => ({
        ...b,
        minMinor: b.minMinor.toString(),
        midMinor: b.midMinor.toString(),
        maxMinor: b.maxMinor.toString(),
      })),
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Band lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // Setting a band changes what every person in that grade is measured
  // against, including the people setting it.
  if (!["owner", "admin"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot set salary bands" }, { status: 403 });
  }

  const limit = checkRateLimit(`bands:${ctx.userId}`, 30, 60_000);
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
    const band = await new NeonCompensationRepository(ctx).saveBand({
      ...parsed.data,
      minMinor: BigInt(parsed.data.minMinor),
      midMinor: BigInt(parsed.data.midMinor),
      maxMinor: BigInt(parsed.data.maxMinor),
    });

    return NextResponse.json({
      ...band,
      minMinor: band.minMinor.toString(),
      midMinor: band.midMinor.toString(),
      maxMinor: band.maxMinor.toString(),
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Band save failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
