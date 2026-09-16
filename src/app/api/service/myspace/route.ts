import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { organizations, users, userRoles } from "@/db/schema/identity";
import { NeonEmployeeRepository } from "@/db/repositories/employee.neon";
import { toEmployeeProfile } from "@/lib/employee-profile";
import { myspaceActor } from "@/lib/myspace-actor";
import { checkRateLimit } from "@/lib/api-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  try {
    const email = await myspaceActor(request.headers.get("authorization")?.replace(/^Bearer /, "") || "", "hrms");
    if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    if (!checkRateLimit(`myspace:${email}`, 120, 60_000).allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers });
    // The only cross-tenant lookup resolves an already-verified exact identity.
    // All employee reads below use the resulting org's normal RLS context.
    const actors = await withTenant({ orgId: "", superuser: true }, tx => tx
      .select({ id: users.id, orgId: users.orgId, role: userRoles.role })
      .from(users)
      .innerJoin(organizations, and(eq(organizations.id, users.orgId), isNull(organizations.deletedAt)))
      .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.orgId, users.orgId), eq(userRoles.app, "hrms")))
      .where(and(sql`lower(${users.email}) = ${email}`, eq(users.status, "active"), isNull(users.deletedAt)))
      .limit(2));
    if (actors.length !== 1 || !["owner", "admin"].includes(actors[0].role)) {
      return NextResponse.json({ error: "HRMS organization administrator access required" }, { status: 403, headers });
    }
    const page = Number(request.nextUrl.searchParams.get("page") || 1);
    const pageSize = Number(request.nextUrl.searchParams.get("pageSize") || 100);
    if (!Number.isInteger(page) || page < 1 || page > 100 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return NextResponse.json({ error: "Invalid pagination" }, { status: 400, headers });
    const actor = actors[0];
    const repo = new NeonEmployeeRepository({ orgId: actor.orgId, userId: actor.id });
    const result = await repo.list({ page, pageSize });
    return NextResponse.json({ data: result.items.map(toEmployeeProfile), pagination: { page, pageSize, total: result.total } }, { headers });
  } catch {
    return NextResponse.json({ error: "HRMS directory unavailable" }, { status: 503, headers });
  }
}
