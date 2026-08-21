// ═══════════════════════════════════════════════════════════════
// GET /api/v1/candidate-profile — what somebody entered when they joined
// ═══════════════════════════════════════════════════════════════
// The Career portal asks a new joiner for their education and previous
// employers, and CV-365's profile page has an empty "Work & Education" tab
// asking them to type it all again. This connects the two.
//
// ── Why its own scope ──
// `profiles:read` covers a job title and a department: facts a colleague can
// reasonably see, and the reason it exists is that `employees:read` was too
// much to ask for. Career history is a step further — where somebody studied,
// who they worked for before — so it gets `candidates:read` rather than
// riding along on the narrower one. A key minted so a chat app can label a
// message author has no business reading anybody's employment history.
//
// ── What is deliberately not here ──
// The tables behind this are a joining form, not a CV. They hold previous
// salary, PF and statutory numbers, the employee id a former employer used,
// and the name and phone number of a former reporting manager — a third party
// who never agreed to appear anywhere. See `candidate-profile.ts`: the
// projection is an allowlist, because a redact list would be one forgotten
// column away from putting somebody's old salary on their profile.

import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { withTenant } from "@/db/client";
import { ApiKeyError, apiVersionHeaders, requireApiKey } from "@/lib/api-v1-context";
import {
  toEducation,
  toEmployment,
  type CandidateProfile,
} from "@/lib/candidate-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  email: z.string().trim().email().max(320),
});

function errorResponse(error: unknown) {
  if (error instanceof ApiKeyError) {
    return NextResponse.json(
      {
        error: {
          code: error.status === 429 ? "rate_limited" : "unauthorized",
          message: error.message,
        },
        ...(error.missingScopes ? { missingScopes: error.missingScopes } : {}),
      },
      { status: error.status, headers: apiVersionHeaders() }
    );
  }
  console.error("v1 candidate-profile failure:", error);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Something went wrong" } },
    { status: 500, headers: apiVersionHeaders() }
  );
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireApiKey(request, ["candidates:read"]);

    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "A valid email is required" } },
        { status: 400, headers: apiVersionHeaders() }
      );
    }

    const email = parsed.data.email.toLowerCase();

    const profile = await withTenant(ctx, async (tx) => {
      // The candidate is found by work email, which is the only identifier
      // shared between a CV-365 account and a Career registration.
      const candidate = await tx.execute(sql`
        SELECT id FROM hrms.candidates
         WHERE lower(email) = ${email}
         ORDER BY created_at DESC
         LIMIT 1
      `);

      const candidateId = (candidate.rows?.[0] as { id?: string } | undefined)?.id;
      if (!candidateId) return null;

      const registration = await tx.execute(sql`
        SELECT 1 FROM hrms.candidate_registration
         WHERE candidate_id = ${candidateId}::uuid LIMIT 1
      `);

      // Columns named one by one rather than `SELECT *`. The projection in
      // `candidate-profile.ts` is the guarantee, but not selecting the
      // sensitive columns at all means they are never in memory to leak
      // through a stray log line either.
      const education = await tx.execute(sql`
        SELECT level, institution, board_university, specialisation,
               degree, mode, start_year, end_year
          FROM hrms.candidate_registration_education
         WHERE candidate_id = ${candidateId}::uuid
         ORDER BY seq ASC
      `);

      const employment = await tx.execute(sql`
        SELECT employer, designation, location, from_date, to_date, is_current
          FROM hrms.candidate_registration_employment
         WHERE candidate_id = ${candidateId}::uuid
         ORDER BY seq ASC
      `);

      return {
        registered: (registration.rows?.length ?? 0) > 0,
        education: (education.rows ?? []).map((r) =>
          toEducation(r as Record<string, unknown>)
        ),
        employment: (employment.rows ?? []).map((r) =>
          toEmployment(r as Record<string, unknown>)
        ),
      } satisfies CandidateProfile;
    });

    if (!profile) {
      // Not an error. Most people in the workspace were never candidates —
      // they were added by HR directly — and "no Career registration" is an
      // ordinary answer that the caller renders as an empty section rather
      // than as something being broken.
      return NextResponse.json(
        { found: false, education: [], employment: [], registered: false },
        { headers: apiVersionHeaders() }
      );
    }

    return NextResponse.json({ found: true, ...profile }, { headers: apiVersionHeaders() });
  } catch (error) {
    return errorResponse(error);
  }
}
