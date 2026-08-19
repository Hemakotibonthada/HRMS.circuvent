// ═══════════════════════════════════════════════════════════════
// GET/POST /api/departments
// ═══════════════════════════════════════════════════════════════
// `hrms.departments` is a real table — `employees.department_id` is a foreign
// key to it — but nothing exposed it. `departments` had no entity route and is
// not in the document store's allowlist either, so every department picker had
// nowhere to read from.
//
// The visible symptom was on the Employees page: the form offered a hardcoded
// list of department *names*, `POST /api/employees` expects a department
// *uuid*, and there was no way to turn one into the other. Every employee was
// therefore created with no department, which is why the directory showed
// "Unassigned" and the distribution chart had a single bar.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { departments } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { roleHasPermission } from "@/lib/rbac";
import { describeIssues, toFieldIssues } from "@/lib/validation-response";

const createSchema = z.object({
  name: z.string().trim().min(1, "A department needs a name").max(150),
  /**
   * Short code, unique per organization. Derived from the name when omitted,
   * because a picker that makes someone invent a code before they can save is
   * a picker people work around.
   */
  code: z.string().trim().min(1).max(32).optional(),
  description: z.string().trim().max(2000).optional(),
  headId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  costCenter: z.string().trim().max(64).optional(),
});

/** `Customer Success` → `CUSTOMER_SUCCESS`, trimmed to fit the column. */
export function codeFrom(name: string): string {
  const code = name
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return code || "DEPT";
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";

  try {
    const rows = await withTenant(ctx, async (tx) => {
      // Headcount comes from the database rather than by loading every
      // employee and grouping in the page — the department list appears on
      // several screens and each one was counting for itself.
      const query = tx
        .select({
          id: departments.id,
          name: departments.name,
          code: departments.code,
          description: departments.description,
          headId: departments.headId,
          parentId: departments.parentId,
          costCenter: departments.costCenter,
          isActive: departments.isActive,
          headcount: sql<number>`(
            SELECT count(*) FROM hrms.employees e
            WHERE e.department_id = ${departments.id} AND e.deleted_at IS NULL
          )`,
        })
        .from(departments);

      return includeInactive
        ? query.orderBy(asc(departments.name))
        : query.where(eq(departments.isActive, true)).orderBy(asc(departments.name));
    });

    return NextResponse.json({ items: rows, data: rows, count: rows.length });
  } catch (error) {
    console.error("Departments lookup failed:", error);
    return NextResponse.json({ error: "Could not read departments" }, { status: 500 });
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

  if (!roleHasPermission(ctx.role, "departments.manage")) {
    return NextResponse.json({ error: "You cannot create departments" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: describeIssues(toFieldIssues(parsed.error)), issues: toFieldIssues(parsed.error) },
      { status: 400 }
    );
  }

  try {
    const created = await withTenant(ctx, async (tx) => {
      const name = parsed.data.name;
      const code = parsed.data.code ?? codeFrom(name);

      // Returning the existing row rather than a conflict: "Engineering
      // already exists" is not useful to someone whose actual goal is to put
      // an employee in Engineering. This also makes the picker's
      // create-on-demand safe to retry.
      const existing = await tx
        .select()
        .from(departments)
        .where(eq(departments.code, code))
        .limit(1);

      if (existing[0]) return existing[0];

      const [row] = await tx
        .insert(departments)
        .values({
          orgId: ctx.orgId,
          name,
          code,
          description: parsed.data.description ?? null,
          headId: parsed.data.headId ?? null,
          parentId: parsed.data.parentId ?? null,
          costCenter: parsed.data.costCenter ?? null,
        })
        .returning();

      return row;
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("Department creation failed:", error);
    return NextResponse.json({ error: "Could not create this department" }, { status: 500 });
  }
}
