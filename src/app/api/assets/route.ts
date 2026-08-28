// GET /api/assets — the register, with book value and warranty resolved.

import { NextResponse, type NextRequest } from "next/server";
import { NeonAssetsRepository } from "@/db/repositories/assets.neon";
import { RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";
import { currentEmployeeId } from "@/lib/current-employee";
import type { AssetState } from "@/lib/assets";

const STATES: AssetState[] = [
  "in_stock",
  "assigned",
  "in_repair",
  "lost",
  "retired",
  "disposed",
];

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state");

  if (state && !STATES.includes(state as AssetState)) {
    return NextResponse.json({ error: "Unknown state" }, { status: 400 });
  }

  const requested = searchParams.get("assignedToId");
  const privileged = ["owner", "admin", "hr", "manager"].includes(ctx.role);

  try {
    // ctx.userId is the signing-in account, not the employment record assets
    // are assigned to — see lib/current-employee.ts.
    const self = privileged ? null : await currentEmployeeId(ctx);

    if (!privileged && !self) {
      return NextResponse.json({
        assets: [],
        summary: { total: 0, assigned: 0, inStock: 0, inRepair: 0, warrantyExpiringSoon: 0 },
      });
    }

    // Someone without standing sees what they hold, not the whole register. The
    // register lists serial numbers and locations of every laptop in the
    // company, which is a shopping list.
    const assignedToId = privileged ? (requested ?? undefined) : (self ?? undefined);

    const items = await new NeonAssetsRepository(ctx).list({
      state: (state as AssetState) ?? undefined,
      assignedToId,
      categoryId: searchParams.get("categoryId") ?? undefined,
    });

    return NextResponse.json({
      assets: items,
      summary: {
        total: items.length,
        assigned: items.filter((a) => a.state === "assigned").length,
        inStock: items.filter((a) => a.state === "in_stock").length,
        inRepair: items.filter((a) => a.state === "in_repair").length,
        warrantyExpiringSoon: items.filter((a) => a.warrantyExpiringSoon).length,
      },
    });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Asset lookup failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
