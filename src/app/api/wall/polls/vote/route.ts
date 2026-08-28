// ═══════════════════════════════════════════════════════════════
// POST /api/wall/polls/vote — answering, or changing your answer
// ═══════════════════════════════════════════════════════════════
//
// A vote is a new row rather than an update to an existing one. Two people
// voting in the same second cannot lose each other's write, and somebody
// changing their mind is another row rather than a mutation — which means the
// history of a poll survives even though only the latest answer counts.
//
// The voter is the session, never the body. A poll whose votes could be
// attributed to anybody by the sender is not a poll, it is a form.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";
import { POLL_COLLECTION, POLL_KIND, VOTE_KIND } from "../route";

const schema = z.object({
  pollId: z.string().min(1).max(64),
  optionIndex: z.number().int().min(0).max(5),
});

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return (result as { rows?: Row[] })?.rows ?? [];
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

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid vote" }, { status: 400 });
  }

  try {
    const outcome = await withTenant(ctx, async (tx) => {
      const voterEmployeeId = await currentEmployeeId(ctx, tx);
      if (!voterEmployeeId) {
        return { error: "Only an employee can vote.", status: 403 as const };
      }

      // The poll must exist in this organisation, and the option must be one it
      // actually offers. Without the second check a vote could be recorded
      // against option 5 of a two-option poll and simply never appear in any
      // tally — a vote silently discarded is worse than one refused.
      const found = rowsOf(
        await tx.execute(sql`
          SELECT data FROM hrms.doc_store
          WHERE org_id = ${ctx.orgId}::uuid
            AND collection = ${POLL_COLLECTION}
            AND deleted_at IS NULL
            AND data->>'kind' = ${POLL_KIND}
            AND id::text = ${parsed.data.pollId}
          LIMIT 1
        `)
      );

      if (!found.length) {
        return { error: "That poll was not found.", status: 404 as const };
      }

      const options = ((found[0].data ?? {}) as Row).options;
      const count = Array.isArray(options) ? options.length : 0;
      if (parsed.data.optionIndex >= count) {
        return { error: "That option is not on this poll.", status: 422 as const };
      }

      await tx.execute(sql`
        INSERT INTO hrms.doc_store (org_id, collection, data, created_by)
        VALUES (
          ${ctx.orgId}::uuid,
          ${POLL_COLLECTION},
          ${JSON.stringify({
            kind: VOTE_KIND,
            pollId: parsed.data.pollId,
            optionIndex: parsed.data.optionIndex,
            voterEmployeeId,
          })}::jsonb,
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
    console.error("Poll vote failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
