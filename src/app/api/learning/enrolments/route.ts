// GET/POST /api/learning/enrolments — an employee's learning, and enrolling.
//
// Enrolling someone else is a management action, so it is gated. Enrolling
// yourself is not.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonLearningRepository } from "@/db/repositories/learning.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { currentEmployeeId, NoEmployeeRecordError } from "@/lib/current-employee";

const enrolSchema = z.object({
  action: z.literal("enrol"),
  courseId: z.string().uuid(),
  employeeId: z.string().uuid().optional(),
});

const assignMandatorySchema = z.object({
  action: z.literal("assign-mandatory"),
  employeeId: z.string().uuid(),
});

const bodySchema = z.discriminatedUnion("action", [enrolSchema, assignMandatorySchema]);

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const requested = new URL(request.url).searchParams.get("employeeId");
  const privileged = ["owner", "admin", "hr", "manager"].includes(ctx.role);

  const today = new Date().toISOString().slice(0, 10);

  try {
    // ctx.userId is the signing-in account, not the employment record
    // learning enrolments are keyed by — see lib/current-employee.ts.
    const self = await currentEmployeeId(ctx);
    const employeeId = privileged && requested ? requested : self;

    if (!employeeId) {
      return NextResponse.json({ employeeId: null, enrolments: [] });
    }

    const enrolments = await new NeonLearningRepository(ctx).myLearning(employeeId, today);
    return NextResponse.json({ employeeId, enrolments });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Learning lookup failed:", error);
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

  const limit = checkRateLimit(`learning:${ctx.userId}`, 30, 60_000);
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

  const privileged = ["owner", "admin", "hr", "manager"].includes(ctx.role);
  const today = new Date().toISOString().slice(0, 10);

  try {
    const repo = new NeonLearningRepository(ctx);

    if (parsed.data.action === "assign-mandatory") {
      if (!privileged) {
        return NextResponse.json({ error: "You cannot assign training" }, { status: 403 });
      }
      const result = await repo.assignMandatory(parsed.data.employeeId, today, ctx.userId);
      return NextResponse.json(result);
    }

    const target = parsed.data.employeeId;
    // ctx.userId is the signing-in account, not the employment record an
    // enrolment is keyed by — see lib/current-employee.ts.
    const self = await currentEmployeeId(ctx);

    if (target && target !== self && !privileged) {
      return NextResponse.json({ error: "You cannot enrol someone else" }, { status: 403 });
    }

    const employeeId = target ?? self;
    if (!employeeId) {
      throw new NoEmployeeRecordError(ctx.userId);
    }

    const enrolment = await repo.enrol(
      parsed.data.courseId,
      employeeId,
      today,
      employeeId === self ? undefined : ctx.userId
    );

    return NextResponse.json(enrolment, { status: 201 });
  } catch (error) {
    if (error instanceof NoEmployeeRecordError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Enrolment failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
