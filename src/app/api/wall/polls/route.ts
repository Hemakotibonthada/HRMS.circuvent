// ═══════════════════════════════════════════════════════════════
// /api/wall/polls — asking the company a question
// ═══════════════════════════════════════════════════════════════
//
// ─── On anonymity ───
//
// These polls are NOT anonymous, and the clients say so before anybody votes.
//
// A vote row carries the voter's employee id because that is what makes one
// person one vote possible and what lets somebody see and change their own
// answer. The alternative — storing no identity — cannot do either, and a poll
// that can be voted in twenty times is not a poll.
//
// What matters is that this is stated rather than assumed. Somebody answering
// "how do you feel about the new office policy" is entitled to know whether
// their name is attached before they answer, and a poll that feels anonymous
// and is not is worse than one that is honestly attributed.
//
// ─── On counting ───
//
// The latest vote per person wins, and votes are separate rows rather than a
// counter on the poll. A counter means read-modify-write, and two people
// voting in the same second lose one of the votes. Rows cannot lose a write,
// and re-voting is then just another row rather than a mutation.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { inArray, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { employees } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";

export const POLL_KIND = "poll.v1";
export const VOTE_KIND = "poll.vote.v1";
export const POLL_COLLECTION = "socialPosts";

const createSchema = z.object({
  question: z.string().trim().min(3).max(300),
  options: z
    .array(z.string().trim().min(1).max(120))
    .min(2, "A poll needs at least two options.")
    .max(6, "Six options is the most a poll can usefully have."),
});

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
    const payload = await withTenant(ctx, async (tx) => {
      const me = await currentEmployeeId(ctx, tx);

      const pollRows = rowsOf(
        await tx.execute(sql`
          SELECT id, data, created_at, created_by
          FROM hrms.doc_store
          WHERE org_id = ${ctx.orgId}::uuid
            AND collection = ${POLL_COLLECTION}
            AND deleted_at IS NULL
            AND data->>'kind' = ${POLL_KIND}
          ORDER BY created_at DESC
          LIMIT 50
        `)
      );

      const pollIds = pollRows.map((r) => String(r.id));

      const voteRows = pollIds.length
        ? rowsOf(
            await tx.execute(sql`
              SELECT data, created_at
              FROM hrms.doc_store
              WHERE org_id = ${ctx.orgId}::uuid
                AND collection = ${POLL_COLLECTION}
                AND deleted_at IS NULL
                AND data->>'kind' = ${VOTE_KIND}
                AND data->>'pollId' IN (${sql.join(
                  pollIds.map((id) => sql`${id}`),
                  sql`, `
                )})
              ORDER BY created_at ASC
            `)
          )
        : [];

      const authorIds = Array.from(
        new Set(
          pollRows
            .map((r) => String(((r.data ?? {}) as Row).authorEmployeeId ?? ""))
            .filter(Boolean)
        )
      );

      const people = authorIds.length
        ? await tx
            .select({
              id: employees.id,
              firstName: employees.firstName,
              lastName: employees.lastName,
            })
            .from(employees)
            .where(inArray(employees.id, authorIds))
        : [];

      return { me, pollRows, voteRows, people };
    });

    const nameOf = new Map(
      payload.people.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()])
    );

    // Ordered oldest first above, so a later vote by the same person simply
    // overwrites the earlier one. Changing your mind is a re-vote, not an edit.
    const latest = new Map<string, { pollId: string; optionIndex: number }>();
    for (const row of payload.voteRows) {
      const data = (row.data ?? {}) as Row;
      const pollId = String(data.pollId ?? "");
      const voter = String(data.voterEmployeeId ?? "");
      if (!pollId || !voter) continue;
      latest.set(`${pollId}:${voter}`, {
        pollId,
        optionIndex: Number(data.optionIndex ?? -1),
      });
    }

    const polls = payload.pollRows.map((row) => {
      const id = String(row.id);
      const data = (row.data ?? {}) as Row;
      const options = Array.isArray(data.options) ? (data.options as string[]) : [];

      const tally = new Array(options.length).fill(0);
      let myVote: number | null = null;

      for (const [key, vote] of latest) {
        if (vote.pollId !== id) continue;
        if (vote.optionIndex >= 0 && vote.optionIndex < tally.length) {
          tally[vote.optionIndex] += 1;
        }
        if (payload.me && key.endsWith(`:${payload.me}`)) myVote = vote.optionIndex;
      }

      return {
        id,
        question: String(data.question ?? ""),
        options,
        votes: tally,
        totalVotes: tally.reduce((a: number, b: number) => a + b, 0),
        myVote,
        authorName: nameOf.get(String(data.authorEmployeeId ?? "")) ?? null,
        createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : null,
        // Restated on every response so a client cannot forget to say it.
        anonymous: false,
      };
    });

    return NextResponse.json({ items: polls });
  } catch (error) {
    console.error("Poll list failed:", error);
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
      { error: parsed.error.issues[0]?.message ?? "Invalid poll" },
      { status: 400 }
    );
  }

  // Two options with the same words are a mistake every time, and they split a
  // result between them in a way nobody can interpret afterwards.
  const unique = new Set(parsed.data.options.map((o) => o.toLowerCase()));
  if (unique.size !== parsed.data.options.length) {
    return NextResponse.json(
      { error: "Two options say the same thing." },
      { status: 422 }
    );
  }

  try {
    const outcome = await withTenant(ctx, async (tx) => {
      const authorEmployeeId = await currentEmployeeId(ctx, tx);
      if (!authorEmployeeId) {
        return { error: "Only an employee can post a poll.", status: 403 as const };
      }

      await tx.execute(sql`
        INSERT INTO hrms.doc_store (org_id, collection, data, created_by)
        VALUES (
          ${ctx.orgId}::uuid,
          ${POLL_COLLECTION},
          ${JSON.stringify({
            kind: POLL_KIND,
            question: parsed.data.question,
            options: parsed.data.options,
            authorEmployeeId,
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
    console.error("Poll create failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
