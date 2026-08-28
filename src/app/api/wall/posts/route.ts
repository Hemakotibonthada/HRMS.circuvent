// ═══════════════════════════════════════════════════════════════
// GET /api/wall/posts — the feed, and only the feed
// ═══════════════════════════════════════════════════════════════
//
// The wall used to read `/api/collections/socialPosts` directly, which returns
// every document in that collection. Replies, polls and poll votes are stored
// there too — a row per comment and a row per vote, deliberately, so that
// concurrent writes cannot lose each other — and every one of them rendered in
// the feed as a post with no author and no words.
//
// It was visible the moment a poll existed: two blank cards saying "Someone"
// under the poll that had just created them. Comments had been doing it for
// longer and nobody had looked, because a wall with no comments has nothing to
// leak.
//
// Genuine posts are the rows with no `kind`. Everything written since carries
// one, so the filter is "no kind, or the post kind", and nothing has to be
// migrated for it to be right.

import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

const COLLECTION = "socialPosts";

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return (result as { rows?: Row[] })?.rows ?? [];
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    const rows = await withTenant(ctx, async (tx) =>
      rowsOf(
        await tx.execute(sql`
          SELECT id, data, created_at
          FROM hrms.doc_store
          WHERE org_id = ${ctx.orgId}::uuid
            AND collection = ${COLLECTION}
            AND deleted_at IS NULL
            AND (data->>'kind' IS NULL OR data->>'kind' = 'post.v1')
          ORDER BY created_at DESC
          LIMIT 100
        `)
      )
    );

    const items = rows.map((r) => {
      const data = (r.data ?? {}) as Row;
      return {
        id: String(r.id),
        author: String(data.author ?? ""),
        department: String(data.department ?? ""),
        content: String(data.content ?? ""),
        tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
        likes: Number(data.likes ?? 0),
        comments: Number(data.comments ?? 0),
        shares: Number(data.shares ?? 0),
        liked: Boolean(data.liked ?? false),
        type: String(data.type ?? "post"),
        createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : "",
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Wall posts failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
