// ═══════════════════════════════════════════════════════════════
// GET /api/directory — enough to name a colleague, and no more
// ═══════════════════════════════════════════════════════════════
//
// `/api/employees` needs owner, admin, hr or manager, and returns the whole
// record: work email, personal phone, join date, employee code. That is the
// right shape for an HR screen and the wrong one for "who is Priya in design",
// so an ordinary employee — most of the company — got a 403 from the company
// directory and could not look anybody up at all.
//
// This returns the four fields it takes to recognise and address somebody, to
// anyone signed in. No email, no phone, no join date, no employee code: those
// are contact details and employment facts, and widening an HR endpoint to
// share them with everyone would have been the easy fix and the wrong one.
//
// Active employees only. A directory that lists people who have left is how
// somebody emails a former colleague about live work.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { departments, employees } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

const querySchema = z.object({
  search: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const search = parsed.data.search ?? "";
  const limit = parsed.data.limit ?? 25;

  try {
    const rows = await withTenant(ctx, async (tx) => {
      const term = `%${search}%`;

      return tx
        .select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          designation: employees.designation,
          avatarUrl: employees.avatarUrl,
          departmentName: departments.name,
        })
        .from(employees)
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(
          and(
            eq(employees.status, "active"),
            isNull(employees.deletedAt),
            search
              ? or(
                  ilike(employees.firstName, term),
                  ilike(employees.lastName, term),
                  ilike(employees.designation, term)
                )
              : undefined
          )
        )
        .orderBy(asc(employees.firstName), asc(employees.lastName))
        .limit(limit);
    });

    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        fullName: `${r.firstName} ${r.lastName}`.trim(),
        designation: r.designation ?? "",
        departmentName: r.departmentName ?? null,
        avatarUrl: r.avatarUrl,
      })),
    });
  } catch (error) {
    console.error("Directory lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
