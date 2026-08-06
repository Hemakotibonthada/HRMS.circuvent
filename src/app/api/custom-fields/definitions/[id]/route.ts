// PATCH /api/custom-fields/definitions/[id] — revise a field definition.
//
// A 409 here is the system refusing to corrupt data: changing a field's type
// once values exist, or deleting an option a record still uses.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonCustomFieldsRepository } from "@/db/repositories/custom-fields.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

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

const patchSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    helpText: z.string().trim().max(300).optional(),
    dataType: z.enum(dataTypes).optional(),
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
        pattern: z.string().max(200).optional(),
        patternMessage: z.string().trim().max(200).optional(),
      })
      .optional(),
    isUnique: z.boolean().optional(),
    isPii: z.boolean().optional(),
    visibleToRoles: z.array(z.string().min(1).max(30)).max(20).optional(),
    editableByRoles: z.array(z.string().min(1).max(30)).max(20).optional(),
    section: z.string().trim().max(60).optional(),
    displayOrder: z.number().int().min(0).max(1000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  if (!["owner", "admin"].includes(ctx.role)) {
    return NextResponse.json({ error: "You cannot edit custom fields" }, { status: 403 });
  }

  const limit = checkRateLimit(`fields-edit:${ctx.userId}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const definition = await new NeonCustomFieldsRepository(ctx).updateDefinition(
      id,
      parsed.data,
      ctx.userId
    );
    return NextResponse.json(definition);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Field not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Field definition update failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
