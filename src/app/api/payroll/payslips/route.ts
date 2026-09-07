// GET /api/payroll/payslips — an employee's own payslip history.
//
// The repository restricts this to approved and paid runs. A draft or
// processed run is still being corrected, and showing an employee a figure
// that later changes is worse than showing nothing.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { employees } from "@/db/schema/hrms";
import { NeonPayrollRepository } from "@/db/repositories/payroll.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId, resolveScopedEmployeeId } from "@/lib/current-employee";
import { fetchPaystubPayslips } from "@/lib/paystub-client";

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const requested = new URL(request.url).searchParams.get("employeeId") ?? undefined;

  // Salary is the most sensitive field in the product. Managers are excluded
  // deliberately: a reporting line is not authority to see someone's pay.
  const privileged = ["owner", "admin", "hr"].includes(ctx.role);

  try {
    // ctx.userId is the signing-in account, not the employment record a
    // payslip is keyed by — see lib/current-employee.ts.
    const self = await currentEmployeeId(ctx);

    if (requested && requested !== self && !privileged) {
      return NextResponse.json(
        { error: "You can only view your own payslips" },
        { status: 403 }
      );
    }

    const employeeId = resolveScopedEmployeeId(ctx, self, requested, privileged);

    if (!employeeId) {
      return NextResponse.json({ employeeId: null, payslips: [] });
    }

    if (!z.string().uuid().safeParse(employeeId).success) {
      return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
    }

    let payslips = await new NeonPayrollRepository(ctx).payslipsFor(employeeId);

    if (payslips.length === 0) {
      const [emp] = await withTenant(ctx, async (tx) =>
        tx
          .select({
            workEmail: employees.workEmail,
            employeeCode: employees.employeeCode,
          })
          .from(employees)
          .where(eq(employees.id, employeeId))
          .limit(1)
      );

      const synced = await fetchPaystubPayslips(ctx.orgId, employeeId, {
        email: emp?.workEmail ?? undefined,
        employeeCode: emp?.employeeCode ?? undefined,
      });

      if (synced.length > 0) {
        payslips = synced.map((p) => ({
          id: p.id,
          runId: p.runId,
          employeeId,
          employeeName: p.employeeName,
          workingDays: p.workingDays,
          presentDays: p.presentDays,
          lopDays: p.lopDays,
          gross: p.gross,
          totalDeductions: p.totalDeductions,
          netPay: p.netPay,
          grossMinor: p.grossMinor,
          totalDeductionsMinor: p.totalDeductionsMinor,
          netPayMinor: p.netPayMinor,
          status: p.status,
          anomalies: p.anomalies ?? [],
          periodMonth: p.periodMonth,
          periodYear: p.periodYear,
          payslipUrl: p.payslipUrl,
        }));
      }
    }

    return NextResponse.json({ employeeId, payslips });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Payslip lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

