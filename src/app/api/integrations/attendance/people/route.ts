import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { employees } from "@/db/schema/hrms";

/** Private server-to-server roster. Site-to-organization mapping is administrator controlled. */
export async function GET(request: NextRequest) {
  const secret = process.env.ATTENDANCE_ROSTER_TOKEN ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || Buffer.byteLength(secret) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const siteId = request.nextUrl.searchParams.get("siteId") ?? "";
    const map: Record<string, string> = JSON.parse(process.env.ATTENDANCE_ROSTER_SITE_ORGS ?? "{}");
    const orgId = map[siteId];
    if (!/^\d+$/.test(siteId) || !orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) {
      return NextResponse.json({ error: "No organization is configured for this attendance site" }, { status: 404 });
    }
    const people = await withTenant({ orgId }, async tx => {
      const rows = await tx.select({ code: employees.employeeCode, firstName: employees.firstName, lastName: employees.lastName, email: employees.workEmail, status: employees.status, deletedAt: employees.deletedAt })
        .from(employees).where(and(eq(employees.orgId, orgId)));
      return rows.map(row => ({ code: row.code, name: `${row.firstName} ${row.lastName}`.trim(), email: row.email ?? "", active: !row.deletedAt && !["terminated", "inactive"].includes(row.status) }));
    });
    return NextResponse.json({ siteId: Number(siteId), people }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to read the attendance roster" }, { status: 500 });
  }
}
