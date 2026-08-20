// GET /api/governance/subject-access — everything held about one person.
//
// Someone may always request their own. Requesting another person's is an HR
// action, because the response contains their full personnel record.

import { NextResponse, type NextRequest } from "next/server";
import { NeonGovernanceRepository } from "@/db/repositories/governance.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  // Assembling one of these reads the whole personnel record across several
  // tables, so it is deliberately expensive to request repeatedly.
  const limit = checkRateLimit(`sar:${ctx.userId}`, 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const requested = new URL(request.url).searchParams.get("employeeId");
  const privileged = ["owner", "admin", "hr"].includes(ctx.role);

  try {
    // ctx.userId is the signing-in account, not the employment record this
    // report is keyed by — see lib/current-employee.ts.
    const self = await currentEmployeeId(ctx);

    if (requested && requested !== self && !privileged) {
      return NextResponse.json(
        { error: "You can only request your own data" },
        { status: 403 }
      );
    }

    const employeeId = requested ?? self;
    if (!employeeId) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const result = await new NeonGovernanceRepository(ctx).subjectAccess(employeeId);
    return NextResponse.json(result, {
      headers: {
        // A subject-access response is the densest personal data the system
        // produces. It must not sit in a shared cache or a browser's disk
        // cache after the tab is closed.
        "Cache-Control": "no-store, private",
        "Content-Disposition": `attachment; filename="subject-access-${employeeId}.json"`,
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Subject access assembly failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
