// GET/POST /api/benefits/enrolments — elect, waive, and review cover.
//
// Election is always for the caller. Accepting an employee id from the body
// would let someone elect cover on a colleague's behalf, which changes that
// person's salary deduction.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonBenefitsRepository } from "@/db/repositories/benefits.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { currentEmployeeId, NoEmployeeRecordError, requireCurrentEmployeeId } from "@/lib/current-employee";

const electSchema = z.object({
  action: z.literal("elect"),
  planId: z.string().uuid(),
  planYear: z.number().int().min(2000).max(2100),
  dependantIds: z.array(z.string().uuid()).max(20).optional(),
  lifeEvent: z
    .object({
      type: z.enum([
        "marriage",
        "birth",
        "adoption",
        "divorce",
        "death_of_dependant",
        "spouse_lost_coverage",
        "new_hire",
      ]),
      occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .optional(),
});

const waiveSchema = z.object({
  action: z.literal("waive"),
  planId: z.string().uuid(),
  planYear: z.number().int().min(2000).max(2100),
  reason: z.string().trim().min(3, "Tell us why you are declining").max(500),
});

const bodySchema = z.discriminatedUnion("action", [electSchema, waiveSchema]);

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("employeeId") ?? undefined;
  const privileged = ["owner", "admin", "hr"].includes(ctx.role);

  const planYear = Number(searchParams.get("planYear")) || undefined;

  try {
    // ctx.userId is the signing-in account, not the employment record
    // benefits enrolments are keyed by — see lib/current-employee.ts.
    const self = await currentEmployeeId(ctx);
    const employeeId = privileged && requested ? requested : self;

    if (!employeeId) {
      return NextResponse.json({ employeeId: null, enrolments: [] });
    }

    const enrolments = await new NeonBenefitsRepository(ctx).enrolmentsFor(
      employeeId,
      planYear
    );
    return NextResponse.json({ employeeId, enrolments });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Enrolment lookup failed:", error);
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

  const limit = checkRateLimit(`benefits:${ctx.userId}`, 20, 60_000);
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
    // ctx.userId is the signing-in account, not the employment record
    // benefits enrolments are keyed by — see lib/current-employee.ts.
    const employeeId = await requireCurrentEmployeeId(ctx);
    const repo = new NeonBenefitsRepository(ctx);

    if (parsed.data.action === "waive") {
      await repo.waive(
        employeeId,
        parsed.data.planId,
        parsed.data.planYear,
        parsed.data.reason
      );
      return NextResponse.json({ ok: true, status: "waived" });
    }

    const today = new Date().toISOString().slice(0, 10);
    const enrolment = await repo.elect(
      {
        employeeId,
        planId: parsed.data.planId,
        planYear: parsed.data.planYear,
        dependantIds: parsed.data.dependantIds,
        lifeEvent: parsed.data.lifeEvent,
      },
      today
    );

    return NextResponse.json(enrolment, { status: 201 });
  } catch (error) {
    if (error instanceof NoEmployeeRecordError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Benefit election failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
