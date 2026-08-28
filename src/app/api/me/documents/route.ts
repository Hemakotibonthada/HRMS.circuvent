// ═══════════════════════════════════════════════════════════════
// HRMS API — the letters and pay changes that belong to me
// ═══════════════════════════════════════════════════════════════
// Everything an employee is entitled to see about their own compensation, in
// one place: the letters issued to them, and the salary changes those letters
// record.
//
// ── Why this exists next to /api/documents rather than inside it ──
// `GET /api/documents` is staff-only and deliberately so: it lists the whole
// tenant's documents, each carrying somebody's salary. The rule an employee
// needs is the opposite shape — every document *for this person*, and nothing
// else — so it is a different query with a different guard, not a parameter on
// that one. Bolting a `?mine=true` onto a staff endpoint is how a missing
// check ends up returning everybody's offer letters.
//
// ── Drafts are not shown ──
// A document is only somebody's once it has been issued to them. A draft is HR
// still working: it may name a figure that is never agreed, and showing an
// employee a revision that is later changed would be worse than showing them
// nothing.

import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";

import { withTenant } from "@/db/client";
import { generatedDocuments } from "@/db/schema";
import { salaryHistory } from "@/db/schema/compensation";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";
import { EMPLOYEE_VISIBLE_DOCUMENT_STATUSES } from "@/lib/document-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Statuses that mean "this document has been issued and still stands".
 *
 * Defined once in `document-visibility.ts` and shared with the PDF download,
 * so a document cannot be listed here and then refused there. Getting this
 * list wrong is a real fault in either direction, and both are easy: writing
 * "signed" (which is not a status in the enum) silently matches nothing, and
 * omitting `viewed` or `partially_signed` hides a letter that was genuinely
 * issued from the person it was issued to.
 */
const ISSUED_STATUSES = EMPLOYEE_VISIBLE_DOCUMENT_STATUSES;

export interface MyDocument {
  id: string;
  title: string;
  category: string;
  status: string;
  issuedAt: string | null;
  /** True when the PDF has been archived and can be downloaded. */
  downloadable: boolean;
}

export interface MyPayChange {
  id: string;
  effectiveOn: string;
  previousAnnual: string | null;
  newAnnual: string;
  changePercent: string | null;
  currency: string;
  reason: string;
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    // Any signed-in role. A manager or an administrator asking for *their own*
    // documents is asking the same question an employee is, and the answer is
    // scoped to them either way.
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(clientIdentifier(request, ctx.userId), 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  try {
    const result = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const employeeId = await currentEmployeeId({ orgId: ctx.orgId, userId: ctx.userId }, tx);

      // Not an error. An administrator who was never onboarded as an employee
      // has no letters, and saying so plainly beats a 404 that reads like a
      // fault.
      if (!employeeId) {
        return {
          employeeId: null,
          documents: [] as MyDocument[],
          payChanges: [] as MyPayChange[],
        };
      }

      const docs = await tx
        .select({
          id: generatedDocuments.id,
          title: generatedDocuments.title,
          category: generatedDocuments.category,
          status: generatedDocuments.status,
          sentAt: generatedDocuments.sentAt,
          completedAt: generatedDocuments.completedAt,
          createdAt: generatedDocuments.createdAt,
          blobUrl: generatedDocuments.blobUrl,
        })
        .from(generatedDocuments)
        .where(
          and(
            eq(generatedDocuments.orgId, ctx.orgId),
            eq(generatedDocuments.employeeId, employeeId),
            inArray(generatedDocuments.status, [...ISSUED_STATUSES])
          )
        )
        .orderBy(desc(generatedDocuments.createdAt))
        .limit(200);

      const changes = await tx
        .select({
          id: salaryHistory.id,
          effectiveOn: salaryHistory.effectiveOn,
          previousSalaryMinor: salaryHistory.previousSalaryMinor,
          newSalaryMinor: salaryHistory.newSalaryMinor,
          changePercent: salaryHistory.changePercent,
          currency: salaryHistory.currency,
          reason: salaryHistory.reason,
        })
        .from(salaryHistory)
        .where(
          and(
            eq(salaryHistory.orgId, ctx.orgId),
            eq(salaryHistory.employeeId, employeeId)
          )
        )
        .orderBy(desc(salaryHistory.effectiveOn))
        .limit(100);

      return {
        employeeId,
        documents: docs.map((doc) => ({
          id: doc.id,
          title: doc.title,
          category: doc.category,
          status: String(doc.status),
          issuedAt: (doc.completedAt ?? doc.sentAt ?? doc.createdAt)?.toISOString() ?? null,
          // Reported rather than assumed: the PDF is archived by an outbox
          // that may not have run yet, and a download button that 404s is
          // worse than one that is not offered.
          downloadable: Boolean(doc.blobUrl),
        })),
        payChanges: changes.map((change) => ({
          id: change.id,
          effectiveOn: String(change.effectiveOn),
          // Sent as strings: these are bigints in minor units, and JSON turns
          // a JavaScript number of paise into an approximation somewhere past
          // ninety lakh.
          previousAnnual:
            change.previousSalaryMinor === null ? null : String(change.previousSalaryMinor),
          newAnnual: String(change.newSalaryMinor),
          changePercent: change.changePercent === null ? null : String(change.changePercent),
          currency: change.currency,
          reason: change.reason,
        })),
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("My documents lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
