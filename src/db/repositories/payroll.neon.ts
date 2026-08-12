// ═══════════════════════════════════════════════════════════════
// PAYROLL REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Payroll is the one place in the product where a bug moves real money, so the
// lifecycle is deliberately rigid:
//
//   draft → processing → processed → approved → paid
//
// Each transition is guarded. In particular a run cannot be approved by the
// person who processed it (maker-checker), which is enforced here *and* by a
// CHECK constraint in drizzle/0001, so it cannot be bypassed by any code path
// that forgets to ask.
//
// Amounts are bigint minor units throughout. The float arithmetic the
// Firestore version used loses precision at scale — 0.1 + 0.2 is not 0.3 — and
// on a payroll of a few thousand people those errors accumulate into a
// reconciliation the finance team cannot close.

import { and, asc, count, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import {
  attendanceRecords,
  employees,
  payrollRecords,
  payrollRuns,
  salaryStructures,
} from "@/db/schema/hrms";
import { calculateProfessionalTax, calculateNewRegimeIncomeTax } from "@/lib/payroll-engine";
import {
  NotFoundError,
  RepositoryError,
  type ListQuery,
  type Page,
  type PayrollRecordDto,
  type PayrollRepository,
  type PayrollRunRecord,
} from "./types";

/** Statutory ceilings, in minor units (paise). */
const PF_EMPLOYEE_MONTHLY_CAP = 180_000n; // ₹1,800
const ESI_WAGE_CEILING_MONTHLY = 2_100_000n; // ₹21,000

function toMajor(minor: bigint | null): number {
  return minor === null ? 0 : Number(minor) / 100;
}

function toRunRecord(row: typeof payrollRuns.$inferSelect): PayrollRunRecord {
  return {
    id: row.id,
    periodMonth: row.periodMonth,
    periodYear: row.periodYear,
    runType: row.runType,
    status: row.status,
    employeeCount: row.employeeCount,
    totalGross: toMajor(row.totalGrossMinor),
    totalDeductions: toMajor(row.totalDeductionsMinor),
    totalNet: toMajor(row.totalNetMinor),
    processedById: row.processedById ?? undefined,
    processedAt: row.processedAt?.toISOString(),
    approvedById: row.approvedById ?? undefined,
    approvedAt: row.approvedAt?.toISOString(),
    paidAt: row.paidAt?.toISOString(),
    organizationId: row.orgId,
  };
}

type RecordRow = typeof payrollRecords.$inferSelect & { employeeName?: string | null };

function toPayrollRecord(row: RecordRow): PayrollRecordDto {
  return {
    id: row.id,
    runId: row.runId,
    employeeId: row.employeeId,
    employeeName: row.employeeName ?? undefined,
    workingDays: Number(row.workingDays),
    presentDays: Number(row.presentDays),
    lopDays: Number(row.lopDays),
    gross: toMajor(row.grossMinor),
    totalDeductions: toMajor(row.totalDeductionsMinor),
    netPay: toMajor(row.netPayMinor),
    status: row.status,
    anomalies: (row.anomalies as string[]) ?? [],
    payslipUrl: row.payslipUrl ?? undefined,
  };
}

/** Proportion of a monthly amount actually earned, given loss of pay. */
function prorate(monthlyMinor: bigint, presentDays: number, workingDays: number): bigint {
  // A zero-working-day month would divide by zero; the same defect that made
  // generatePayslip return NaN.
  if (workingDays <= 0) return 0n;
  if (presentDays >= workingDays) return monthlyMinor;
  return (monthlyMinor * BigInt(Math.round(presentDays * 100))) / BigInt(workingDays * 100);
}

export class NeonPayrollRepository implements PayrollRepository {
  constructor(private readonly ctx: TenantContext) {}

  async listRuns(q: ListQuery = {}): Promise<Page<PayrollRunRecord>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 24));

    return withTenant(this.ctx, async (tx) => {
      const status = q.filters?.status;
      const where =
        status && status !== "all" ? eq(payrollRuns.status, status as never) : undefined;

      const rows = await tx
        .select()
        .from(payrollRuns)
        .where(where)
        .orderBy(desc(payrollRuns.periodYear), desc(payrollRuns.periodMonth))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(payrollRuns)
        .where(where);

      return {
        items: rows.map(toRunRecord),
        total,
        page,
        pageSize,
        hasMore: (page - 1) * pageSize + rows.length < total,
      };
    });
  }

  async getRun(id: string): Promise<PayrollRunRecord | null> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, id)).limit(1);
      return rows[0] ? toRunRecord(rows[0]) : null;
    });
  }

  async createRun(
    periodMonth: number,
    periodYear: number,
    runType = "regular"
  ): Promise<PayrollRunRecord> {
    if (periodMonth < 1 || periodMonth > 12) {
      throw new RepositoryError("Month must be 1-12", 400);
    }

    return withTenant(this.ctx, async (tx) => {
      const existing = await tx
        .select({ id: payrollRuns.id, status: payrollRuns.status })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.periodMonth, periodMonth),
            eq(payrollRuns.periodYear, periodYear),
            eq(payrollRuns.runType, runType)
          )
        )
        .limit(1);

      // Silently returning the existing run would let someone believe they had
      // started a fresh calculation over corrected data.
      if (existing[0]) {
        throw new RepositoryError(
          `A ${runType} run for ${periodMonth}/${periodYear} already exists (${existing[0].status})`,
          409
        );
      }

      const [row] = await tx
        .insert(payrollRuns)
        .values({ orgId: this.ctx.orgId, periodMonth, periodYear, runType })
        .returning();

      return toRunRecord(row);
    });
  }

  /**
   * Computes a payslip for every active employee and marks the run processed.
   *
   * Runs as one transaction: a partially calculated payroll that looks complete
   * is worse than one that visibly failed.
   */
  async processRun(id: string, processedById: string): Promise<PayrollRunRecord> {
    return withTenant(this.ctx, async (tx) => {
      const locked = await tx
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.id, id))
        .for("update")
        .limit(1);

      const run = locked[0];
      if (!run) throw new NotFoundError("Payroll run", id);
      if (run.status !== "draft" && run.status !== "error") {
        throw new RepositoryError(
          `A run that is ${run.status} cannot be reprocessed`,
          409
        );
      }

      const periodStart = `${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}-01`;
      const periodEnd = new Date(Date.UTC(run.periodYear, run.periodMonth, 0))
        .toISOString()
        .slice(0, 10);
      const workingDays = new Date(Date.UTC(run.periodYear, run.periodMonth, 0)).getUTCDate();

      // The structure in force on the last day of the period, so a mid-month
      // revision does not retroactively change the whole month.
      const staff = await tx
        .select({
          employee: employees,
          structure: salaryStructures,
        })
        .from(employees)
        .innerJoin(
          salaryStructures,
          and(
            eq(salaryStructures.employeeId, employees.id),
            lte(salaryStructures.effectiveFrom, periodEnd),
            or(
              sql`${salaryStructures.effectiveTo} IS NULL`,
              sql`${salaryStructures.effectiveTo} >= ${periodStart}`
            )
          )
        )
        .where(inArray(employees.status, ["active", "on_leave", "probation", "notice_period"]));

      // Recalculating replaces prior rows rather than adding to them.
      await tx.delete(payrollRecords).where(eq(payrollRecords.runId, id));

      let totalGross = 0n;
      let totalDeductions = 0n;
      let totalNet = 0n;
      let processed = 0;

      for (const { employee, structure } of staff) {
        const attendance = await tx
          .select({
            present: sql<number>`count(*) filter (where ${attendanceRecords.status} in ('present','late','wfh'))::int`,
            half: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'half_day')::int`,
            overtime: sql<number>`coalesce(sum(${attendanceRecords.overtimeMinutes}), 0)::int`,
          })
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.employeeId, employee.id),
              sql`${attendanceRecords.workDate} between ${periodStart} and ${periodEnd}`
            )
          );

        const stats = attendance[0] ?? { present: 0, half: 0, overtime: 0 };
        // Absent an attendance system for this employee, full attendance is
        // assumed rather than deducting a month's pay on missing data.
        const hasAttendance = stats.present + stats.half > 0;
        const presentDays = hasAttendance ? stats.present + stats.half * 0.5 : workingDays;
        const lopDays = Math.max(0, workingDays - presentDays);

        const monthlyBasic = structure.basicMinor / 12n;
        const basic = prorate(monthlyBasic, presentDays, workingDays);
        const hra = prorate(structure.hraMinor / 12n, presentDays, workingDays);
        const conveyance = prorate(structure.conveyanceMinor / 12n, presentDays, workingDays);
        const medical = prorate(structure.medicalMinor / 12n, presentDays, workingDays);
        const lta = prorate(structure.ltaMinor / 12n, presentDays, workingDays);
        const special = prorate(
          structure.specialAllowanceMinor / 12n,
          presentDays,
          workingDays
        );
        const other = prorate(structure.otherAllowancesMinor / 12n, presentDays, workingDays);

        const gross = basic + hra + conveyance + medical + lta + special + other;

        const pfEmployee =
          (basic * 12n) / 100n > PF_EMPLOYEE_MONTHLY_CAP
            ? PF_EMPLOYEE_MONTHLY_CAP
            : (basic * 12n) / 100n;
        const esiEmployee = gross <= ESI_WAGE_CEILING_MONTHLY ? (gross * 75n) / 10_000n : 0n;
        const esiEmployer = gross <= ESI_WAGE_CEILING_MONTHLY ? (gross * 325n) / 10_000n : 0n;

        const professionalTax = BigInt(
          Math.round(calculateProfessionalTax(Number(gross) / 100) * 100)
        );
        const annualTax = calculateNewRegimeIncomeTax(Number(structure.ctcMinor) / 100);
        const incomeTax = BigInt(Math.round((annualTax / 12) * 100));

        const lopDeduction = prorate(
          structure.ctcMinor / 12n,
          Math.max(0, workingDays - presentDays),
          workingDays
        );

        const deductions =
          pfEmployee + esiEmployee + professionalTax + incomeTax + lopDeduction;
        // Floors at zero: a negative net would become a payment instruction
        // asking the employee to pay the company.
        const netPay = gross > deductions ? gross - deductions : 0n;

        const anomalies: string[] = [];
        if (netPay === 0n && gross > 0n) anomalies.push("net_pay_zero");
        if (lopDays > workingDays / 2) anomalies.push("high_loss_of_pay");
        if (gross > (structure.ctcMinor / 12n) * 2n) anomalies.push("gross_exceeds_expected");

        await tx.insert(payrollRecords).values({
          orgId: this.ctx.orgId,
          runId: id,
          employeeId: employee.id,
          workingDays: String(workingDays),
          presentDays: String(presentDays),
          lopDays: String(lopDays),
          basicMinor: basic,
          hraMinor: hra,
          conveyanceMinor: conveyance,
          medicalMinor: medical,
          ltaMinor: lta,
          specialAllowanceMinor: special,
          otherEarningsMinor: other,
          grossMinor: gross,
          pfEmployeeMinor: pfEmployee,
          esiEmployeeMinor: esiEmployee,
          professionalTaxMinor: professionalTax,
          incomeTaxMinor: incomeTax,
          lopDeductionMinor: lopDeduction,
          totalDeductionsMinor: deductions,
          netPayMinor: netPay,
          pfEmployerMinor: pfEmployee,
          esiEmployerMinor: esiEmployer,
          status: "processed",
          anomalies,
        });

        totalGross += gross;
        totalDeductions += deductions;
        totalNet += netPay;
        processed++;
      }

      const [row] = await tx
        .update(payrollRuns)
        .set({
          status: "processed",
          employeeCount: processed,
          totalGrossMinor: totalGross,
          totalDeductionsMinor: totalDeductions,
          totalNetMinor: totalNet,
          processedById,
          processedAt: new Date(),
        })
        .where(eq(payrollRuns.id, id))
        .returning();

      return toRunRecord(row);
    });
  }

  async approveRun(id: string, approverId: string): Promise<PayrollRunRecord> {
    return withTenant(this.ctx, async (tx) => {
      const locked = await tx
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.id, id))
        .for("update")
        .limit(1);

      const run = locked[0];
      if (!run) throw new NotFoundError("Payroll run", id);
      if (run.status !== "processed") {
        throw new RepositoryError(`Only a processed run can be approved (this is ${run.status})`, 409);
      }
      // Checked here for a clear message; the database enforces it regardless.
      if (run.processedById === approverId) {
        throw new RepositoryError(
          "Payroll must be approved by someone other than the person who processed it",
          403
        );
      }

      const [row] = await tx
        .update(payrollRuns)
        .set({ status: "approved", approvedById: approverId, approvedAt: new Date() })
        .where(eq(payrollRuns.id, id))
        .returning();

      await tx
        .update(payrollRecords)
        .set({ status: "approved" })
        .where(eq(payrollRecords.runId, id));

      return toRunRecord(row);
    });
  }

  async markPaid(id: string, transactionRef?: string): Promise<PayrollRunRecord> {
    return withTenant(this.ctx, async (tx) => {
      const locked = await tx
        .select({ status: payrollRuns.status })
        .from(payrollRuns)
        .where(eq(payrollRuns.id, id))
        .for("update")
        .limit(1);

      if (!locked[0]) throw new NotFoundError("Payroll run", id);
      if (locked[0].status !== "approved") {
        throw new RepositoryError(
          `Only an approved run can be marked paid (this is ${locked[0].status})`,
          409
        );
      }

      const paidAt = new Date();
      const [row] = await tx
        .update(payrollRuns)
        .set({ status: "paid", paidAt })
        .where(eq(payrollRuns.id, id))
        .returning();

      await tx
        .update(payrollRecords)
        .set({ status: "paid", paidAt, transactionRef })
        .where(eq(payrollRecords.runId, id));

      return toRunRecord(row);
    });
  }

  async listRecords(runId: string, q: ListQuery = {}): Promise<Page<PayrollRecordDto>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, q.pageSize ?? 50));

    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({
          record: payrollRecords,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(payrollRecords)
        .leftJoin(employees, eq(employees.id, payrollRecords.employeeId))
        .where(eq(payrollRecords.runId, runId))
        .orderBy(asc(employees.firstName))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(payrollRecords)
        .where(eq(payrollRecords.runId, runId));

      const items = rows.map((r) =>
        toPayrollRecord({
          ...r.record,
          employeeName: [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
        })
      );

      return {
        items,
        total,
        page,
        pageSize,
        hasMore: (page - 1) * pageSize + items.length < total,
      };
    });
  }

  async payslipsFor(employeeId: string): Promise<PayrollRecordDto[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({ record: payrollRecords, run: payrollRuns })
        .from(payrollRecords)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRecords.runId))
        .where(
          and(
            eq(payrollRecords.employeeId, employeeId),
            // Only released payslips. A draft or processed run is still being
            // corrected and must not be visible to the employee.
            inArray(payrollRuns.status, ["approved", "paid"])
          )
        )
        .orderBy(desc(payrollRuns.periodYear), desc(payrollRuns.periodMonth));

      return rows.map((r) => ({
        ...toPayrollRecord(r.record),
        // Carried from the run, which is already joined here to filter on its
        // status. The record itself has no period, so a payslip list without
        // this is a column of amounts with nothing to say which month is which.
        periodMonth: r.run.periodMonth,
        periodYear: r.run.periodYear,
      }));
    });
  }
}
