// ═══════════════════════════════════════════════════════════════
// /api/tax/declaration — an employee's Chapter VI-A claims for a year
// ═══════════════════════════════════════════════════════════════
//
// GET  returns the declaration for a financial year, creating an empty one on
//      first visit so the screen has something to bind to.
// PUT  replaces the claimed sections and the regime.
//
// Payroll reads the same rows, which is the point: the tax screen used to hold
// this in browser state, so a declaration was lost on reload and TDS was
// computed as though the employee had declared nothing at all.
//
// An employee reads and writes only their own. Finance may read anyone's,
// because somebody has to verify the proofs — but a declaration lists what a
// person owns, insures, borrows and donates to, so "anyone" is a short list.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { itDeclarationItems, itDeclarations } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import {
  DEDUCTION_SECTIONS,
  allowedDeductions,
  sectionFor,
  validateDeclaration,
  type DeclarationItem,
  type Regime,
} from "@/lib/income-tax-declaration";

class LockedError extends Error {}

/** Roles that may look at somebody else's declaration. */
const CAN_VIEW_OTHERS = ["owner", "admin", "hr", "finance"];

/**
 * The Indian financial year begins in April, so January to March belongs to
 * the year before. Getting this wrong points an employee at a blank form in
 * February and loses the declaration they filed in May.
 */
function currentFinancialYear(now = new Date()): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() + 1 >= 4 ? year : year - 1;
}

const querySchema = z.object({
  employeeId: z.string().uuid().optional(),
  financialYear: z.coerce.number().int().min(2000).max(2100).optional(),
});

const putSchema = z.object({
  financialYear: z.coerce.number().int().min(2000).max(2100).optional(),
  regime: z.enum(["old", "new"]),
  selfOrFamilyIsSenior: z.boolean().optional(),
  parentsAreSenior: z.boolean().optional(),
  // Sent as strings: a rupee figure in paise leaves JSON's safe integer range
  // at crore scale, and payroll is not a place to discover that.
  rentPaidMinor: z.coerce.bigint().nonnegative().optional(),
  metroCity: z.boolean().optional(),
  landlordPan: z.string().trim().max(10).optional().nullable(),
  items: z
    .array(
      z.object({
        section: z.string().trim().min(2).max(16),
        declaredMinor: z.coerce.bigint().nonnegative(),
      })
    )
    .max(64),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const privileged = CAN_VIEW_OTHERS.includes(ctx.role);
  const employeeId = privileged ? parsed.data.employeeId ?? ctx.userId : ctx.userId;
  const financialYear = parsed.data.financialYear ?? currentFinancialYear();

  try {
    const payload = await withTenant(ctx, async (tx) => {
      let [declaration] = await tx
        .select()
        .from(itDeclarations)
        .where(
          and(
            eq(itDeclarations.employeeId, employeeId),
            eq(itDeclarations.financialYear, financialYear)
          )
        )
        .limit(1);

      if (!declaration) {
        // Created rather than 404'd. A first-time visitor has not "missed" a
        // declaration; they simply have not made one, and an empty form is the
        // correct answer to that.
        [declaration] = await tx
          .insert(itDeclarations)
          .values({ orgId: ctx.orgId, employeeId, financialYear })
          .returning();
      }

      const items = await tx
        .select()
        .from(itDeclarationItems)
        .where(eq(itDeclarationItems.declarationId, declaration.id));

      return { declaration, items };
    });

    const items: DeclarationItem[] = payload.items.map((i) => ({
      section: i.section,
      declaredMinor: i.declaredMinor,
      proofStatus: i.proofStatus as DeclarationItem["proofStatus"],
    }));

    const summary = allowedDeductions(items, {
      regime: payload.declaration.regime as Regime,
      proofWindowClosed:
        !!payload.declaration.proofWindowClosedAt &&
        payload.declaration.proofWindowClosedAt.getTime() <= Date.now(),
      selfOrFamilyIsSenior: payload.declaration.selfOrFamilyIsSenior,
      parentsAreSenior: payload.declaration.parentsAreSenior,
    });

    return NextResponse.json({
      declaration: {
        ...payload.declaration,
        rentPaidMinor: payload.declaration.rentPaidMinor.toString(),
      },
      items: payload.items.map((i) => ({
        ...i,
        declaredMinor: i.declaredMinor.toString(),
        verifiedMinor: i.verifiedMinor?.toString() ?? null,
      })),
      summary: {
        totalAllowedMinor: summary.totalAllowedMinor.toString(),
        standardDeductionMinor: summary.standardDeductionMinor.toString(),
        totalReliefMinor: summary.totalReliefMinor.toString(),
        items: summary.items.map((i) => ({
          section: i.section,
          reason: i.reason ?? null,
          declaredMinor: i.declaredMinor.toString(),
          allowedMinor: i.allowedMinor.toString(),
        })),
      },
      sections: DEDUCTION_SECTIONS.map((s) => ({
        code: s.code,
        label: s.label,
        note: s.note,
        capMinor: s.capMinor?.toString() ?? null,
        sharedCapGroup: s.sharedCapGroup ?? null,
        allowedInNewRegime: s.allowedInNewRegime,
        requiresProof: s.requiresProof,
      })),
    });
  } catch (error) {
    console.error("IT declaration read failed:", error);
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

  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid declaration", detail: (error as z.ZodError).issues?.[0]?.message },
      { status: 400 }
    );
  }

  // Writing somebody else's declaration is not a privilege anyone holds here.
  // Finance verifies proofs, which is a different act from claiming a
  // deduction on a colleague's behalf.
  const employeeId = ctx.userId;
  const financialYear = body.financialYear ?? currentFinancialYear();

  const unknown = body.items.map((i) => i.section).filter((s) => !sectionFor(s));
  if (unknown.length > 0) {
    return NextResponse.json({ error: `Unknown section: ${unknown.join(", ")}` }, { status: 400 });
  }

  const problems = validateDeclaration(
    body.items.map((i) => ({ section: i.section, declaredMinor: i.declaredMinor })),
    {
      regime: body.regime,
      selfOrFamilyIsSenior: body.selfOrFamilyIsSenior,
      parentsAreSenior: body.parentsAreSenior,
    }
  );

  // The new-regime notice is advice, not an error. An employee may declare
  // investments and still choose the new regime — refusing the save would
  // simply lose what they typed.
  const blocking = problems.filter(
    (p) => !/does not reduce tax under the new regime/.test(p.message)
  );
  if (blocking.length > 0) {
    return NextResponse.json(
      { error: "Declaration is not valid", problems: blocking },
      { status: 422 }
    );
  }

  try {
    await withTenant(ctx, async (tx) => {
      let [declaration] = await tx
        .select()
        .from(itDeclarations)
        .where(
          and(
            eq(itDeclarations.employeeId, employeeId),
            eq(itDeclarations.financialYear, financialYear)
          )
        )
        .limit(1);

      if (!declaration) {
        [declaration] = await tx
          .insert(itDeclarations)
          .values({ orgId: ctx.orgId, employeeId, financialYear })
          .returning();
      }

      if (declaration.status === "locked") throw new LockedError();

      await tx
        .update(itDeclarations)
        .set({
          regime: body.regime,
          selfOrFamilyIsSenior: body.selfOrFamilyIsSenior ?? false,
          parentsAreSenior: body.parentsAreSenior ?? false,
          rentPaidMinor: body.rentPaidMinor ?? 0n,
          metroCity: body.metroCity ?? false,
          landlordPan: body.landlordPan ?? null,
          status: "submitted",
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(itDeclarations.id, declaration.id));

      // Replaced rather than merged. A section the employee removed has to
      // disappear; a merge leaves it claimed for ever.
      await tx
        .delete(itDeclarationItems)
        .where(eq(itDeclarationItems.declarationId, declaration.id));

      const rows = body.items.filter((i) => i.declaredMinor > 0n);
      if (rows.length > 0) {
        await tx.insert(itDeclarationItems).values(
          rows.map((i) => ({
            orgId: ctx.orgId,
            declarationId: declaration.id,
            section: i.section,
            declaredMinor: i.declaredMinor,
            proofStatus: sectionFor(i.section)?.requiresProof ? "awaiting" : "not_required",
          }))
        );
      }
    });

    return NextResponse.json({ saved: true, financialYear, warnings: problems });
  } catch (error) {
    if (error instanceof LockedError) {
      return NextResponse.json(
        { error: "This declaration is locked for the year and can no longer be changed." },
        { status: 409 }
      );
    }
    console.error("IT declaration write failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
