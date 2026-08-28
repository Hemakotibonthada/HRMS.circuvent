// ═══════════════════════════════════════════════════════════════
// GET/POST /api/holidays
// ═══════════════════════════════════════════════════════════════
// `hrms.holidays` is a real table with no route. The holiday calendar and the
// HR calendar both read it through `genericService(COLLECTIONS.holidays)`,
// which falls back to the document store — and the document store refuses it,
// correctly, because it has a table. Both pages showed an empty year.
//
// A holiday list that silently comes back empty is not a cosmetic failure in
// an HR product: it is what leave balances, payroll working days and
// attendance exceptions are all counted against.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { holidays } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { describeIssues, toFieldIssues } from "@/lib/validation-response";

const createSchema = z.object({
  name: z.string().trim().min(1, "A holiday needs a name").max(200),
  holidayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  /** Floating holidays employees pick from a pool. */
  isOptional: z.boolean().optional(),
  locationId: z.string().uuid().optional(),
  description: z.string().trim().max(2000).optional(),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");
  const year = yearParam === null ? undefined : Number(yearParam);

  if (year !== undefined && (!Number.isInteger(year) || year < 1900 || year > 2999)) {
    return NextResponse.json({ error: "year must be a four-digit year" }, { status: 400 });
  }

  try {
    const rows = await withTenant(ctx, async (tx) => {
      const query = tx.select().from(holidays);
      const scoped = year === undefined ? query : query.where(eq(holidays.year, year));
      // Chronological: a holiday list is read as a calendar, not a table.
      return scoped.orderBy(asc(holidays.holidayDate)).limit(500);
    });

    const items = rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
    return NextResponse.json({ items, data: items, count: items.length });
  } catch (error) {
    console.error("Holidays lookup failed:", error);
    return NextResponse.json({ error: "Could not read the holiday calendar" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    // No `holidays.manage` permission exists — only `holidays.view`, which
    // everyone holds. Restricted by role instead: the holiday calendar drives
    // payroll working days and leave, so it is not an ordinary edit.
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
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
      const [row] = await tx
        .insert(holidays)
        .values({
          orgId: ctx.orgId,
          name: parsed.data.name,
          holidayDate: parsed.data.holidayDate,
          isOptional: parsed.data.isOptional ?? false,
          locationId: parsed.data.locationId ?? null,
          description: parsed.data.description ?? null,
          // Derived from the date rather than accepted separately. Two fields
          // that must agree are two fields that eventually will not, and the
          // year is what every query filters on.
          year: Number(parsed.data.holidayDate.slice(0, 4)),
        })
        .returning();
      return row;
    });

    return NextResponse.json(
      { ...created, createdAt: created.createdAt.toISOString() },
      { status: 201 }
    );
  } catch (error) {
    console.error("Holiday creation failed:", error);
    return NextResponse.json({ error: "Could not add this holiday" }, { status: 500 });
  }
}
