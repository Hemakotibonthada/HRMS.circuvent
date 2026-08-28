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
    templateId: z.string().uuid().optional(),
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

/**
 * Turns a token list into something the person reading it can act on.
 *
 * The repository reports unresolved tokens by name, which is right for a
 * developer and useless to the HR administrator who sees it: "2 tokens could
 * not be resolved: company_contact, company_registration" does not tell anyone
 * that their organisation has no registered number on file. The tokens that
 * describe the tenant rather than the document are the ones worth translating,
 * because they are fixed once in settings rather than per letter.
 */
function explain(message: string): string {
  const identity: Record<string, string> = {
    company_name: "your organisation's name",
    company_address: "your registered address",
    company_contact: "a contact address for your organisation",
    company_registration: "your company registration number (CIN or equivalent)",
  };

  const named = Object.keys(identity).filter((token) => message.includes(token));
  if (named.length === 0) return message;

  const wanted = named.map((t) => identity[t]);
  const list =
    wanted.length === 1
      ? wanted[0]
      : `${wanted.slice(0, -1).join(", ")} and ${wanted[wanted.length - 1]}`;

  // The remaining tokens still matter, so they are kept rather than replaced.
  const others = message
    .replace(/^\d+ tokens? could not be resolved: /, "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => !named.includes(t));

  const tail = others.length > 0 ? ` Also missing: ${others.join(", ")}.` : "";

  return (
    `This letter cannot be issued until your organisation has ${list}. ` +
    `Set it in Settings → Organisation, then try again.${tail}`
  );
}

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
    const docRepo = new NeonDocumentsRepository(ctx);
    let templateId = parsed.data.templateId;
    if (!templateId) {
      const templates = await docRepo.listTemplates();
      const template =
        templates.find((t) => t.name === "Appointment Letter") ||
        templates.find((t) => t.name === "Joining Letter") ||
        templates[0];
      if (!template) {
        return NextResponse.json({ error: "No document template available" }, { status: 400 });
      }
      templateId = template.id;
    }

    const document = await docRepo.generate(
      { ...parsed.data, templateId },
      ctx.userId
    );
    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: explain(error.message) }, { status: error.status });
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
