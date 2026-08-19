// ═══════════════════════════════════════════════════════════════
// GET /api/tax/form16 — the annual TDS certificate, Part B
// ═══════════════════════════════════════════════════════════════
//
// Assembled from the payroll records of the financial year and the employee's
// own declaration. Nothing is estimated: if a month was not run, it is not in
// the certificate, and the certificate says so rather than annualising what it
// found.
//
// Only approved and paid payroll counts. A draft run is a proposal — including
// it would issue a certificate for money that was never paid and tax that was
// never deposited, which is a false statement to the department made on the
// employee's behalf.
//
// Part A is not produced here. It comes from TRACES once the quarterly returns
// are filed, and an employer generating its own is issuing a document the
// department has never seen. The Form 24Q quarters this returns are the
// figures that go *into* those returns.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  employees,
  itDeclarationItems,
  itDeclarations,
  payrollRecords,
  payrollRuns,
} from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import {
  buildForm16PartB,
  quarterly24Q,
  reconcile,
  type PayrollMonth,
} from "@/lib/form16";
import type { DeclarationItem, Regime } from "@/lib/income-tax-declaration";

const CAN_VIEW_OTHERS = ["owner", "admin", "hr", "finance"];

/** Payroll states that represent money actually paid. */
const ISSUED_STATES = ["approved", "paid"] as const;

const querySchema = z.object({
  employeeId: z.string().uuid().optional(),
  financialYear: z.coerce.number().int().min(2000).max(2100).optional(),
});

function currentFinancialYear(now = new Date()): number {
  return now.getUTCMonth() + 1 >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

/** The twelve (month, year) pairs an Indian financial year covers. */
function monthsOfFinancialYear(fy: number): { month: number; year: number }[] {
  const out: { month: number; year: number }[] = [];
  for (let m = 4; m <= 12; m++) out.push({ month: m, year: fy });
  for (let m = 1; m <= 3; m++) out.push({ month: m, year: fy + 1 });
  return out;
}

const asMinor = (v: bigint | null | undefined): bigint => v ?? 0n;

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
  const window = monthsOfFinancialYear(financialYear);

  try {
    const data = await withTenant(ctx, async (tx) => {
      const [employee] = await tx
        .select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          employeeCode: employees.employeeCode,
          workEmail: employees.workEmail,
          joinDate: employees.joinDate,
        })
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);

      if (!employee) return null;

      const runs = await tx
        .select({
          id: payrollRuns.id,
          month: payrollRuns.periodMonth,
          year: payrollRuns.periodYear,
          status: payrollRuns.status,
        })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.orgId, ctx.orgId),
            inArray(payrollRuns.periodYear, [financialYear, financialYear + 1])
          )
        );

      const inYear = runs.filter(
        (r) =>
          window.some((w) => w.month === r.month && w.year === r.year) &&
          (ISSUED_STATES as readonly string[]).includes(r.status)
      );

      if (inYear.length === 0) return { employee, months: [] as PayrollMonth[], declaration: null, items: [] };

      const records = await tx
        .select()
        .from(payrollRecords)
        .where(
          and(
            eq(payrollRecords.employeeId, employeeId),
            inArray(
              payrollRecords.runId,
              inYear.map((r) => r.id)
            )
          )
        );

      const [declaration] = await tx
        .select()
        .from(itDeclarations)
        .where(
          and(
            eq(itDeclarations.employeeId, employeeId),
            eq(itDeclarations.financialYear, financialYear)
          )
        )
        .limit(1);

      const items = declaration
        ? await tx
            .select()
            .from(itDeclarationItems)
            .where(eq(itDeclarationItems.declarationId, declaration.id))
        : [];

      const byRun = new Map(inYear.map((r) => [r.id, r]));
      const months: PayrollMonth[] = records
        .map((rec) => {
          const run = byRun.get(rec.runId)!;
          return {
            month: run.month,
            year: run.year,
            basicMinor: asMinor(rec.basicMinor),
            hraMinor: asMinor(rec.hraMinor),
            conveyanceMinor: asMinor(rec.conveyanceMinor),
            medicalMinor: asMinor(rec.medicalMinor),
            ltaMinor: asMinor(rec.ltaMinor),
            specialAllowanceMinor: asMinor(rec.specialAllowanceMinor),
            otherEarningsMinor: asMinor(rec.otherEarningsMinor),
            overtimeMinor: asMinor(rec.overtimeMinor),
            bonusMinor: asMinor(rec.bonusMinor),
            arrearsMinor: asMinor(rec.arrearsMinor),
            grossMinor: asMinor(rec.grossMinor),
            professionalTaxMinor: asMinor(rec.professionalTaxMinor),
            incomeTaxMinor: asMinor(rec.incomeTaxMinor),
          };
        })
        .sort((a, b) => a.year - b.year || a.month - b.month);

      return { employee, months, declaration, items };
    });

    if (!data) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const declarations: DeclarationItem[] = data.items.map((i) => ({
      section: i.section,
      declaredMinor: i.declaredMinor,
      proofStatus: i.proofStatus as DeclarationItem["proofStatus"],
    }));

    const form = buildForm16PartB({
      financialYear,
      regime: (data.declaration?.regime as Regime) ?? "new",
      months: data.months,
      declarations,
      proofWindowClosed:
        !!data.declaration?.proofWindowClosedAt &&
        data.declaration.proofWindowClosedAt.getTime() <= Date.now(),
      selfOrFamilyIsSenior: data.declaration?.selfOrFamilyIsSenior,
      parentsAreSenior: data.declaration?.parentsAreSenior,
      rentPaidMinor: data.declaration?.rentPaidMinor,
      metroCity: data.declaration?.metroCity,
    });

    const check = reconcile(form);
    const quarters = quarterly24Q(data.months);

    // Said plainly rather than left for the reader to infer from a short list:
    // a certificate covering four months is correct for somebody who joined in
    // December and wrong for somebody whose payroll was never approved.
    const monthsCovered = data.months.length;

    return NextResponse.json({
      employee: {
        id: data.employee.id,
        name: `${data.employee.firstName} ${data.employee.lastName}`.trim(),
        employeeCode: data.employee.employeeCode,
        workEmail: data.employee.workEmail,
      },
      financialYear,
      assessmentYear: form.assessmentYear,
      monthsCovered,
      complete: monthsCovered === 12,
      partB: stringifyMinors({ ...form }),
      reconciliation: {
        ...check,
        netTaxPayableMinor: check.netTaxPayableMinor.toString(),
        taxDeductedMinor: check.taxDeductedMinor.toString(),
        differenceMinor: check.differenceMinor.toString(),
      },
      form24Q: quarters.map((q) => ({
        quarter: q.quarter,
        months: q.months,
        amountPaidMinor: q.amountPaidMinor.toString(),
        taxDeductedMinor: q.taxDeductedMinor.toString(),
      })),
      partA: {
        available: false,
        note:
          "Part A is issued by TRACES once the quarterly Form 24Q returns are " +
          "filed. The quarterly figures above are what those returns are built " +
          "from.",
      },
    });
  } catch (error) {
    console.error("Form 16 assembly failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** JSON has no bigint, and a rupee figure in paise leaves its safe range. */
function stringifyMinors<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === "bigint") out[key] = v.toString();
    else if (Array.isArray(v)) out[key] = v.map((x) => (typeof x === "object" && x !== null ? stringifyMinors(x as Record<string, unknown>) : x));
    else out[key] = v;
  }
  return out;
}
