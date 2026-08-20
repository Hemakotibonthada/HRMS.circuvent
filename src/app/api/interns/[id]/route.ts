// ═══════════════════════════════════════════════════════════════
// HRMS API — single intern
// ═══════════════════════════════════════════════════════════════
// Sets the expected end date the interns page counts down and the reminder
// sweep watches. A separate route rather than a case inside
// `PATCH /api/employees/[id]`, because that route's `updateSchema`
// deliberately excludes `internshipEndDate` — see the comment on
// `setInternshipEndDate` in `employee.neon.ts` — and the two must stay
// separate for the same reason: an ordinary profile edit must never be able
// to move or clear someone's internship end date as a side effect.
//
// Scoped to actual interns: the id has to resolve to an `intern`-type
// employee, not merely any employee id, so a stray request against a
// permanent employee's id cannot set a field the interns page would never
// show for them. Treated as 404 rather than 400 for the same reason RLS
// mismatches are — see `employees/[id]/route.ts` — telling the caller
// "wrong type" instead of "not found" would confirm the id belongs to
// *someone*, just not an intern.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { describeIssues, toFieldIssues } from "@/lib/validation-response";

const paramsSchema = z.object({ id: z.string().uuid("Invalid employee id") });

const patchSchema = z.object({
  internshipEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be YYYY-MM-DD")
    .nullable(),
});

function fail(error: unknown) {
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: "Intern not found" }, { status: 404 });
  }
  if (error instanceof RepositoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Intern API failure:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`intern-update:${clientIdentifier(request, ctx.userId)}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const idResult = paramsSchema.safeParse(await params);
  if (!idResult.success) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: describeIssues(toFieldIssues(parsed.error)), issues: toFieldIssues(parsed.error) },
      { status: 400 }
    );
  }

  try {
    const repo = new NeonEmployeeRepository(ctx);
    const existing = await repo.getById(idResult.data.id);
    if (!existing || existing.employmentType !== "intern") {
      return NextResponse.json({ error: "Intern not found" }, { status: 404 });
    }

    const updated = await repo.setInternshipEndDate(
      idResult.data.id,
      parsed.data.internshipEndDate
    );
    return NextResponse.json(updated);
  } catch (error) {
    return fail(error);
  }
}
