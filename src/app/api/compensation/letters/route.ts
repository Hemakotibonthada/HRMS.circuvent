// ═══════════════════════════════════════════════════════════════
// HRMS API — issue the letters for a pay change
// ═══════════════════════════════════════════════════════════════
// A compensation cycle writes `hrms.salary_history` when it is applied, and
// that is the record. It is not the letter: the employee has nothing to show
// a bank, and nothing in the portal to read.
//
// This turns those rows into documents. HR applies the cycle, then issues the
// letters, and each employee sees theirs under "My documents".
//
// ── Why this is a separate step and not part of applying the cycle ──
// Applying a cycle updates salaries inside one transaction, and it must
// succeed or fail whole. Rendering a document per employee reads the template,
// resolves company identity, writes a row and queues a PDF — work that can
// fail for reasons having nothing to do with payroll (a retired template, R2
// unreachable). Folding it into that transaction would let a template problem
// roll back everybody's raise.
//
// So issuing is separate, idempotent, and reports per employee. Running it
// twice does not issue two letters for the same change.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";

import { withTenant } from "@/db/client";
import { documentTemplates, generatedDocuments } from "@/db/schema";
import { salaryHistory } from "@/db/schema/compensation";
import { NeonDocumentsRepository } from "@/db/repositories/documents.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import {
  compensationLetterTitle,
  compensationLetterTokens,
  type PayChange,
} from "@/lib/compensation-letter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `document_templates` rows carry no `template_type` column, so the catalog's
 * key cannot be used to find one — templates are matched by name, the same way
 * `document-templates/validation.ts` does it.
 */
const COMPENSATION_TEMPLATE_NAME = "Compensation Revision Letter";

const bodySchema = z.object({
  /** Issue for every pay change in this cycle. */
  cycleId: z.string().uuid().optional(),
  /** Or for one specific change. */
  salaryHistoryId: z.string().uuid().optional(),
});

export interface IssueOutcome {
  employeeId: string;
  salaryHistoryId: string;
  status: "issued" | "already-issued" | "failed";
  documentId?: string;
  detail?: string;
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(clientIdentifier(request, ctx.userId), 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  let parsed;
  try {
    parsed = bodySchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!parsed.success || (!parsed.data.cycleId && !parsed.data.salaryHistoryId)) {
    return NextResponse.json(
      { error: "Name either a compensation cycle or a single salary change to issue letters for." },
      { status: 400 }
    );
  }

  const { cycleId, salaryHistoryId } = parsed.data;

  try {
    const { template, changes } = await withTenant(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        const [templateRow] = await tx
          .select({ id: documentTemplates.id, isActive: documentTemplates.isActive })
          .from(documentTemplates)
          .where(
            and(
              eq(documentTemplates.orgId, ctx.orgId),
              eq(documentTemplates.name, COMPENSATION_TEMPLATE_NAME)
            )
          )
          .orderBy(desc(documentTemplates.version))
          .limit(1);

        const rows = await tx
          .select({
            id: salaryHistory.id,
            employeeId: salaryHistory.employeeId,
            previousSalaryMinor: salaryHistory.previousSalaryMinor,
            newSalaryMinor: salaryHistory.newSalaryMinor,
            changePercent: salaryHistory.changePercent,
            currency: salaryHistory.currency,
            reason: salaryHistory.reason,
            effectiveOn: salaryHistory.effectiveOn,
          })
          .from(salaryHistory)
          .where(
            and(
              eq(salaryHistory.orgId, ctx.orgId),
              salaryHistoryId
                ? eq(salaryHistory.id, salaryHistoryId)
                : eq(salaryHistory.cycleId, cycleId!)
            )
          )
          .limit(500);

        return { template: templateRow, changes: rows };
      }
    );

    if (!template) {
      // Named specifically. "Template not found" against a catalog that ships
      // one sends whoever reads it looking in the wrong place; the real cause
      // is almost always that this tenant's templates were seeded before the
      // compensation letter was added to the catalog.
      return NextResponse.json(
        {
          error:
            `No "${COMPENSATION_TEMPLATE_NAME}" template exists for this organisation. ` +
            "Re-seed the document templates so the compensation letter is available, then try again.",
        },
        { status: 409 }
      );
    }
    if (!template.isActive) {
      return NextResponse.json(
        { error: `The "${COMPENSATION_TEMPLATE_NAME}" template has been retired.` },
        { status: 409 }
      );
    }
    if (changes.length === 0) {
      return NextResponse.json(
        { error: "There are no recorded pay changes to issue letters for." },
        { status: 404 }
      );
    }

    const repository = new NeonDocumentsRepository(ctx);
    const results: IssueOutcome[] = [];

    for (const row of changes) {
      const change: PayChange = {
        previousSalaryMinor: row.previousSalaryMinor,
        newSalaryMinor: row.newSalaryMinor,
        changePercent: row.changePercent,
        currency: row.currency,
        reason: row.reason,
        effectiveOn: row.effectiveOn,
      };
      const title = compensationLetterTitle(change);

      // Idempotent by title-and-employee. There is no column linking a
      // document back to the salary_history row it came from, and the title
      // carries the effective date — so two revisions produce two titles and
      // one revision issued twice produces one letter.
      const existing = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
        const [found] = await tx
          .select({ id: generatedDocuments.id })
          .from(generatedDocuments)
          .where(
            and(
              eq(generatedDocuments.orgId, ctx.orgId),
              eq(generatedDocuments.employeeId, row.employeeId),
              eq(generatedDocuments.title, title)
            )
          )
          .limit(1);
        return found;
      });

      if (existing) {
        results.push({
          employeeId: row.employeeId,
          salaryHistoryId: row.id,
          status: "already-issued",
          documentId: existing.id,
        });
        continue;
      }

      try {
        const document = await repository.generate(
          {
            templateId: template.id,
            employeeId: row.employeeId,
            title,
            extraValues: compensationLetterTokens(change),
          },
          ctx.userId
        );
        results.push({
          employeeId: row.employeeId,
          salaryHistoryId: row.id,
          status: "issued",
          documentId: document.id,
        });
      } catch (error) {
        // One employee's failure must not cost the rest their letters. A
        // missing field on one record is a fact somebody can fix; a run that
        // stops at the first one leaves everybody else without a letter and
        // reports only the employee who broke it.
        results.push({
          employeeId: row.employeeId,
          salaryHistoryId: row.id,
          status: "failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({
      issued: results.filter((r) => r.status === "issued").length,
      alreadyIssued: results.filter((r) => r.status === "already-issued").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Issuing compensation letters failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
