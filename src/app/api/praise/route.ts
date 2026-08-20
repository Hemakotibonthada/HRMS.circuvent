// ═══════════════════════════════════════════════════════════════
// /api/praise — recognising a colleague, attributably
// ═══════════════════════════════════════════════════════════════
//
// Recognition already existed on the web, and its "from" was a text box. Anyone
// could type any name into it, and the same free text was counted into a
// leaderboard. Praise you can forge is worth nothing to the person receiving it
// and worse than nothing when it is ranked.
//
// So: the giver is taken from the session and never from the body, the
// recipient is an employee id that must resolve inside the caller's own
// organisation, and neither is a string somebody typed.
//
// Stored in `doc_store` rather than a table of its own, deliberately. Praise is
// free-form text with no relationships anything else depends on — the same
// reasoning the collection route gives for wall posts — and `hrms.ts` is at its
// TypeScript inference ceiling, where adding a table makes tsc report an
// employees row as not assignable to itself. Rows carry `kind: "praise.v1"` so
// the web's older, differently shaped kudos rows are skipped rather than
// rendered as though a name were missing.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq, inArray, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { employees } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";

const KIND = "praise.v1";
const COLLECTION = "kudos";

/**
 * The values praise can be given for.
 *
 * A closed list, because an open one becomes a tag cloud nobody can report on,
 * and because these are the words the organisation has already chosen.
 */
export const PRAISE_VALUES = [
  "teamwork",
  "ownership",
  "craft",
  "customer",
  "kindness",
] as const;

const createSchema = z.object({
  toEmployeeId: z.string().uuid(),
  value: z.enum(PRAISE_VALUES),
  message: z.string().trim().min(3).max(600),
});

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    const payload = await withTenant(ctx, async (tx) => {
      const result = (await tx.execute(sql`
        SELECT id, data, created_at
        FROM hrms.doc_store
        WHERE org_id = ${ctx.orgId}::uuid
          AND collection = ${COLLECTION}
          AND deleted_at IS NULL
          AND data->>'kind' = ${KIND}
        ORDER BY created_at DESC
        LIMIT 100
      `)) as unknown as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;

      const items: Array<Record<string, unknown>> = Array.isArray(result)
        ? result
        : result.rows ?? [];

      const parsed = items.map((r) => {
        const data = (r.data ?? {}) as Record<string, unknown>;
        return {
          id: String(r.id),
          createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
          fromEmployeeId: String(data.fromEmployeeId ?? ""),
          toEmployeeId: String(data.toEmployeeId ?? ""),
          value: String(data.value ?? ""),
          message: String(data.message ?? ""),
        };
      });

      // Names are resolved at read time rather than copied into the row. A
      // name stored alongside the praise goes stale the day somebody marries,
      // and a recognition wall showing a former name is a small cruelty.
      const ids = Array.from(
        new Set(parsed.flatMap((p) => [p.fromEmployeeId, p.toEmployeeId]).filter(Boolean))
      );

      const people = ids.length
        ? await tx
            .select({
              id: employees.id,
              firstName: employees.firstName,
              lastName: employees.lastName,
              avatarUrl: employees.avatarUrl,
            })
            .from(employees)
            .where(inArray(employees.id, ids))
        : [];

      return { parsed, people };
    });

    const person = new Map(
      payload.people.map((p) => [
        p.id,
        { name: `${p.firstName} ${p.lastName}`.trim(), avatarUrl: p.avatarUrl },
      ])
    );

    // A row whose subject has left, or was never resolvable, is dropped rather
    // than rendered as praise for nobody.
    const items = payload.parsed
      .filter((p) => person.has(p.toEmployeeId))
      .map((p) => ({
        id: p.id,
        createdAt: p.createdAt,
        value: p.value,
        message: p.message,
        toName: person.get(p.toEmployeeId)!.name,
        toAvatarUrl: person.get(p.toEmployeeId)!.avatarUrl,
        fromName: person.get(p.fromEmployeeId)?.name ?? null,
      }));

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Praise list failed:", error);
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid praise" },
      { status: 400 }
    );
  }

  try {
    const outcome = await withTenant(ctx, async (tx) => {
      const fromEmployeeId = await currentEmployeeId(ctx, tx);
      if (!fromEmployeeId) {
        return { error: "Only an employee can give praise.", status: 403 as const };
      }

      // Praising yourself is not a thing the leaderboard should have to defend
      // against later.
      if (fromEmployeeId === parsed.data.toEmployeeId) {
        return { error: "Praise is for somebody else.", status: 422 as const };
      }

      // The recipient must exist in this organisation. `withTenant` scopes the
      // read, so an id from another tenant simply does not resolve.
      const [recipient] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.id, parsed.data.toEmployeeId))
        .limit(1);

      if (!recipient) {
        return { error: "That colleague was not found.", status: 404 as const };
      }

      const row = {
        kind: KIND,
        fromEmployeeId,
        toEmployeeId: parsed.data.toEmployeeId,
        value: parsed.data.value,
        message: parsed.data.message,
      };

      await tx.execute(sql`
        INSERT INTO hrms.doc_store (org_id, collection, data, created_by)
        VALUES (
          ${ctx.orgId}::uuid,
          ${COLLECTION},
          ${JSON.stringify(row)}::jsonb,
          ${ctx.userId}::uuid
        )
      `);

      return { ok: true as const };
    });

    if ("error" in outcome) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("Praise create failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
