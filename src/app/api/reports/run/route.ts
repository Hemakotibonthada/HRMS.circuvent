// ═══════════════════════════════════════════════════════════════
// POST /api/reports/run — execute a user-defined report
// ═══════════════════════════════════════════════════════════════
// The report definition arrives from the browser, so this is the one endpoint
// where user input shapes a SQL query. Everything that makes that safe lives
// in src/lib/reporting/builder.ts: field names resolve against a fixed
// catalogue and values are always bound.
//
// Two further protections apply here:
//
//  * The query runs inside withTenant(), so row-level security constrains it
//    to the caller's organization no matter what the definition says.
//  * Field-level permissions are derived from the caller's role, not sent by
//    the client, so nobody can request compensation columns by asserting they
//    are allowed to.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sql, type SQL, type SQLChunk } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { ReportError, compileReport } from "@/lib/reporting/builder";
import { ROLE_PERMISSIONS, type Role } from "@/lib/rbac";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";

/**
 * Converts the builder's `$1…$n` output into a Drizzle SQL object.
 *
 * `sql.raw` takes no parameters, so the text is split on its placeholders and
 * the values are re-interleaved as bound parameters. The values never touch
 * the raw chunks, which is what keeps them parameterised end to end.
 */
function toDrizzleSql(text: string, params: unknown[]): SQL {
  const parts = text.split(/\$(\d+)/);
  const chunks: SQLChunk[] = [];

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) chunks.push(sql.raw(parts[i]));
    } else {
      const index = Number(parts[i]) - 1;
      if (index < 0 || index >= params.length) {
        throw new ReportError("Report compiled with a placeholder that has no value");
      }
      chunks.push(sql`${params[index]}`);
    }
  }

  return sql.join(chunks);
}

const filterSchema = z.object({
  field: z.string().max(64),
  operator: z.enum([
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "not_in",
    "contains",
    "between",
    "is_null",
    "is_not_null",
  ]),
  value: z.unknown().optional(),
});

const definitionSchema = z.object({
  source: z.string().max(64),
  fields: z.array(z.string().max(64)).max(50),
  filters: z.array(filterSchema).max(25).optional(),
  groupBy: z.array(z.string().max(64)).max(10).optional(),
  aggregations: z
    .array(
      z.object({
        field: z.string().max(64),
        function: z.enum(["count", "sum", "avg", "min", "max"]),
        alias: z.string().max(64),
      })
    )
    .max(10)
    .optional(),
  sortBy: z
    .array(z.object({ field: z.string().max(64), direction: z.enum(["asc", "desc"]) }))
    .max(5)
    .optional(),
  limit: z.number().int().min(1).max(50_000).optional(),
  offset: z.number().int().min(0).optional(),
});

/** Permissions the caller holds, taken from their role rather than the request. */
function permissionsFor(role: string): Set<string> {
  const known: Role[] = ["admin", "hr", "manager", "employee"];
  if (!known.includes(role as Role)) return new Set();
  return new Set(ROLE_PERMISSIONS[role as Role]);
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    // Reporting reaches across the whole organization, so it is not an
    // employee-level capability.
    ctx = await requireApiContext(request, ["owner", "admin", "hr", "manager"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // Reports are expensive by nature — grouped scans over the whole tenant —
  // so the limit is much tighter than for ordinary reads.
  const limit = checkRateLimit(`report:${ctx.userId}`, 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many reports. Please wait a moment." },
      { status: 429 }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid report definition" },
      { status: 400 }
    );
  }

  let compiled;
  try {
    compiled = compileReport(parsed.data, permissionsFor(ctx.role));
  } catch (error) {
    if (error instanceof ReportError) {
      // A rejected field name is the report author's mistake, not a server
      // fault, and the message is safe to show.
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  try {
    const rows = await withTenant(ctx, async (tx) => {
      // A runaway grouped scan should fail rather than hold a connection open
      // for minutes while the pool starves.
      await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
      const result = await tx.execute(toDrizzleSql(compiled.sql, compiled.params));
      return result.rows;
    });

    return NextResponse.json({ columns: compiled.columns, rows, rowCount: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("statement timeout") || message.includes("canceling statement")) {
      return NextResponse.json(
        { error: "The report took too long. Add filters to narrow it down." },
        { status: 504 }
      );
    }
    // The compiled SQL is not returned: it names internal tables and columns.
    console.error("Report execution failed:", error);
    return NextResponse.json({ error: "The report could not be run" }, { status: 500 });
  }
}
