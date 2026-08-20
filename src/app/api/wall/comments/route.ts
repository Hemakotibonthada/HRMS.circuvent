// ═══════════════════════════════════════════════════════════════
// /api/wall/comments — replies on a wall post
// ═══════════════════════════════════════════════════════════════
//
// The wall showed a comment count and had no comments behind it. Nothing could
// write one and nothing could read one, so the number was either zero or left
// over from seed data — a post claiming three replies that nobody could open.
// On the one screen whose entire purpose is making people feel heard, that is
// the worst possible thing to get wrong.
//
// Each comment is its own `doc_store` row rather than an entry appended to the
// post's JSON. Appending means read, modify, write, and two people replying at
// the same moment would silently lose one of them. A row per comment cannot
// lose a write, and the count is derived rather than stored, so it can never
// disagree with the replies actually present.
//
// The author is the session, never the body — the same rule as praise, for the
// same reason.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { inArray, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { employees } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";

const KIND = "comment.v1";
const COLLECTION = "socialPosts";

const listSchema = z.object({ postId: z.string().min(1).max(64) });

const createSchema = z.object({
  postId: z.string().min(1).max(64),
  body: z.string().trim().min(1).max(1000),
});

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  const maybe = result as { rows?: Row[] };
  return maybe?.rows ?? [];
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const parsed = listSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "A post id is required" }, { status: 400 });
  }

  try {
    const payload = await withTenant(ctx, async (tx) => {
      const result = await tx.execute(sql`
        SELECT id, data, created_at
        FROM hrms.doc_store
        WHERE org_id = ${ctx.orgId}::uuid
          AND collection = ${COLLECTION}
          AND deleted_at IS NULL
          AND data->>'kind' = ${KIND}
          AND data->>'postId' = ${parsed.data.postId}
        ORDER BY created_at ASC
        LIMIT 200
      `);

      const comments = rowsOf(result).map((r) => {
        const data = (r.data ?? {}) as Record<string, unknown>;
        return {
          id: String(r.id),
          createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
          body: String(data.body ?? ""),
          authorEmployeeId: String(data.authorEmployeeId ?? ""),
        };
      });

      const ids = Array.from(new Set(comments.map((c) => c.authorEmployeeId).filter(Boolean)));
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

      return { comments, people };
    });

    // Names resolved at read time, not copied onto the comment. A name stored
    // beside the text goes stale the day somebody changes it.
    const person = new Map(
      payload.people.map((p) => [
        p.id,
        { name: `${p.firstName} ${p.lastName}`.trim(), avatarUrl: p.avatarUrl },
      ])
    );

    return NextResponse.json({
      items: payload.comments.map((c) => ({
        id: c.id,
        createdAt: c.createdAt,
        body: c.body,
        authorName: person.get(c.authorEmployeeId)?.name ?? null,
        authorAvatarUrl: person.get(c.authorEmployeeId)?.avatarUrl ?? null,
      })),
    });
  } catch (error) {
    console.error("Wall comments list failed:", error);
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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid comment" },
      { status: 400 }
    );
  }

  try {
    const outcome = await withTenant(ctx, async (tx) => {
      const authorEmployeeId = await currentEmployeeId(ctx, tx);
      if (!authorEmployeeId) {
        return { error: "Only an employee can comment.", status: 403 as const };
      }

      // The post must exist in this organisation. `withTenant` scopes the read,
      // so an id from another tenant simply does not resolve — a comment
      // cannot be attached to a post its author cannot see.
      const found = rowsOf(
        await tx.execute(sql`
          SELECT id FROM hrms.doc_store
          WHERE org_id = ${ctx.orgId}::uuid
            AND collection = ${COLLECTION}
            AND deleted_at IS NULL
            AND id::text = ${parsed.data.postId}
          LIMIT 1
        `)
      );

      if (!found.length) {
        return { error: "That post was not found.", status: 404 as const };
      }

      const row = {
        kind: KIND,
        postId: parsed.data.postId,
        authorEmployeeId,
        body: parsed.data.body,
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
    console.error("Wall comment create failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
