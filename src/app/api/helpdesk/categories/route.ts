// GET /api/helpdesk/categories — ticket categories for the create form.

import { NextResponse, type NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";

import { withTenant } from "@/db/client";
import { ticketCategories } from "@/db/schema/helpdesk";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { ensureHelpdeskDefaults } from "@/lib/helpdesk-bootstrap";

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  try {
    await ensureHelpdeskDefaults(ctx);

    const categories = await withTenant(ctx, async (tx) =>
      tx
        .select({
          id: ticketCategories.id,
          name: ticketCategories.name,
          isConfidential: ticketCategories.isConfidential,
        })
        .from(ticketCategories)
        .where(eq(ticketCategories.orgId, ctx.orgId))
        .orderBy(asc(ticketCategories.name))
    );

    return NextResponse.json({ categories });
  } catch (error) {
    console.error("Helpdesk categories lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
