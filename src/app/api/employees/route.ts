// ═══════════════════════════════════════════════════════════════
// HRMS API — Employees
// ═══════════════════════════════════════════════════════════════
// Replaces a stub that authenticated the caller and then returned an empty
// array regardless. Now backed by NeonEmployeeRepository under row-level
// security.
//
// Three rules hold for every handler here:
//   1. The organization comes from the verified token, never the request.
//   2. The body is parsed by Zod before it reaches the database.
//   3. Rate limits key on the user, not just the IP, so a whole office behind
//      one NAT is not throttled by a single noisy client.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonEmployeeRepository, resolveCompanyEmailDomains } from "@/db/repositories/employee.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { assertSeatsAvailable } from "@/db/repositories/subscription.neon";
import { canViewOthersSalary } from "@/lib/rbac";
import {
  normaliseEmploymentType,
  validateEmployeeFields,
} from "@/lib/employee-rules";
import { checkHireProvenance, provenanceAuditNote } from "@/lib/hire-provenance";
import { loadHireProvenance } from "@/db/repositories/hire-provenance.neon";
import { recordProvenance } from "@/db/repositories/hire-provenance.audit";

const listQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  sortBy: z
    .enum(["fullName", "email", "designation", "joinDate", "status", "employeeCode", "createdAt"])
    .optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});

const createSchema = z.object({
  employeeCode: z.string().trim().min(1).max(64).optional(),
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  email: z.string().trim().email("Enter a valid email address").max(320),
  phone: z.string().trim().max(32).optional(),
  departmentId: z.string().uuid().optional(),
  designation: z.string().trim().min(1, "Designation is required").max(150),
  reportingToId: z.string().uuid().optional(),
  // Left as a string here and validated by the shared rules, for the same
  // reason as `salary` below: a Zod enum failure short-circuits the parse and
  // would hide every other problem in the same submission. Normalised to the
  // stored value after validation, just before the insert.
  employmentType: z.string().trim().optional(),
  status: z
    .enum(["active", "on_leave", "probation", "notice_period", "terminated", "inactive"])
    .optional(),
  joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Joining date must be YYYY-MM-DD"),
  /**
   * The candidate and application this person was hired against.
   *
   * Optional in the schema and required by `checkHireProvenance`, so that a
   * submission missing them is answered with the rule's own sentence — "pick
   * the candidate this person was hired as" — rather than a Zod type error
   * that says nothing about why.
   */
  candidateId: z.string().uuid().optional(),
  applicationId: z.string().uuid().optional(),
  /** A written justification for a founder, an acquisition or a corrected record. */
  provenanceOverrideReason: z.string().trim().max(500).optional(),
  location: z.string().trim().max(150).optional(),
  /**
   * Only the outer bound here; the sign is checked by the shared rules.
   *
   * A Zod failure short-circuits the whole parse, so putting `.nonnegative()`
   * here meant a submission with a negative salary reported *only* that, hiding
   * the personal email address, the digits in the job title and the joining date
   * in the past that were wrong in the same submission. A form that reveals one
   * fault per attempt takes as many round trips as there are mistakes, which is
   * the complaint this change exists to answer.
   */
  salary: z.number().max(1_000_000_000, "Salary is implausibly large").optional(),
  /**
   * Allows a joining date in the past.
   *
   * For backfilling somebody who genuinely started before today. Named rather
   * than inferred, so recording a historic start is a deliberate act.
   */
  allowPastJoiningDate: z.boolean().optional(),
});

/** Filters are namespaced `filter.<field>` so they cannot collide with paging. */
function readFilters(searchParams: URLSearchParams): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const [key, value] of searchParams) {
    if (key.startsWith("filter.")) filters[key.slice("filter.".length)] = value;
  }
  return filters;
}

function errorResponse(error: unknown) {
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // Internal details are logged, not returned — a stack trace in the response
  // body tells an attacker about the schema.
  console.error("Employees API failure:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

// GET /api/employees
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr", "manager"]);
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

  const { searchParams } = new URL(request.url);
  const parsed = listQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }

  try {
    const repo = new NeonEmployeeRepository(ctx);
    const page = await repo.list({ ...parsed.data, filters: readFilters(searchParams) });

    // The directory is open to managers; the salary column is not. Without
    // this a manager could page through `?pageSize=500` and harvest every
    // colleague's compensation, which is precisely what withholding
    // `payroll.view` from the manager role is meant to prevent.
    if (!canViewOthersSalary(ctx.role)) {
      const withoutOthersPay = page.items.map((employee) => {
        if (employee.id === ctx.userId) return employee;
        const { salary: _salary, ...rest } = employee;
        return rest;
      });
      return NextResponse.json({ ...page, items: withoutOthersPay });
    }

    return NextResponse.json(page);
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/employees
export async function POST(request: NextRequest) {
  let ctx;
  try {
    // Managers can read the directory but must not create employees; that is
    // an HR action with payroll and access-provisioning consequences.
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`create:${clientIdentifier(request, ctx.userId)}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      field: i.path.join("."),
      message: i.message,
    }));
    return NextResponse.json(
      {
        // The message is now the reasons, not the word "Validation failed".
        // Clients that only read `error` — and the employees screen was one —
        // used to show a bare "Validation failed" over a response that had
        // named every problem in `issues`.
        error: issues.map((i) => i.message).join("\n"),
        issues,
      },
      { status: 400 }
    );
  }

  // ── Who may be an employee ──
  //
  // Enforced here and not only in the browser, because anything holding a
  // session can post JSON straight at this route. These are the rules that keep
  // role mailboxes — abuse@, accounts@, billing@ — out of the staff directory;
  // see `lib/employee-rules.ts` for why a mailbox is not a colleague.
  //
  // Domains are this organisation's own, not the process-wide default: this
  // product is multi-tenant, and a tenant whose staff are not on
  // circuvent.com (or whatever COMPANY_EMAIL_DOMAINS names) would otherwise
  // have every hire refused as a "personal address" on a domain they do not
  // own. See `resolveCompanyEmailDomains` in `db/repositories/employee.neon.ts`.
  const domains = await resolveCompanyEmailDomains(ctx);
  const ruleIssues = validateEmployeeFields(
    {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email,
      designation: parsed.data.designation,
      joiningDate: parsed.data.joinDate,
      employmentType: parsed.data.employmentType,
      salary: parsed.data.salary === undefined ? "" : String(parsed.data.salary),
    },
    { allowPastJoiningDate: parsed.data.allowPastJoiningDate, domains }
  );
  if (ruleIssues.length > 0) {
    return NextResponse.json(
      { error: ruleIssues.map((i) => i.message).join("\n"), issues: ruleIssues },
      { status: 400 }
    );
  }

  // ── Where did this hire come from? ──
  //
  // The ATS handoff refuses to create an employee without an accepted offer
  // and stamps `candidate_id`/`application_id` when it does. This route — the
  // dialog HR uses daily — did neither: it created a row with both link
  // columns NULL from nothing but a typed name and address. The pipeline was
  // enforced on the path nobody uses by hand and unenforced on the one
  // everybody does.
  //
  // The exception for a founder, an acquisition or a corrected record is
  // deliberate and audited; see `lib/hire-provenance.ts` for why refusing
  // outright would be worse than a door with a name on it.
  const provenance = await loadHireProvenance(ctx, {
    candidateId: parsed.data.candidateId,
    applicationId: parsed.data.applicationId,
  });
  const decision = checkHireProvenance(provenance, {
    overrideReason: parsed.data.provenanceOverrideReason,
  });
  if (!decision.ok) {
    return NextResponse.json(
      { error: decision.issues.map((i) => i.message).join("\n"), issues: decision.issues },
      { status: 422 }
    );
  }

  try {
    // One more person than the plan covers is still one too many. Checked
    // here as well as in the importer because these are two independent doors
    // into the same table, and a limit enforced at only one of them is a
    // limit somebody routes around without ever meaning to.
    const seats = await assertSeatsAvailable(ctx, 1);
    if (!seats.allowed) {
      return NextResponse.json(
        { error: seats.reason, seats: { limit: seats.limit, used: seats.used, remaining: seats.remaining } },
        { status: 402 }
      );
    }

    const repo = new NeonEmployeeRepository(ctx);
    const {
      allowPastJoiningDate: _allowPast,
      employmentType,
      provenanceOverrideReason: _overrideReason,
      ...employee
    } = parsed.data;
    // Normalised only now that it is known to be one of the accepted spellings.
    const created = await repo.create({
      ...employee,
      employmentType: employmentType ? normaliseEmploymentType(employmentType) ?? undefined : undefined,
    });

    // Recorded whether or not it was an exception: an ordinary hire's audit
    // entry names the candidate it came from, which is what makes the link
    // auditable rather than merely present.
    await recordProvenance(ctx, created.id, decision, provenance);

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    // A duplicate work email or employee code trips a unique index; that is
    // the caller's mistake, not a server fault.
    const message = error instanceof Error ? error.message : "";
    if (message.includes("duplicate key") || message.includes("unique constraint")) {
      return NextResponse.json(
        { error: "An employee with that email or code already exists" },
        { status: 409 }
      );
    }
    return errorResponse(error);
  }
}
