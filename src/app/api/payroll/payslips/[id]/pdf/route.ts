// GET /api/payroll/payslips/[id]/pdf — download an archived payslip PDF from R2.

import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { withTenant } from "@/db/client";
import { payrollRecords, payrollRuns } from "@/db/schema";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";
import { getObjectBytes, StorageConfigError, StorageRequestError } from "@/lib/storage/object-store";

export async function GET(
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

  const { id } = await params;
  const privileged = ["owner", "admin", "hr"].includes(ctx.role);

  try {
    const bytes = await withTenant(ctx, async (tx) => {
      const self = await currentEmployeeId(ctx, tx);
      const [row] = await tx
        .select({
          employeeId: payrollRecords.employeeId,
          payslipUrl: payrollRecords.payslipUrl,
          periodMonth: payrollRuns.periodMonth,
          periodYear: payrollRuns.periodYear,
        })
        .from(payrollRecords)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRecords.runId))
        .where(
          and(
            eq(payrollRecords.orgId, ctx.orgId),
            eq(payrollRecords.id, id),
            inArray(payrollRuns.status, ["approved", "paid"])
          )
        )
        .limit(1);

      if (!row) return null;
      if (!privileged && row.employeeId !== self) return null;
      if (!row.payslipUrl) return null;

      return {
        key: row.payslipUrl,
        filename: `payslip-${row.periodYear}-${String(row.periodMonth).padStart(2, "0")}.pdf`,
      };
    });

    if (!bytes) {
      return NextResponse.json({ error: "Payslip not found or not yet archived" }, { status: 404 });
    }

    const pdf = await getObjectBytes(bytes.key);
    return new NextResponse(pdf.slice(), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${bytes.filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof StorageConfigError || error instanceof StorageRequestError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("Payslip download failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
