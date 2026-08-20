// ═══════════════════════════════════════════════════════════════
// GET /api/v1/profiles — the one place the ecosystem reads a colleague
// ═══════════════════════════════════════════════════════════════
// Every app in the suite wants to put a job title and an avatar next to a
// name: CV-365 on the profile page and in member pickers, Mail beside a
// sender, Paystub on the self-service screen. Each was either asking people
// to retype facts HR already holds, or holding an `employees:read` key that
// could read the whole record — pay, bank details, PAN, Aadhaar, home
// address — in order to render a job title.
//
// So this serves the profile and nothing else, under its own `profiles:read`
// scope. A key minted for a chat app cannot answer "what does this person
// earn", because the scope that reaches this route reaches nothing else.
//
// ── Why the response carries field ownership ──
// Consumers need to know which fields to render read-only and where to send
// somebody who wants them changed. Five apps each deciding that for
// themselves will disagree within a release or two, and the one that guesses
// wrong shows an editable box over a value it cannot save. So the answer
// travels with the data.
//
// ── What this route deliberately cannot do ──
// Write. Employment facts change in HRMS, by HR, through
// `/api/employees/[id]`; personal details change through
// `/api/employees/me`, by the person themselves, against an allowlist. Both
// already exist and already enforce that split. A write path here would be a
// third opinion about who may change what.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";
import { RepositoryError } from "@/db/repositories/types";
import { ApiKeyError, apiVersionHeaders, requireApiKey } from "@/lib/api-v1-context";
import {
  PROFILE_FIELD_OWNERS,
  toEmployeeProfile,
  type EmployeeProfile,
} from "@/lib/employee-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  /**
   * One address, or several separated by commas. Batch matters: a message
   * list showing twenty senders should cost one request, not twenty, or
   * consumers will cache hard and show a stale job title for a week.
   */
  email: z.string().trim().max(4000).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
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
  if (error instanceof RepositoryError) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: error.message } },
      { status: error.status, headers: apiVersionHeaders() }
    );
  }
  console.error("v1 profiles failure:", error);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Something went wrong" } },
    { status: 500, headers: apiVersionHeaders() }
  );
}

export async function GET(request: NextRequest) {
  try {
    // Authenticate first, then decide about scope here rather than in
    // `requireApiKey`, which requires *all* of the scopes it is given. Either
    // scope may read a profile: `profiles:read` because that is what it is
    // for, and `employees:read` because a key that can already read the whole
    // record is not made safer by being refused the summary of it. The point
    // of the narrow scope is that new consumers can be given only it.
    const ctx = await requireApiKey(request, []);
    if (!ctx.scopes.includes("profiles:read") && !ctx.scopes.includes("employees:read")) {
      throw new ApiKeyError(
        "This key is missing the required scope(s): profiles:read",
        403,
        ["profiles:read"]
      );
    }

    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams)
    );
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_request",
            message: parsed.error.issues[0]?.message ?? "Invalid query",
          },
        },
        { status: 400, headers: apiVersionHeaders() }
      );
    }

    const { email, search, page, pageSize } = parsed.data;
    // The whole context is the tenant handle, not the org id — the repository
    // uses it to set the row-level-security scope for the connection.
    const repo = new NeonEmployeeRepository(ctx);

    let profiles: EmployeeProfile[];
    let total: number;

    if (email) {
      const wanted = email
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@"))
        .slice(0, 100);

      if (wanted.length === 0) {
        return NextResponse.json(
          { error: { code: "invalid_request", message: "No valid email addresses supplied" } },
          { status: 400, headers: apiVersionHeaders() }
        );
      }

      // One pass over the tenant rather than a query per address. Two
      // employees today; the shape matters more than the scale.
      const all = await repo.list({ pageSize: 500 });
      const bySet = new Set(wanted);
      profiles = all.items
        .filter((e) => bySet.has((e.email ?? "").toLowerCase()))
        .map(toEmployeeProfile);
      total = profiles.length;
    } else {
      const result = await repo.list({
        search,
        page: page ?? 1,
        pageSize: pageSize ?? 50,
      });
      profiles = result.items.map(toEmployeeProfile);
      total = result.total;
    }

    return NextResponse.json(
      {
        data: profiles,
        pagination: { page: page ?? 1, pageSize: pageSize ?? 50, total },
        /**
         * Who may change what, and where. Sent so no consumer has to hold an
         * opinion about which fields are editable.
         */
        fields: PROFILE_FIELD_OWNERS,
        managedBy: {
          hr: "Employment facts are maintained by HR in HRMS.",
          self: "The employee maintains these about themselves.",
          editUrl: "/employees",
          selfEditUrl: "/self-service/profile",
        },
      },
      { headers: apiVersionHeaders() }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
