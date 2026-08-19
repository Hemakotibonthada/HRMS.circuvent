// GET/POST /api/benefits/dependants — the people an employee covers.
//
// Always scoped to the caller. A dependant list is family and health data;
// exposing a colleague's would be a privacy breach regardless of role, so even
// HR reads it through the employee-scoped route rather than by id here.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonBenefitsRepository } from "@/db/repositories/benefits.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { describeIssues, toFieldIssues } from "@/lib/validation-response";

const addSchema = z.object({
  fullName: z.string().trim().min(2, "Enter their name").max(150),
  relation: z.enum(["spouse", "child", "parent", "parent_in_law", "sibling", "other"]),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).optional(),
  identifier: z.string().trim().max(64).optional(),
  isNominee: z.boolean().optional(),
  nomineeSharePercent: z.number().int().min(0).max(100).optional(),
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
    const rows = await new NeonBenefitsRepository(ctx).listDependants(ctx.userId);
    return NextResponse.json({
      dependants: rows.map((d) => ({
        id: d.id,
        fullName: d.fullName,
        relation: d.relation,
        dateOfBirth: d.dateOfBirth,
        gender: d.gender,
        isNominee: d.isNominee,
        nomineeSharePercent: d.nomineeSharePercent,
        // The identity document reference is never returned. It is stored for
        // insurer submission, not for display, and echoing it back puts it in
        // browser history and logs.
      })),
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Dependant lookup failed:", error);
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

  const parsed = addSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: describeIssues(toFieldIssues(parsed.error)), issues: toFieldIssues(parsed.error) },
      { status: 400 }
    );
  }

  // A nominee without a share leaves their entitlement undefined, which a
  // court resolves rather than the policy.
  if (parsed.data.isNominee && parsed.data.nomineeSharePercent === undefined) {
    return NextResponse.json(
      { error: "A nominee needs a share percentage" },
      { status: 400 }
    );
  }

  try {
    const id = await new NeonBenefitsRepository(ctx).addDependant(ctx.userId, parsed.data);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Adding a dependant failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
