// GET /api/assets — the register, with book value and warranty resolved.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
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

const createAssetSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  category: z.string().trim().min(1, "Category is required").max(100),
  categoryId: z.string().uuid().optional().nullable(),
  assetTag: z.string().trim().max(100).optional(),
  serialNumber: z.string().trim().max(100).optional().nullable(),
  manufacturer: z.string().trim().max(100).optional().nullable(),
  model: z.string().trim().max(100).optional().nullable(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD").optional().nullable(),
  purchaseCostMinor: z.union([z.string(), z.number()]).optional().nullable(),
  currency: z.string().trim().max(10).optional(),
  warrantyExpiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD").optional().nullable(),
  supplier: z.string().trim().max(120).optional().nullable(),
  invoiceNumber: z.string().trim().max(120).optional().nullable(),
  depreciationMethod: z.enum(["straight_line", "declining_balance", "double_declining", "none"]).optional(),
  usefulLifeMonths: z.number().int().positive().optional(),
  salvageValueMinor: z.union([z.string(), z.number()]).optional().nullable(),
  condition: z.enum(["new", "good", "fair", "poor", "damaged"]).optional(),
  state: z.enum(["in_stock", "assigned", "in_repair", "lost", "retired", "disposed"]).optional(),
  locationId: z.string().uuid().optional().nullable(),
  assignedToId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const canManage = ["owner", "admin", "hr", "manager"].includes(ctx.role);
  if (!canManage) {
    return NextResponse.json({ error: "You cannot create assets" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = createAssetSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid asset data" },
      { status: 400 }
    );
  }

  try {
    const record = await new NeonAssetsRepository(ctx).create(
      {
        ...parsed.data,
        categoryId: parsed.data.categoryId ?? undefined,
        serialNumber: parsed.data.serialNumber ?? undefined,
        manufacturer: parsed.data.manufacturer ?? undefined,
        model: parsed.data.model ?? undefined,
        purchaseDate: parsed.data.purchaseDate ?? undefined,
        purchaseCostMinor: parsed.data.purchaseCostMinor?.toString(),
        warrantyExpiresOn: parsed.data.warrantyExpiresOn ?? undefined,
        supplier: parsed.data.supplier ?? undefined,
        invoiceNumber: parsed.data.invoiceNumber ?? undefined,
        salvageValueMinor: parsed.data.salvageValueMinor?.toString(),
        locationId: parsed.data.locationId ?? undefined,
        assignedToId: parsed.data.assignedToId ?? undefined,
        notes: parsed.data.notes ?? undefined,
      },
      ctx.userId
    );

    return NextResponse.json({ asset: record }, { status: 201 });
  } catch (error) {
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Asset creation failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
