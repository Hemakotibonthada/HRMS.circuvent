// ═══════════════════════════════════════════════════════════════
// POST /api/holidays/bulk
// ═══════════════════════════════════════════════════════════════
// A year's public holidays entered one dialog at a time is roughly
// twenty-five round trips, and the failure mode of giving up halfway is a
// calendar that looks populated and is not — which attendance, leave and
// payroll all then count against.
//
// Two sources, one write path: the curated Andhra Pradesh calendar for a
// year, or a pasted list for everything else (the lunisolar festivals
// `ap-holidays.ts` deliberately refuses to compute, another state's dates, an
// employer's own shutdown days).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { holidays } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { describeIssues, toFieldIssues } from "@/lib/validation-response";
import {
  apCalendarRows,
  dedupeAgainstExisting,
  parseHolidayCsv,
  type ParsedHolidayRow,
  type RowIssue,
} from "@/lib/holiday-import";

const bodySchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("ap-calendar"),
    year: z.number().int().min(1900).max(2999),
    locationId: z.string().uuid().optional(),
  }),
  z.object({
    source: z.literal("csv"),
    csv: z.string().min(1, "Paste at least one holiday").max(200_000),
    locationId: z.string().uuid().optional(),
  }),
]);

/** One year's calendar is about twenty-five rows; this is a guard against a paste gone wrong, not a quota. */
const MAX_ROWS = 500;

export async function POST(request: NextRequest) {
  let ctx;
  try {
    // Same restriction as the single-holiday POST alongside this: no
    // `holidays.manage` permission exists, only `holidays.view`, which
    // everyone holds. The calendar drives payroll working days and leave, so
    // it is not an ordinary edit — and a bulk write of it least of all.
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

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: describeIssues(toFieldIssues(parsed.error)), issues: toFieldIssues(parsed.error) },
      { status: 400 }
    );
  }

  let rows: ParsedHolidayRow[];
  let issues: RowIssue[] = [];

  if (parsed.data.source === "ap-calendar") {
    try {
      rows = apCalendarRows(parsed.data.year);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "That year is not available." },
        { status: 400 }
      );
    }
  } else {
    const result = parseHolidayCsv(parsed.data.csv);
    rows = result.rows;
    issues = result.issues;
  }

  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `That is ${rows.length} holidays in one import; the limit is ${MAX_ROWS}. Split it by year.` },
      { status: 400 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          issues.length > 0
            ? "None of those lines could be read as a holiday."
            : "There was nothing to import.",
        imported: 0,
        skipped: 0,
        issues,
      },
      { status: 400 }
    );
  }

  try {
    const outcome = await withTenant(ctx, async (tx) => {
      // Read only the years being imported: importing 2027 should not be
      // slowed by, or deduped against, a decade of history.
      const years = [...new Set(rows.map((row) => row.year))];
      const existing = await tx
        .select({ holidayDate: holidays.holidayDate, name: holidays.name })
        .from(holidays)
        .where(and(eq(holidays.orgId, ctx.orgId), inArray(holidays.year, years)));

      const { toInsert, duplicates } = dedupeAgainstExisting(rows, existing);
      if (toInsert.length === 0) return { inserted: [], duplicates };

      const inserted = await tx
        .insert(holidays)
        .values(
          toInsert.map((row) => ({
            orgId: ctx.orgId,
            name: row.name,
            holidayDate: row.holidayDate,
            isOptional: row.isOptional,
            locationId: parsed.data.locationId ?? null,
            description: row.description,
            // Derived from the date, never accepted separately — the same
            // reasoning as the single-holiday route: two fields that must
            // agree are two fields that eventually will not, and `year` is
            // what every query filters on.
            year: row.year,
          }))
        )
        .returning();

      return { inserted, duplicates };
    });

    return NextResponse.json(
      {
        imported: outcome.inserted.length,
        skipped: outcome.duplicates.length,
        // Named rather than counted: "8 skipped" reads as data loss until you
        // can see they were the eight already on file.
        skippedHolidays: outcome.duplicates.map((row) => ({ name: row.name, holidayDate: row.holidayDate })),
        issues,
        items: outcome.inserted.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      },
      { status: outcome.inserted.length > 0 ? 201 : 200 }
    );
  } catch (error) {
    console.error("Bulk holiday import failed:", error);
    return NextResponse.json({ error: "Could not import these holidays" }, { status: 500 });
  }
}
