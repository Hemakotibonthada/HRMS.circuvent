// POST /api/employees/sync-registration
//
// Fills employee records from the joining form the person completed on the
// Careers portal. Available to HR on demand as well as nightly from the cron
// sweep, because the nightly run is no use to somebody who has just noticed a
// blank date of birth on a profile and wants it fixed now.
//
// Fills only what is empty, so calling it repeatedly is safe and cannot revert
// a correction HR has typed. See `lib/registration-sync.ts` for the rule and
// for what it deliberately refuses to copy.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { RepositoryError } from "@/db/repositories/types";
import { syncEmployeesFromRegistration } from "@/db/repositories/registration-sync.neon";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, clientIdentifier, requireApiContext } from "@/lib/api-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  /** One employee, or every employee with a submitted registration. */
  employeeId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(clientIdentifier(request, ctx.userId), 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  let parsed: z.infer<typeof bodySchema> = {};
  try {
    const raw = await request.json().catch(() => ({}));
    const result = bodySchema.safeParse(raw ?? {});
    if (!result.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    parsed = result.data;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const summary = await syncEmployeesFromRegistration(
      { orgId: ctx.orgId, userId: ctx.userId },
      { employeeId: parsed.employeeId }
    );

    return NextResponse.json({
      considered: summary.considered,
      updated: summary.updated,
      // Returned per employee so HR can see which fields were filled rather
      // than a count that tells them nothing about whether it worked.
      outcomes: summary.outcomes,
      note:
        "Statutory numbers (PAN, Aadhaar, UAN, PF, ESI) are not copied: the registration " +
        "holds them encrypted under the ATS key and HRMS reads its own columns with a " +
        "different one, so the ciphertext would not be readable here.",
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Registration sync failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
