// ═══════════════════════════════════════════════════════════════
// HRMS API — Interns
// ═══════════════════════════════════════════════════════════════
// The roster behind the interns page: everyone on the `intern` employment
// type, each with the documents already issued to them attached.
//
// The document lookup is still one call per intern under the hood.
// `src/db/repositories/documents.neon.ts` has `list()` (every document,
// unbounded, built for the letters screen) and `listFor(employeeId)` (one
// employee's) — there is no "these specific employees" method, and adding one
// would mean editing a repository this feature does not own. `Promise.all`
// over `listFor` keeps those calls concurrent rather than serial, which is
// the difference that matters at the roster sizes an internship programme
// actually has.
//
// Sorted by `internshipEndDate` ascending so the page's own ordering answers
// the question it exists to answer — who is leaving soonest — without the
// client re-sorting a list the server already had in the right order.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";
import { NeonDocumentsRepository, type DocumentRecord } from "@/db/repositories/documents.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";

const listQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});

/**
 * Trims a `DocumentRecord` to what the roster needs.
 *
 * `renderedBody` is the full rendered letter (HTML/text, potentially several
 * KB per document) and `contentHash`/`employeeId`/`candidateId` are internal
 * bookkeeping the page has no use for — sending them anyway would multiply
 * payload size by roster length for no reader of this response. `blobUrl` is
 * kept: it is not a fetchable URL (see the field comment on `DocumentRecord`),
 * but the page still needs to know whether it is set, to decide whether a
 * "Download PDF" action has anything to download.
 */
function toRosterDocument(doc: DocumentRecord) {
  return {
    id: doc.id,
    title: doc.title,
    category: doc.category,
    status: doc.status,
    sentAt: doc.sentAt,
    completedAt: doc.completedAt,
    expiresAt: doc.expiresAt,
    blobUrl: doc.blobUrl,
    signedCount: doc.signatures.filter((s) => s.signedAt).length,
    totalSignatories: doc.signatures.length,
  };
}

function fail(error: unknown) {
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Interns API failure:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

// GET /api/interns
export async function GET(request: NextRequest) {
  let ctx;
  try {
    // Matches `interns.view` in rbac.ts: managers see their reports through
    // the general employee directory, not this roster, because conversion and
    // the reminder trail are HR/admin business.
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(clientIdentifier(request, ctx.userId), 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "retry-after": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const parsed = listQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }

  try {
    const page = await new NeonEmployeeRepository(ctx).list({
      ...parsed.data,
      filters: { employmentType: "intern" },
      sortBy: "internshipEndDate",
      sortDirection: "asc",
    });

    const documentsRepo = new NeonDocumentsRepository(ctx);
    const items = await Promise.all(
      page.items.map(async (employee) => ({
        id: employee.id,
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        email: employee.email,
        designation: employee.designation,
        departmentName: employee.departmentName,
        reportingToName: employee.reportingToName,
        status: employee.status,
        joinDate: employee.joinDate,
        internshipEndDate: employee.internshipEndDate,
        exitDate: employee.exitDate,
        previousEmployeeCode: employee.previousEmployeeCode,
        codeChangedAt: employee.codeChangedAt,
        documents: (await documentsRepo.listFor(employee.id)).map(toRosterDocument),
      }))
    );

    return NextResponse.json({ ...page, items });
  } catch (error) {
    return fail(error);
  }
}
