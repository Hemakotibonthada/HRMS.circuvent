// GET/POST /api/benefits/claims — submit and review benefit claims.
//
// The repository refuses a claim whose incident date falls outside the
// coverage period, which is the most common invalid claim and a straight loss
// if paid.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonBenefitsRepository } from "@/db/repositories/benefits.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { currentEmployeeId, NoEmployeeRecordError, requireCurrentEmployeeId } from "@/lib/current-employee";
import { describeIssues, toFieldIssues } from "@/lib/validation-response";

const submitSchema = z.object({
  enrolmentId: z.string().uuid(),
  dependantId: z.string().uuid().optional(),
  claimedAmount: z.number().positive().max(100_000_000),
  incidentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().max(2000).optional(),
  documents: z.array(z.string().url()).max(20).optional(),
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
  // Claims describe medical events. Only the claimant and the people who
  // administer benefits see them.
  const privileged = ["owner", "admin", "hr"].includes(ctx.role);
  const requested = searchParams.get("employeeId") ?? undefined;

  try {
    // ctx.userId is the signing-in account, not the employment record a
    // claim is keyed by — see lib/current-employee.ts.
    const self = await currentEmployeeId(ctx);
    const employeeId = privileged && requested ? requested : self;

    if (!employeeId) {
      return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, hasMore: false });
    }

    const page = await new NeonBenefitsRepository(ctx).listClaims({
      page: Number(searchParams.get("page")) || undefined,
      pageSize: Number(searchParams.get("pageSize")) || undefined,
      filters: { employeeId },
    });
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Claim lookup failed:", error);
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

  const limit = checkRateLimit(`claim:${ctx.userId}`, 15, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = submitSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: describeIssues(toFieldIssues(parsed.error)), issues: toFieldIssues(parsed.error) },
      { status: 400 }
    );
  }

  // A claim dated in the future has not happened yet.
  if (parsed.data.incidentDate > new Date().toISOString().slice(0, 10)) {
    return NextResponse.json(
      { error: "The incident date cannot be in the future" },
      { status: 400 }
    );
  }

  try {
    // ctx.userId is the signing-in account, not the employment record a
    // claim is keyed by — see lib/current-employee.ts.
    const employeeId = await requireCurrentEmployeeId(ctx);
    const id = await new NeonBenefitsRepository(ctx).submitClaim({
      enrolmentId: parsed.data.enrolmentId,
      // Always the caller: claiming on someone else's cover is fraud.
      employeeId,
      dependantId: parsed.data.dependantId,
      claimedAmountMinor: BigInt(Math.round(parsed.data.claimedAmount * 100)),
      incidentDate: parsed.data.incidentDate,
      description: parsed.data.description,
      documents: parsed.data.documents,
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof NoEmployeeRecordError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Enrolment not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Claim submission failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
