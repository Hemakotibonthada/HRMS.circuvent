// Direct reports for the org chart and reporting-line pickers.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

const paramsSchema = z.object({ id: z.string().uuid("Invalid employee id") });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    // The reporting structure is visible to everyone — it is what the org
    // chart renders — but compensation is not exposed on this route.
    ctx = await requireApiContext(request, ["owner", "admin", "hr", "manager", "employee"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
  }

  try {
    const reports = await new NeonEmployeeRepository(ctx).listDirectReports(parsed.data.id);
    return NextResponse.json(reports.map(({ salary: _salary, ...rest }) => rest));
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Direct reports lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
