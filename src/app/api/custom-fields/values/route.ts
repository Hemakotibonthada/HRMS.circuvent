// GET/PUT /api/custom-fields/values — read and write custom field values.
//
// Errors come back per field, keyed, so a form can put each message next to
// the input that caused it. A single flattened string forces the user to
// guess which field it referred to.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  FieldValidationError,
  NeonCustomFieldsRepository,
} from "@/db/repositories/custom-fields.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const ENTITY_TYPES = [
  "employee",
  "candidate",
  "asset",
  "ticket",
  "department",
  "job_posting",
] as const;

const putSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().uuid(),
  values: z.record(
    z.string().max(50),
    z.union([
      z.string().max(10_000),
      z.number(),
      z.boolean(),
      z.array(z.string().max(200)).max(100),
      z.null(),
    ])
  ),
  /** False replaces the whole record, enforcing every required field. */
  partial: z.boolean().optional(),
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
  const entityType = searchParams.get("entityType") ?? "";
  const entityId = searchParams.get("entityId") ?? "";

  if (!ENTITY_TYPES.includes(entityType as (typeof ENTITY_TYPES)[number])) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(entityId)) {
    return NextResponse.json({ error: "A valid entityId is required" }, { status: 400 });
  }

  try {
    const repo = new NeonCustomFieldsRepository(ctx);
    const [values, gaps] = await Promise.all([
      repo.valuesFor(entityType, entityId, ctx.role),
      repo.audit(entityType, entityId, ctx.role),
    ]);

    // Gaps are reported alongside rather than as an error: a record predating
    // a newly required field is incomplete, not invalid.
    return NextResponse.json({ entityType, entityId, values, gaps });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Custom field lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`field-values:${ctx.userId}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const values = await new NeonCustomFieldsRepository(ctx).saveValues(
      parsed.data.entityType,
      parsed.data.entityId,
      parsed.data.values,
      { role: ctx.role, userId: ctx.userId, partial: parsed.data.partial ?? true }
    );
    return NextResponse.json({ values });
  } catch (error) {
    if (error instanceof FieldValidationError) {
      return NextResponse.json(
        { error: error.message, fieldErrors: error.errors },
        { status: 422 }
      );
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Custom field save failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
