// GET /api/reports/fields?source=employees — catalogue for the report designer.
// Restricted fields are omitted rather than returned-and-disabled, so the
// designer cannot reveal that a compensation column exists.

import { NextResponse, type NextRequest } from "next/server";
import { ReportError, SOURCES, availableFields } from "@/lib/reporting/builder";
import { ROLE_PERMISSIONS, type Role } from "@/lib/rbac";
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

  const known: Role[] = ["admin", "hr", "manager", "employee"];
  const permissions = known.includes(ctx.role as Role)
    ? new Set<string>(ROLE_PERMISSIONS[ctx.role as Role])
    : new Set<string>();

  const source = new URL(request.url).searchParams.get("source");

  if (!source) {
    return NextResponse.json({
      sources: Object.values(SOURCES).map((s) => ({ key: s.key, label: s.label })),
    });
  }

  try {
    const fields = availableFields(source, permissions).map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      options: f.options,
      aggregatable: f.aggregatable ?? false,
      groupable: f.groupable ?? false,
    }));
    return NextResponse.json({ source, fields });
  } catch (error) {
    if (error instanceof ReportError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Report field lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
