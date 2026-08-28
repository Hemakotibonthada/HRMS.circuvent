// ═══════════════════════════════════════════════════════════════
// HRMS API — hires ready to be added as employees
// ═══════════════════════════════════════════════════════════════
// The Add Employee dialog now has to name the candidate a person was hired as,
// because `POST /api/employees` refuses a hire with no offer behind it. This is
// what fills that picker.
//
// It deliberately returns the same judgement the create endpoint will apply,
// rather than a list of every candidate: an HR user who can select somebody the
// server will then refuse has been set up to fail, and the refusal arrives
// after they have typed the whole form.
//
// ── Why it lists people who are not quite ready, too ──
// A candidate who accepted but has not submitted their joining form is exactly
// the case HR needs to see and chase; hiding them would leave HR wondering why
// somebody they know accepted is missing. They come back with `ready: false`
// and the reason, so the dialog can show them disabled with the fix.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";

import { withTenant } from "@/db/client";
import { candidates, offers } from "@/db/schema";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";
import { checkHireProvenance } from "@/lib/hire-provenance";
import { mostAdvanced } from "@/db/repositories/hire-provenance.neon";

const querySchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export interface PendingHire {
  candidateId: string;
  applicationId: string | null;
  name: string;
  email: string;
  designation: string | null;
  offerStatus: string | null;
  registrationSubmittedAt: string | null;
  ready: boolean;
  /** Empty when ready; otherwise what HR has to resolve first. */
  blockers: string[];
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limitCheck = checkRateLimit(clientIdentifier(request, ctx.userId), 120, 60_000);
  if (!limitCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil((limitCheck.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const search = parsed.data.search?.trim();
  const limit = parsed.data.limit ?? 50;

  try {
    const items = await withTenant({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      // Everyone with an offer that has gone somewhere, newest first. The
      // status filter is deliberately wide — `checkHireProvenance` decides
      // what counts, and duplicating that decision in SQL is how the two
      // would drift apart.
      const rows = await tx
        .select({
          candidateId: candidates.id,
          firstName: candidates.firstName,
          lastName: candidates.lastName,
          email: candidates.email,
          designation: candidates.currentDesignation,
          offerStatus: offers.status,
          applicationId: offers.applicationId,
        })
        .from(offers)
        .innerJoin(candidates, eq(candidates.id, offers.candidateId))
        .where(
          and(
            eq(offers.orgId, ctx.orgId),
            isNotNull(offers.candidateId),
            search
              ? or(
                  ilike(candidates.firstName, `%${search}%`),
                  ilike(candidates.lastName, `%${search}%`),
                  ilike(candidates.email, `%${search}%`)
                )
              : undefined
          )
        )
        .orderBy(desc(offers.createdAt))
        .limit(500);

      if (rows.length === 0) return [] as PendingHire[];

      // Collapsed to one entry per candidate, keeping their most advanced
      // offer rather than their newest: a withdrawn revision must not hide an
      // acceptance. Same comparator `loadHireProvenance` uses, imported rather
      // than rewritten.
      const byCandidate = new Map<string, typeof rows>();
      for (const row of rows) {
        const list = byCandidate.get(row.candidateId) ?? [];
        list.push(row);
        byCandidate.set(row.candidateId, list);
      }

      const candidateIds = [...byCandidate.keys()];

      // `hrms.employees.candidate_id` comes from ATS's migration 010 and is
      // not in this app's Drizzle schema, so it is read as raw SQL.
      //
      // `sql.param` around the array is load-bearing: interpolating a JS array
      // directly expands it to a tuple — `ANY(($1, $2)::uuid[])` — which
      // Postgres rejects. Bound as one parameter it is a real array.
      const hired = await tx.execute(
        sql`SELECT candidate_id::text AS candidate_id
              FROM hrms.employees
             WHERE candidate_id = ANY(${sql.param(candidateIds)}::uuid[])
               AND deleted_at IS NULL`
      );
      const alreadyHired = new Set(
        ((hired as unknown as { rows?: Array<{ candidate_id: string }> }).rows ?? []).map((row) =>
          String(row.candidate_id)
        )
      );

      const registrations = await tx.execute(
        sql`SELECT candidate_id::text AS candidate_id, submitted_at
              FROM hrms.candidate_registration
             WHERE candidate_id = ANY(${sql.param(candidateIds)}::uuid[])`
      );
      const submittedAt = new Map<string, string | null>();
      for (const row of (
        registrations as unknown as {
          rows?: Array<{ candidate_id: string; submitted_at: string | Date | null }>;
        }
      ).rows ?? []) {
        submittedAt.set(
          String(row.candidate_id),
          row.submitted_at ? new Date(row.submitted_at).toISOString() : null
        );
      }

      const results: PendingHire[] = [];
      for (const [candidateId, group] of byCandidate) {
        if (alreadyHired.has(candidateId)) continue;

        const best = mostAdvanced(group.map((row) => String(row.offerStatus)));
        const primary = group.find((row) => String(row.offerStatus) === best) ?? group[0];
        const registration = submittedAt.get(candidateId) ?? null;

        const verdict = checkHireProvenance({
          candidateId,
          applicationId: primary.applicationId ?? null,
          offerStatus: best,
          registrationSubmittedAt: registration,
        });

        results.push({
          candidateId,
          applicationId: primary.applicationId ?? null,
          name: `${primary.firstName ?? ""} ${primary.lastName ?? ""}`.trim(),
          email: primary.email ?? "",
          designation: primary.designation ?? null,
          offerStatus: best,
          registrationSubmittedAt: registration,
          ready: verdict.ok,
          blockers: verdict.ok ? [] : verdict.issues.map((issue) => issue.message),
        });
      }

      // Ready first, then alphabetically. HR's ordinary case is "add the
      // person who just accepted", not "read a list".
      results.sort((a, b) =>
        a.ready === b.ready ? a.name.localeCompare(b.name) : a.ready ? -1 : 1
      );
      return results.slice(0, limit);
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Pending hires lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
