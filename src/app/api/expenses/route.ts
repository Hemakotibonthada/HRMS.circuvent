// ═══════════════════════════════════════════════════════════════
// GET/POST /api/expenses
// ═══════════════════════════════════════════════════════════════
// This route used to be a fake. `GET` returned `data: []` unconditionally.
// `POST` validated the body, built `{ id: "EXP-" + Date.now(), ...body }`,
// returned 201 "Expense submitted" — and wrote nothing. An employee filed a
// claim, saw a success toast, and the claim did not exist. `PATCH` reported
// "Expense approved" the same way.
//
// `hrms.expense_claims` had been there the whole time, with row-level
// security, indexes, a unique claim number, and a workflow engine that already
// knew how to route `expense` approvals to it.
//
// Visibility follows the permission model rather than a role list: `expenses.
// view_all` is what separates "my claims" from "everyone's", and an employee
// without it is pinned to their own regardless of what they ask for.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonExpenseRepository } from "@/db/repositories/expense.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { currentEmployeeId, NoEmployeeRecordError } from "@/lib/current-employee";
import { roleHasPermission } from "@/lib/rbac";
import { EXPENSE_CATEGORIES } from "@/lib/expense-rules";

const listQuerySchema = z.object({
  status: z.string().optional(),
  category: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
  sortBy: z.enum(["expenseDate", "createdAt", "status", "totalAmount"]).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const lineItemSchema = z.object({
  description: z.string().trim().min(1, "Each line needs a description").max(500),
  // A string, not a number: these are exact paise, and JSON numbers are
  // doubles. Accepting `12.5` here would mean accepting a fraction of a paise.
  amountMinor: z.string().regex(/^\d+$/, "Line amounts must be whole minor units"),
  category: z.string().max(64).optional(),
});

const submitSchema = z.object({
  employeeId: z.string().uuid().optional(),
  title: z.string().trim().min(1, "A title is required").max(200),
  category: z.enum(EXPENSE_CATEGORIES as [string, ...string[]]),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expense date must be YYYY-MM-DD"),
  lineItems: z.array(lineItemSchema).min(1, "A claim needs at least one line item").max(100),
  description: z.string().trim().max(2000).optional(),
  receipts: z.array(z.string().url()).max(20).optional(),
  currency: z.string().length(3).optional(),
});

function fail(error: unknown) {
  if (error instanceof NoEmployeeRecordError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Expenses API failure:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(request.url);
  const parsed = listQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }

  // Someone who cannot see everyone's claims is pinned to their own, whatever
  // `employeeId` they asked for. Filtering in the page instead would mean the
  // whole organization's spending had already crossed the wire.
  const seesAll = roleHasPermission(ctx.role, "expenses.view_all");
  // ctx.userId is the signing-in account, not the employment record an
  // expense claim is keyed by — see lib/current-employee.ts.
  const self = await currentEmployeeId(ctx);
  const employeeId = seesAll ? parsed.data.employeeId : self;

  // `filters.employeeId` is passed straight through below, and the repository
  // treats a falsy value as "no filter". An unprivileged caller with no
  // employee record must get nothing back, not everyone's expenses.
  if (!seesAll && !self) {
    return NextResponse.json({
      data: [],
      items: [],
      summary: { total: 0, pending: 0, approved: 0, reimbursed: 0, totalAmountMinor: "0" },
      pagination: {
        page: parsed.data.page ?? 1,
        pageSize: parsed.data.pageSize ?? parsed.data.limit ?? 50,
        total: 0,
        hasMore: false,
      },
    });
  }

  try {
    const repo = new NeonExpenseRepository(ctx);
    const page = await repo.list({
      page: parsed.data.page,
      // `limit` is what collection-service sends; `pageSize` is the newer name.
      pageSize: parsed.data.pageSize ?? parsed.data.limit,
      sortBy: parsed.data.sortBy,
      sortDirection: parsed.data.sortDirection,
      filters: {
        status: parsed.data.status,
        category: parsed.data.category,
        employeeId,
        from: parsed.data.from,
        to: parsed.data.to,
      },
    });

    const summary = await repo.summary(employeeId ?? undefined);

    // `data` rather than `items`: this route predates the paged convention and
    // collection-service already absorbs the difference. Both are sent so a
    // newer caller does not have to know which one this is.
    return NextResponse.json({
      data: page.items,
      items: page.items,
      summary,
      pagination: { page: page.page, pageSize: page.pageSize, total: page.total, hasMore: page.hasMore },
    });
  } catch (error) {
    return fail(error);
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

  const limit = checkRateLimit(`expense-submit:${clientIdentifier(request, ctx.userId)}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  if (!roleHasPermission(ctx.role, "expenses.submit")) {
    return NextResponse.json({ error: "You cannot submit expenses" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = submitSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }

  // Filing on someone else's behalf is an HR action. Without this check the
  // `employeeId` field is a way to attribute your own spending to a colleague.
  // ctx.userId is the signing-in account, not the employment record an
  // expense claim is keyed by — see lib/current-employee.ts.
  const self = await currentEmployeeId(ctx);
  const onBehalf = parsed.data.employeeId && parsed.data.employeeId !== self;
  if (onBehalf && !roleHasPermission(ctx.role, "expenses.view_all")) {
    return NextResponse.json(
      { error: "You can only submit your own expenses" },
      { status: 403 }
    );
  }

  try {
    const employeeId = parsed.data.employeeId ?? self;
    if (!employeeId) {
      throw new NoEmployeeRecordError(ctx.userId);
    }

    const claim = await new NeonExpenseRepository(ctx).submit({
      ...parsed.data,
      employeeId,
    });

    return NextResponse.json({ data: claim, message: "Expense submitted" }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
