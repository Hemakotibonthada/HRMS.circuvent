// GET/POST /api/governance/consent — record and check consent.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonGovernanceRepository } from "@/db/repositories/governance.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z.object({
  purpose: z.string().trim().min(1).max(80),
  policyVersion: z.number().int().min(1).max(1000),
  granted: z.boolean(),
  capturedVia: z.string().trim().max(80).optional(),
  subjectEmail: z.string().email().optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(request.url);
  const purpose = searchParams.get("purpose") ?? "";
  const version = Number(searchParams.get("policyVersion") ?? "1");

  if (!purpose) {
    return NextResponse.json({ error: "A purpose is required" }, { status: 400 });
  }
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: "A valid policyVersion is required" }, { status: 400 });
  }

  const requested = searchParams.get("subjectEmail");
  const privileged = ["owner", "admin", "hr"].includes(ctx.role);
  const subjectEmail = privileged && requested ? requested : ctx.email;

  if (!subjectEmail) {
    return NextResponse.json({ error: "No subject to check" }, { status: 400 });
  }

  try {
    const status = await new NeonGovernanceRepository(ctx).consentStatus(
      subjectEmail,
      purpose,
      version
    );
    return NextResponse.json({ purpose, policyVersion: version, ...status });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Consent lookup failed:", error);
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

  const limit = checkRateLimit(`consent:${ctx.userId}`, 30, 60_000);
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

  // Consent is personal to the person giving it. Recording it on someone
  // else's behalf is precisely what makes a consent record worthless.
  const privileged = ["owner", "admin"].includes(ctx.role);
  if (parsed.data.subjectEmail && parsed.data.subjectEmail !== ctx.email && !privileged) {
    return NextResponse.json(
      { error: "You cannot record consent for someone else" },
      { status: 403 }
    );
  }

  const subjectEmail = parsed.data.subjectEmail ?? ctx.email;
  if (!subjectEmail) {
    return NextResponse.json({ error: "No subject to record consent for" }, { status: 400 });
  }

  try {
    const result = await new NeonGovernanceRepository(ctx).recordConsent({
      subjectEmail,
      subjectUserId: subjectEmail === ctx.email ? ctx.userId : undefined,
      purpose: parsed.data.purpose,
      policyVersion: parsed.data.policyVersion,
      granted: parsed.data.granted,
      capturedVia: parsed.data.capturedVia ?? "web",
      // Evidence of how it was captured, taken from the request rather than
      // the body. A self-reported IP is not evidence of anything.
      ipAddress:
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        request.headers.get("x-real-ip") ??
        undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Consent recording failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
