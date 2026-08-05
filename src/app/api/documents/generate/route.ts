// POST /api/documents/generate — render a document from a template.
//
// A 422 lists exactly which tokens could not be resolved. Generating with a
// blank where the salary should be produces a document that will be signed
// before anyone notices.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonDocumentsRepository } from "@/db/repositories/documents.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

const bodySchema = z
  .object({
    templateId: z.string().uuid(),
    employeeId: z.string().uuid().optional(),
    candidateId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    extraValues: z.record(z.string(), z.union([z.string().max(5000), z.number()])).optional(),
    recipients: z
      .record(
        z.string().min(1).max(40),
        z.object({ email: z.string().email(), name: z.string().trim().max(120).optional() })
      )
      .optional(),
    // A signing link that never expires is a credential with no end date.
    expiresInDays: z.number().int().min(1).max(365).optional(),
  })
  .refine((v) => v.employeeId || v.candidateId, {
    message: "A document must be for an employee or a candidate",
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
    return NextResponse.json({ error: "You cannot generate documents" }, { status: 403 });
  }

  const limit = checkRateLimit(`doc-generate:${ctx.userId}`, 60, 60_000);
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
    const document = await new NeonDocumentsRepository(ctx).generate(parsed.data, ctx.userId);
    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // buildSlots throws a plain Error when a signatory has no recipient, which
    // is a caller mistake rather than a server fault.
    if (error instanceof Error && error.message.includes("No recipient given")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Document generation failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
