// GET/POST /api/custom-fields/definitions — tenant-defined fields.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonCustomFieldsRepository } from "@/db/repositories/custom-fields.neon";
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

const dataTypes = [
  "text",
  "textarea",
  "number",
  "currency",
  "date",
  "boolean",
  "select",
  "multiselect",
  "email",
  "phone",
  "url",
] as const;

const createSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  key: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]{0,48}$/,
      "A key must be lowercase letters, numbers and underscores, starting with a letter"
    ),
  label: z.string().trim().min(1).max(80),
  helpText: z.string().trim().max(300).optional(),
  dataType: z.enum(dataTypes),
  isRequired: z.boolean().optional(),
  options: z
    .array(
      z.object({
        value: z.string().trim().min(1).max(80),
        label: z.string().trim().min(1).max(120),
        isActive: z.boolean().optional(),
      })
    )
    .max(200)
    .optional(),
  validation: z
    .object({
      minLength: z.number().int().min(0).max(10_000).optional(),
      maxLength: z.number().int().min(1).max(10_000).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      // Capped here as well as in compilePattern: a tenant-authored regex runs
      // against every submitted value.
      pattern: z.string().max(200).optional(),
      patternMessage: z.string().trim().max(200).optional(),
    })
    .optional(),
  requiredWhen: z
    .object({
      key: z.string().min(1).max(50),
      equals: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1).max(20),
    })
    .optional(),
  isUnique: z.boolean().optional(),
  isPii: z.boolean().optional(),
  visibleToRoles: z.array(z.string().min(1).max(30)).max(20).optional(),
  editableByRoles: z.array(z.string().min(1).max(30)).max(20).optional(),
  section: z.string().trim().max(60).optional(),
  displayOrder: z.number().int().min(0).max(1000).optional(),
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
  const entityType = searchParams.get("entityType") ?? "employee";

  if (!ENTITY_TYPES.includes(entityType as (typeof ENTITY_TYPES)[number])) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 400 });
  }

  const includeInactive =
    searchParams.get("includeInactive") === "true" &&
    ["owner", "admin", "hr"].includes(ctx.role);

  try {
    const definitions = await new NeonCustomFieldsRepository(ctx).definitionsFor(
      entityType,
      ctx.role,
      includeInactive
    );
    return NextResponse.json({ entityType, definitions });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Field definition lookup failed:", error);
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

  // Defining a field changes the shape of every record of that type.
  if (!["owner", "admin"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot define custom fields" }, { status: 403 });
  }

  const limit = checkRateLimit(`fields:${ctx.userId}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const definition = await new NeonCustomFieldsRepository(ctx).createDefinition({
      ...parsed.data,
      createdById: ctx.userId,
    });
    return NextResponse.json(definition, { status: 201 });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Field definition creation failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
