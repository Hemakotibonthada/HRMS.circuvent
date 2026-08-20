// ═══════════════════════════════════════════════════════════════
// /api/loans — what is owed, what has been recovered, and the perquisite
// ═══════════════════════════════════════════════════════════════
//
// GET   the caller's loans, each with its schedule, its real position, and the
//       taxable value of any concession.
// POST  request one.
//
// The position is computed from what payroll actually recovered rather than
// from the schedule. A month of unpaid leave recovers nothing and a settlement
// may clear the balance in one go, so a system that assumes twelve instalments
// were taken reports a loan closed while money is still owed.
//
// The perquisite is the part most systems omit. An interest-free employer loan
// is not free: under Rule 3(7)(i) the shortfall against SBI's rate is taxable.
// Where the benchmark has not been configured for that year and loan type, this
// says so rather than reporting zero — a silent zero under-declares income
// every month, and it is the employer who answers for the short deduction.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { employeeLoans, loanBenchmarkRates, loanRepayments } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId, NoEmployeeRecordError, requireCurrentEmployeeId } from "@/lib/current-employee";
import {
  loanPerquisite,
  monthlyInstalment,
  positionOf,
  schedule,
  type Loan,
  type LoanType,
} from "@/lib/employee-loans";

const LOAN_TYPES: LoanType[] = [
  "personal",
  "housing",
  "vehicle",
  "education",
  "medical",
  "salary_advance",
];

const createSchema = z.object({
  loanType: z.enum(LOAN_TYPES as [LoanType, ...LoanType[]]),
  principalMinor: z.coerce.bigint().positive(),
  tenureMonths: z.coerce.number().int().min(1).max(360),
  purpose: z.string().trim().max(500).optional(),
});

function currentFinancialYear(now = new Date()): number {
  return now.getUTCMonth() + 1 >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

/**
 * Month-end balances across the financial year, from the schedule and what was
 * actually recovered.
 *
 * The perquisite is charged on the balance outstanding at each month end, so
 * charging it on the opening principal overstates it substantially on a loan
 * that is being repaid.
 */
function monthEndBalances(
  loan: Loan,
  recovered: { month: number; year: number; amountMinor: bigint }[],
  financialYear: number
): bigint[] {
  const balances: bigint[] = [];
  let balance = loan.principalMinor;

  const paid = new Map(recovered.map((r) => [`${r.year}-${r.month}`, r.amountMinor]));

  for (let i = 0; i < 12; i++) {
    const month = ((3 + i) % 12) + 1;
    const year = month >= 4 ? financialYear : financialYear + 1;
    balance -= paid.get(`${year}-${month}`) ?? 0n;
    if (balance < 0n) balance = 0n;
    balances.push(balance);
  }

  return balances;
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const financialYear = currentFinancialYear();

  try {
    const payload = await withTenant(ctx, async (tx) => {
      // ctx.userId is the signing-in account, not the employment record a
      // loan is keyed by — see lib/current-employee.ts.
      const employeeId = await currentEmployeeId(ctx, tx);
      if (!employeeId) return { loans: [], repayments: [], rates: [] };

      const loans = await tx
        .select()
        .from(employeeLoans)
        .where(eq(employeeLoans.employeeId, employeeId))
        .orderBy(desc(employeeLoans.createdAt));

      if (loans.length === 0) return { loans: [], repayments: [], rates: [] };

      const repayments = await tx
        .select()
        .from(loanRepayments)
        .where(
          inArray(
            loanRepayments.loanId,
            loans.map((l) => l.id)
          )
        );

      const rates = await tx
        .select()
        .from(loanBenchmarkRates)
        .where(
          and(
            eq(loanBenchmarkRates.orgId, ctx.orgId),
            eq(loanBenchmarkRates.financialYear, financialYear)
          )
        );

      return { loans, repayments, rates };
    });

    const rateFor = new Map(payload.rates.map((r) => [r.loanType, Number(r.ratePercent)]));

    // The exemption is on the aggregate across every live loan, not per loan,
    // so it is summed before any of them are valued.
    const aggregateOutstanding = payload.loans.reduce((sum, l) => {
      const paid = payload.repayments
        .filter((r) => r.loanId === l.id)
        .reduce((a, r) => a + r.amountMinor, 0n);
      const left = l.principalMinor - paid;
      return sum + (left > 0n ? left : 0n);
    }, 0n);

    const result = payload.loans.map((row) => {
      const loan: Loan = {
        principalMinor: row.principalMinor,
        interestRatePercent: Number(row.interestRatePercent),
        tenureMonths: row.tenureMonths,
        firstRecoveryMonth: row.firstRecoveryMonth,
        firstRecoveryYear: row.firstRecoveryYear,
        type: row.loanType as LoanType,
      };

      const recovered = payload.repayments
        .filter((r) => r.loanId === row.id)
        .map((r) => ({ month: r.periodMonth, year: r.periodYear, amountMinor: r.amountMinor }));

      const position = positionOf(loan, recovered);
      const rows = schedule(loan);
      const benchmark = rateFor.get(row.loanType);

      const perquisite =
        benchmark === undefined
          ? null
          : loanPerquisite({
              monthEndBalancesMinor: monthEndBalances(loan, recovered, financialYear),
              sbiRatePercent: benchmark,
              employerRatePercent: Number(row.interestRatePercent),
              loanType: row.loanType as LoanType,
              aggregateOutstandingMinor: aggregateOutstanding,
            });

      return {
        id: row.id,
        loanType: row.loanType,
        purpose: row.purpose,
        status: row.status,
        principalMinor: row.principalMinor.toString(),
        interestRatePercent: Number(row.interestRatePercent),
        tenureMonths: row.tenureMonths,
        instalmentMinor: monthlyInstalment(loan).toString(),
        recoveredMinor: position.recoveredMinor.toString(),
        outstandingMinor: position.outstandingMinor.toString(),
        instalmentsPaid: position.instalmentsPaid,
        schedule: rows.map((r) => ({
          index: r.index,
          month: r.month,
          year: r.year,
          principalMinor: r.principalMinor.toString(),
          interestMinor: r.interestMinor.toString(),
          totalMinor: r.totalMinor.toString(),
          closingBalanceMinor: r.closingBalanceMinor.toString(),
        })),
        perquisite:
          perquisite === null
            ? {
                known: false,
                taxableMinor: null,
                note:
                  `No benchmark rate is configured for ${row.loanType} loans in ` +
                  `${financialYear}-${(financialYear + 1) % 100}. Until one is, the taxable ` +
                  `value of any concession cannot be computed — it is not zero.`,
              }
            : {
                known: true,
                taxableMinor: perquisite.taxableMinor.toString(),
                exempt: perquisite.exempt,
                note: perquisite.reason ?? null,
              },
      };
    });

    return NextResponse.json({ financialYear, loans: result });
  } catch (error) {
    if (error instanceof NoEmployeeRecordError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Loan list failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request", detail: (error as z.ZodError).issues?.[0]?.message },
      { status: 400 }
    );
  }

  try {
    const id = await withTenant(ctx, async (tx) => {
      // ctx.userId is the signing-in account, not the employment record a
      // loan is keyed by — see lib/current-employee.ts.
      const employeeId = await requireCurrentEmployeeId(ctx, tx);
      const now = new Date();
      // Recovery starts the month after the request, since this month's payroll
      // may already have been prepared.
      const startMonth = now.getUTCMonth() + 2 > 12 ? 1 : now.getUTCMonth() + 2;
      const startYear = now.getUTCMonth() + 2 > 12 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();

      const [row] = await tx
        .insert(employeeLoans)
        .values({
          orgId: ctx.orgId,
          employeeId,
          loanType: body.loanType,
          principalMinor: body.principalMinor,
          tenureMonths: body.tenureMonths,
          firstRecoveryMonth: startMonth,
          firstRecoveryYear: startYear,
          purpose: body.purpose ?? null,
          status: "pending",
        })
        .returning({ id: employeeLoans.id });

      return row.id;
    });

    return NextResponse.json({ id, status: "pending" });
  } catch (error) {
    if (error instanceof NoEmployeeRecordError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Loan request failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
