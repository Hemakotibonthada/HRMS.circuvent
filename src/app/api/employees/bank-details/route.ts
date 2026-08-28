// ═══════════════════════════════════════════════════════════════
// /api/employees/bank-details — an employee's own bank account and
// statutory IDs
// ═══════════════════════════════════════════════════════════════
//
// GET  returns the caller's bank details, or — for a role that also holds
//      payroll.view — another employee's, via ?employeeId=. Everyone else's
//      request for someone else's account is refused outright, the same way
//      /api/payroll/payslips refuses a manager who is not on that list.
// PUT  replaces the caller's own bank details and statutory IDs. There is no
//      way to name a different employeeId in the body at all: unlike GET,
//      write has no privileged exception (see canWriteBankDetails in
//      lib/bank-details-rules.ts for why), so the request simply has no field
//      that could name somebody else's account to begin with.
//
// This is the capture path for a gap that, until now, only had a delivery
// path: lib/paystub-client.ts has sent statutoryIds on every employee sync
// since it was written, and employees.bank_details has existed since the
// schema did, but nothing ever wrote to either — an employee had nowhere to
// tell HRMS their account number, so payroll ran on whatever was in the
// column, which was nothing.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { currentEmployeeId, NoEmployeeRecordError, requireCurrentEmployeeId } from "@/lib/current-employee";
import { canViewOthersBankDetails } from "@/lib/rbac";
import { issuesFailed } from "@/lib/validation-response";
import {
  toBankDetailsUpdate,
  toBankDetailsView,
  validateBankDetailsFields,
  type BankDetailsInput,
} from "@/lib/bank-details-rules";

function fail(error: unknown) {
  if (error instanceof NoEmployeeRecordError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Bank details API failure:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

const getQuerySchema = z.object({ employeeId: z.string().uuid().optional() });

// Every field optional at this layer: whether a field is required at all is a
// business rule (an employee filling in PAN but not UAN yet is a normal, not
// an error), and validateBankDetailsFields already owns that decision. Zod's
// job here is only to refuse a body shaped so oddly — a number, an array —
// that the pure validator would be checking the wrong thing entirely.
const putSchema = z.object({
  bankName: z.string().trim().max(140).optional(),
  accountHolderName: z.string().trim().max(140).optional(),
  accountNumber: z.string().trim().max(32).optional(),
  confirmAccountNumber: z.string().trim().max(32).optional(),
  ifsc: z.string().trim().max(16).optional(),
  accountType: z.string().trim().max(16).optional(),
  panNumber: z.string().trim().max(16).optional(),
  uanNumber: z.string().trim().max(16).optional(),
  pfNumber: z.string().trim().max(32).optional(),
  esiNumber: z.string().trim().max(32).optional(),
}) satisfies z.ZodType<BankDetailsInput>;

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const parsedQuery = getQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsedQuery.success) {
    return NextResponse.json({ error: "Invalid employeeId" }, { status: 400 });
  }

  const requested = parsedQuery.data.employeeId;

  // Refused, not silently redirected to the caller's own record. Silently
  // substituting "self" for a request that explicitly named someone else
  // would make a permission bug look, from the client, exactly like a
  // successful call — nobody would ever notice they got the wrong account.
  const privileged = canViewOthersBankDetails(ctx.role);

  try {
    // ctx.userId is the signing-in account, not the employment record bank
    // details are keyed by — see lib/current-employee.ts.
    const self = await currentEmployeeId(ctx);

    if (requested && requested !== self && !privileged) {
      return NextResponse.json(
        { error: "You can only view your own bank details" },
        { status: 403 }
      );
    }

    const employeeId = privileged && requested ? requested : self;

    if (!employeeId) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const raw = await new NeonEmployeeRepository(ctx).getBankDetails(employeeId);
    return NextResponse.json({ employeeId, ...toBankDetailsView(raw) });
  } catch (error) {
    return fail(error);
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

  const limit = checkRateLimit(
    `bank-details:${clientIdentifier(request, ctx.userId)}`,
    60,
    60_000
  );
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid bank details" }, { status: 400 });
  }

  // Every problem, not just the first — the same reason
  // validateBankDetailsFields returns an array at all: a form that reports one
  // fault per submission costs the employee as many round trips as there are
  // mistakes, and a wrong bank detail is exactly the kind of field somebody
  // wants to fix in one pass, not by trial and error.
  const issues = validateBankDetailsFields(parsed.data);
  if (issues.length > 0) {
    return issuesFailed(issues);
  }

  // The caller's own employee id, never a value from the request: writing
  // bank details is not a thing this product lets anyone do on someone else's
  // behalf (see canWriteBankDetails in lib/bank-details-rules.ts), so the body
  // is never even asked which employee it is for. Resolved once, here, and
  // passed into updateBankDetails as both the target and the caller — it
  // used to re-resolve the same caller internally via a second
  // `currentEmployeeId` lookup, which opened a second pooled `withTenant`
  // transaction and ran the same indexed lookup again for every PUT.
  try {
    const employeeId = await requireCurrentEmployeeId(ctx);
    const updated = await new NeonEmployeeRepository(ctx).updateBankDetails(
      employeeId,
      toBankDetailsUpdate(parsed.data),
      employeeId
    );
    return NextResponse.json({ employeeId, ...toBankDetailsView(updated) });
  } catch (error) {
    return fail(error);
  }
}
