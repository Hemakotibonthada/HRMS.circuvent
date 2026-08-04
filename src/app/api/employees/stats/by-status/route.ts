// Headcount by employment status, for the dashboard summary cards.
// Aggregated in SQL rather than by shipping every employee to the browser and
// counting there, which is what the Firestore path had to do.

import { NextResponse, type NextRequest } from "next/server";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr", "manager"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    return NextResponse.json(await new NeonEmployeeRepository(ctx).countByStatus());
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Headcount aggregation failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
