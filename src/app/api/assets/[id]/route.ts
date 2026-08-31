// POST /api/assets/[id] — issue, return, or move an asset through its
// lifecycle.
//
// Every move goes through the state machine in src/lib/assets.ts, so an asset
// cannot be issued twice or returned by someone who never had it. A register
// that accepts impossible states quietly diverges from the cupboard, and the
// divergence is only found at audit.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NeonAssetsRepository } from "@/db/repositories/assets.neon";
import { NotFoundError, RepositoryError } from "@/db/repositories/types";
import { authErrorResponse } from "@/lib/server-auth";
import { checkRateLimit, requireApiContext } from "@/lib/api-context";
import { assetActorId } from "@/lib/asset-actor";

function mapAssetDbError(error: unknown): RepositoryError | null {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: string }).code)
      : "";
  if (code === "23503") {
    return new RepositoryError(
      "A related record is missing or invalid (category, employee, or location). Refresh and try again.",
      400
    );
  }
  if (code === "23514") {
    return new RepositoryError(
      "Those values break an asset register rule (for example salvage above cost, or assignment state). Check the form and try again.",
      400
    );
  }
  if (code === "23505") {
    return new RepositoryError("An asset with that tag already exists.", 409);
  }
  return null;
}

const conditions = ["new", "good", "fair", "poor", "damaged"] as const;

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("issue"),
    employeeId: z.string().uuid(),
    condition: z.enum(conditions).optional(),
  }),
  z.object({
    action: z.literal("return"),
    condition: z.enum(conditions).optional(),
    notes: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.enum([
      "send_for_repair",
      "repair_complete",
      "report_lost",
      "recover",
      "retire",
      "dispose",
    ]),
    detail: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal("report_fault"),
    description: z.string().trim().min(5, "Describe the fault").max(2000),
    vendor: z.string().trim().max(120).optional(),
  }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const limit = checkRateLimit(`assets:${ctx.userId}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const repo = new NeonAssetsRepository(ctx);
  const canManage = ["owner", "admin", "hr", "manager"].includes(ctx.role);
  const actorId = await assetActorId(ctx);

  try {
    // Anyone may report a fault on equipment — being unable to say your laptop
    // is broken without a permission is how faults go unreported.
    if (parsed.data.action === "report_fault") {
      return NextResponse.json(
        await repo.reportFault({
          assetId: id,
          description: parsed.data.description,
          reportedById: actorId ?? undefined,
          vendor: parsed.data.vendor,
        }),
        { status: 201 }
      );
    }

    if (!canManage) {
      return NextResponse.json({ error: "You cannot manage assets" }, { status: 403 });
    }

    if (parsed.data.action === "issue") {
      return NextResponse.json(
        await repo.issue(id, parsed.data.employeeId, actorId, parsed.data.condition)
      );
    }

    if (parsed.data.action === "return") {
      return NextResponse.json(
        await repo.returnAsset(id, actorId, parsed.data.condition, parsed.data.notes)
      );
    }

    // Disposal writes an asset off the balance sheet, which is a finance
    // decision rather than a desk one.
    if (parsed.data.action === "dispose" && !["owner", "admin"].includes(ctx.role)) {
      return NextResponse.json({ error: "You cannot dispose of assets" }, { status: 403 });
    }

    return NextResponse.json(
      await repo.transition(id, parsed.data.action, actorId, parsed.data.detail)
    );
  } catch (error) {
    const mapped = mapAssetDbError(error);
    if (mapped) {
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Asset action failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const updateAssetSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  assetTag: z.string().trim().max(100).optional(),
  serialNumber: z.string().trim().max(100).optional().nullable(),
  manufacturer: z.string().trim().max(100).optional().nullable(),
  model: z.string().trim().max(100).optional().nullable(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  purchaseCostMinor: z.union([z.string(), z.number()]).optional().nullable(),
  warrantyExpiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  supplier: z.string().trim().max(120).optional().nullable(),
  invoiceNumber: z.string().trim().max(120).optional().nullable(),
  depreciationMethod: z.enum(["straight_line", "declining_balance", "double_declining", "none"]).optional(),
  usefulLifeMonths: z.number().int().positive().optional(),
  salvageValueMinor: z.union([z.string(), z.number()]).optional().nullable(),
  condition: z.enum(["new", "good", "fair", "poor", "damaged"]).optional(),
  locationId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const canManage = ["owner", "admin", "hr", "manager"].includes(ctx.role);
  if (!canManage) {
    return NextResponse.json({ error: "You cannot modify assets" }, { status: 403 });
  }

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  const parsed = updateAssetSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid asset update" },
      { status: 400 }
    );
  }

  const actorId = await assetActorId(ctx);

  try {
    const record = await new NeonAssetsRepository(ctx).update(
      id,
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
        notes: parsed.data.notes ?? undefined,
      },
      actorId
    );

    return NextResponse.json({ asset: record });
  } catch (error) {
    const mapped = mapAssetDbError(error);
    if (mapped) {
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Asset update failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireApiContext(request);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const canDelete = ["owner", "admin", "hr"].includes(ctx.role);
  if (!canDelete) {
    return NextResponse.json({ error: "You cannot delete assets" }, { status: 403 });
  }

  const { id } = await params;

  try {
    await new NeonAssetsRepository(ctx).delete(id, ctx.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const mapped = mapAssetDbError(error);
    if (mapped) {
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof RepositoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Asset deletion failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
