// ═══════════════════════════════════════════════════════════════
// GET /api/locations — List work locations for the organization
// ═══════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from "next/server";
import { asc, eq, and } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { locations } from "@/db/schema/hrms";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LOCATIONS = [
  { name: "Bangalore HQ (Main Campus)", code: "BLR_HQ", city: "Bengaluru", country: "India" },
  { name: "Hyderabad Innovation Labs", code: "HYD_LABS", city: "Hyderabad", country: "India" },
  { name: "Vijayawada Tech Park", code: "VJA_TECH", city: "Vijayawada", country: "India" },
  { name: "Remote / WFH", code: "REMOTE", city: "Remote", country: "India" },
];

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    const rows = await withTenant(ctx, async (tx) => {
      let list = await tx
        .select({
          id: locations.id,
          name: locations.name,
          code: locations.code,
          city: locations.city,
          country: locations.country,
          isActive: locations.isActive,
        })
        .from(locations)
        .where(and(eq(locations.orgId, ctx.orgId), eq(locations.isActive, true)))
        .orderBy(asc(locations.name));

      if (list.length === 0) {
        // Bootstrap standard locations for this tenant
        const bootstrapped = DEFAULT_LOCATIONS.map((loc) => ({
          orgId: ctx.orgId,
          name: loc.name,
          code: loc.code,
          city: loc.city,
          country: loc.country,
          isActive: true,
        }));

        await tx.insert(locations).values(bootstrapped).onConflictDoNothing();

        list = await tx
          .select({
            id: locations.id,
            name: locations.name,
            code: locations.code,
            city: locations.city,
            country: locations.country,
            isActive: locations.isActive,
          })
          .from(locations)
          .where(and(eq(locations.orgId, ctx.orgId), eq(locations.isActive, true)))
          .orderBy(asc(locations.name));
      }

      return list;
    });

    return NextResponse.json({ data: rows, items: rows });
  } catch (error: any) {
    console.error("[locations] GET failed:", error);
    return NextResponse.json({ error: "Could not list locations" }, { status: 500 });
  }
}
