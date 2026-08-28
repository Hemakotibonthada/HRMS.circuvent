// ═══════════════════════════════════════════════════════════════
// ASSET REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Register, assignment, maintenance and depreciation. The rules live in
// src/lib/assets.ts so they test without a database.
//
// The register is only worth having if it is true, so every transition goes
// through the state machine and every movement is logged. An asset that can be
// issued twice, or returned by someone who never had it, is a register that
// quietly diverges from the cupboard.

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { employees } from "@/db/schema/hrms";
import {
  assetAssignments,
  assetCategories,
  assetEvents,
  assetMaintenance,
  assets,
} from "@/db/schema/assets";
import {
  canIssue,
  canTransition,
  depreciate,
  depreciationSchedule,
  exitClearance,
  nextServiceDue,
  warrantyPosition,
  type AssetAction,
  type AssetState,
  type DepreciableAsset,
} from "@/lib/assets";
import { NotFoundError, RepositoryError } from "./types";

export interface AssetCategoryRecord {
  id: string;
  name: string;
  code: string;
  defaultUsefulLifeMonths: number;
  defaultMethod: "straight_line" | "declining_balance" | "double_declining" | "none";
  defaultSalvagePercent: number;
  maxPerEmployee: number;
  serviceIntervalMonths: number;
  requiresAcceptance: boolean;
  isActive: boolean;
}

export interface AssetCreateInput {
  name: string;
  category: string;
  categoryId?: string;
  assetTag?: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  purchaseDate?: string;
  purchaseCostMinor?: string | bigint;
  currency?: string;
  warrantyExpiresOn?: string;
  supplier?: string;
  invoiceNumber?: string;
  depreciationMethod?: "straight_line" | "declining_balance" | "double_declining" | "none";
  usefulLifeMonths?: number;
  salvageValueMinor?: string | bigint;
  condition?: string;
  state?: AssetState;
  locationId?: string;
  assignedToId?: string;
  notes?: string;
}

export interface AssetUpdateInput {
  name?: string;
  category?: string;
  categoryId?: string;
  assetTag?: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  purchaseDate?: string;
  purchaseCostMinor?: string | bigint;
  warrantyExpiresOn?: string;
  supplier?: string;
  invoiceNumber?: string;
  depreciationMethod?: "straight_line" | "declining_balance" | "double_declining" | "none";
  usefulLifeMonths?: number;
  salvageValueMinor?: string | bigint;
  condition?: string;
  locationId?: string;
  notes?: string;
}

export interface AssetRecord {
  id: string;
  assetTag: string;
  name: string;
  category: string;
  categoryId?: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  state: AssetState;
  condition: string;
  assignedToId?: string;
  assignedToName?: string;
  purchaseCostMinor?: string;
  bookValueMinor?: string;
  purchaseDate?: string;
  warrantyExpiresOn?: string;
  isUnderWarranty?: boolean;
  warrantyExpiringSoon?: boolean;
  nextServiceDue?: string;
  depreciationMethod?: string;
  usefulLifeMonths?: number;
  salvageValueMinor?: string;
  locationId?: string;
  notes?: string;
}

function toDepreciable(row: typeof assets.$inferSelect): DepreciableAsset | null {
  if (!row.purchaseDate || row.purchaseCostMinor === null) return null;

  return {
    purchaseCostMinor: row.purchaseCostMinor,
    purchaseDate: row.purchaseDate,
    usefulLifeMonths: row.usefulLifeMonths,
    salvageValueMinor: row.salvageValueMinor,
    method: row.depreciationMethod,
  };
}

export class NeonAssetsRepository {
  constructor(private readonly ctx: TenantContext) {}

  /** The register, with book value and warranty resolved. */
  async list(
    options: { state?: AssetState; assignedToId?: string; categoryId?: string } = {},
    asOf = new Date().toISOString().slice(0, 10)
  ): Promise<AssetRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({ a: assets, first: employees.firstName, last: employees.lastName })
        .from(assets)
        .leftJoin(employees, eq(employees.id, assets.assignedToId))
        .where(
          and(
            options.state ? eq(assets.state, options.state) : undefined,
            options.assignedToId ? eq(assets.assignedToId, options.assignedToId) : undefined,
            options.categoryId ? eq(assets.categoryId, options.categoryId) : undefined
          )
        )
        .orderBy(asc(assets.assetTag))
        .limit(2000);

      const categories = await tx.select().from(assetCategories);
      const byCategory = new Map(categories.map((c) => [c.id, c]));

      return rows.map(({ a, first, last }) => {
        const depreciable = toDepreciable(a);
        const warranty = warrantyPosition(a.warrantyExpiresOn, asOf);
        const interval = a.categoryId
          ? (byCategory.get(a.categoryId)?.serviceIntervalMonths ?? 0)
          : 0;

        return {
          id: a.id,
          assetTag: a.assetTag,
          name: a.name,
          category: a.category,
          categoryId: a.categoryId ?? undefined,
          serialNumber: a.serialNumber ?? undefined,
          manufacturer: a.manufacturer ?? undefined,
          model: a.model ?? undefined,
          state: a.state,
          condition: a.condition,
          assignedToId: a.assignedToId ?? undefined,
          assignedToName: first && last ? `${first} ${last}` : undefined,
          purchaseCostMinor: a.purchaseCostMinor?.toString(),
          bookValueMinor: depreciable
            ? depreciate(depreciable, asOf).bookValueMinor.toString()
            : undefined,
          purchaseDate: a.purchaseDate ?? undefined,
          warrantyExpiresOn: a.warrantyExpiresOn ?? undefined,
          isUnderWarranty: warranty.isUnderWarranty,
          warrantyExpiringSoon: warranty.expiringSoon,
          nextServiceDue:
            a.purchaseDate && interval > 0
              ? (nextServiceDue(a.lastServicedOn, interval, a.purchaseDate) ?? undefined)
              : undefined,
          depreciationMethod: a.depreciationMethod ?? undefined,
          usefulLifeMonths: a.usefulLifeMonths ?? undefined,
          salvageValueMinor: a.salvageValueMinor?.toString(),
          locationId: a.locationId ?? undefined,
          notes: a.notes ?? undefined,
        };
      });
    });
  }

  /**
   * Issues an asset to someone.
   *
   * The leaver check is the one that matters. Issuing equipment to someone
   * whose last day has passed is how a laptop leaves the building permanently,
   * and it happens because the register and the employment record are usually
   * checked by different people at different times. Here they are checked in
   * the same transaction.
   */
  async issue(
    assetId: string,
    employeeId: string,
    actorId: string,
    condition = "good"
  ): Promise<AssetRecord> {
    return withTenant(this.ctx, async (tx) => {
      const [asset] = await tx
        .select()
        .from(assets)
        .where(eq(assets.id, assetId))
        .for("update")
        .limit(1);

      if (!asset) throw new NotFoundError("Asset", assetId);

      const [employee] = await tx
        .select({ id: employees.id, status: employees.status, exitDate: employees.exitDate })
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);

      if (!employee) throw new NotFoundError("Employee", employeeId);

      const holdings = await tx
        .select({ categoryId: assets.categoryId, count: sql<number>`count(*)::int` })
        .from(assets)
        .where(eq(assets.assignedToId, employeeId))
        .groupBy(assets.categoryId);

      const category = asset.categoryId
        ? (
            await tx
              .select()
              .from(assetCategories)
              .where(eq(assetCategories.id, asset.categoryId))
              .limit(1)
          )[0]
        : undefined;

      const verdict = canIssue({
        assetState: asset.state,
        employeeHoldings: holdings
          .filter((h): h is { categoryId: string; count: number } => h.categoryId !== null)
          .map((h) => ({ categoryId: h.categoryId, count: h.count })),
        categoryId: asset.categoryId ?? "",
        maxPerEmployee: category?.maxPerEmployee,
        employeeIsActive: employee.status === "active",
      });

      if (!verdict.allowed) throw new RepositoryError(verdict.reason, 409);

      const depreciable = toDepreciable(asset);
      const today = new Date().toISOString().slice(0, 10);

      await tx.insert(assetAssignments).values({
        orgId: this.ctx.orgId,
        assetId,
        employeeId,
        issuedById: actorId,
        conditionOnIssue: condition,
        // Frozen so a later loss is costed at the value when it was handed
        // over, not at whatever the schedule says on the day of the argument.
        bookValueOnIssueMinor: depreciable
          ? depreciate(depreciable, today).bookValueMinor
          : null,
      });

      const [updated] = await tx
        .update(assets)
        .set({
          state: "assigned",
          status: "assigned",
          assignedToId: employeeId,
          assignedAt: new Date(),
          condition,
          updatedAt: new Date(),
        })
        .where(eq(assets.id, assetId))
        .returning();

      await this.log(tx, assetId, "issue", asset.state, "assigned", { employeeId, actorId });

      return this.toRecord(updated);
    });
  }

  /** Takes an asset back, closing the open assignment. */
  async returnAsset(
    assetId: string,
    actorId: string,
    condition = "good",
    notes?: string
  ): Promise<AssetRecord> {
    return withTenant(this.ctx, async (tx) => {
      const [asset] = await tx
        .select()
        .from(assets)
        .where(eq(assets.id, assetId))
        .for("update")
        .limit(1);

      if (!asset) throw new NotFoundError("Asset", assetId);

      const verdict = canTransition(asset.state, "return");
      if (!verdict.allowed) throw new RepositoryError(verdict.reason, 409);

      await tx
        .update(assetAssignments)
        .set({
          returnedAt: new Date(),
          returnedToId: actorId,
          conditionOnReturn: condition,
          notes,
        })
        .where(
          and(eq(assetAssignments.assetId, assetId), isNull(assetAssignments.returnedAt))
        );

      const [updated] = await tx
        .update(assets)
        .set({
          state: verdict.to,
          status: "available",
          assignedToId: null,
          assignedAt: null,
          condition,
          updatedAt: new Date(),
        })
        .where(eq(assets.id, assetId))
        .returning();

      await this.log(tx, assetId, "return", asset.state, verdict.to, {
        actorId,
        employeeId: asset.assignedToId ?? undefined,
      });

      return this.toRecord(updated);
    });
  }

  /**
   * Any other lifecycle move.
   *
   * Routed through the same state machine, so "repair a disposed asset" is
   * refused with a sentence rather than accepted and left in the register.
   */
  async transition(
    assetId: string,
    action: AssetAction,
    actorId: string,
    detail?: string
  ): Promise<AssetRecord> {
    if (action === "issue" || action === "return") {
      throw new RepositoryError(
        `Use the ${action} endpoint, which records who it was ${action === "issue" ? "issued to" : "returned by"}`,
        400
      );
    }

    return withTenant(this.ctx, async (tx) => {
      const [asset] = await tx
        .select()
        .from(assets)
        .where(eq(assets.id, assetId))
        .for("update")
        .limit(1);

      if (!asset) throw new NotFoundError("Asset", assetId);

      const verdict = canTransition(asset.state, action);
      if (!verdict.allowed) throw new RepositoryError(verdict.reason, 409);

      const changes: Partial<typeof assets.$inferInsert> = {
        state: verdict.to,
        updatedAt: new Date(),
      };

      // An asset that leaves someone's hands stops being theirs, whether it
      // went to repair, was lost or was written off. Leaving the assignment in
      // place would keep it on their exit clearance for ever.
      if (verdict.to !== "assigned" && asset.assignedToId) {
        changes.assignedToId = null;
        changes.assignedAt = null;

        await tx
          .update(assetAssignments)
          .set({ returnedAt: new Date(), returnedToId: actorId, notes: detail })
          .where(
            and(eq(assetAssignments.assetId, assetId), isNull(assetAssignments.returnedAt))
          );
      }

      if (action === "repair_complete") changes.lastServicedOn = new Date().toISOString().slice(0, 10);
      if (action === "dispose") {
        changes.disposedOn = new Date().toISOString().slice(0, 10);
        changes.disposalReason = detail;
      }

      changes.status = verdict.to === "in_stock" ? "available" : verdict.to;

      const [updated] = await tx
        .update(assets)
        .set(changes)
        .where(eq(assets.id, assetId))
        .returning();

      await this.log(tx, assetId, action, asset.state, verdict.to, { actorId, detail });

      return this.toRecord(updated);
    });
  }

  async reportFault(input: {
    assetId: string;
    description: string;
    reportedById: string;
    kind?: string;
    vendor?: string;
  }): Promise<{ id: string; underWarranty: boolean }> {
    return withTenant(this.ctx, async (tx) => {
      const [asset] = await tx
        .select()
        .from(assets)
        .where(eq(assets.id, input.assetId))
        .limit(1);

      if (!asset) throw new NotFoundError("Asset", input.assetId);

      const today = new Date().toISOString().slice(0, 10);
      // Recorded at the time of reporting: whether the cost falls on the
      // vendor or the company is decided by the cover on the day it broke,
      // not the day the invoice arrives.
      const { isUnderWarranty } = warrantyPosition(asset.warrantyExpiresOn, today);

      const [row] = await tx
        .insert(assetMaintenance)
        .values({
          orgId: this.ctx.orgId,
          assetId: input.assetId,
          kind: input.kind ?? "repair",
          description: input.description,
          reportedById: input.reportedById,
          vendor: input.vendor,
          underWarranty: isUnderWarranty,
        })
        .returning({ id: assetMaintenance.id });

      return { id: row.id, underWarranty: isUnderWarranty };
    });
  }

  /** What a leaver still holds, valued at book value. */
  async clearanceFor(employeeId: string, asOf = new Date().toISOString().slice(0, 10)) {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({ a: assets, categoryName: assetCategories.name })
        .from(assets)
        .leftJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
        .where(eq(assets.assignedToId, employeeId));

      const held = rows.map(({ a, categoryName }) => {
        const depreciable = toDepreciable(a);
        return {
          assetId: a.id,
          assetTag: a.assetTag,
          name: a.name,
          categoryName: categoryName ?? a.category,
          bookValueMinor: depreciable ? depreciate(depreciable, asOf).bookValueMinor : 0n,
          issuedOn: a.assignedAt?.toISOString().slice(0, 10) ?? asOf,
        };
      });

      const result = exitClearance(held);

      return {
        ...result,
        totalValueMinor: result.totalValueMinor.toString(),
        outstanding: result.outstanding.map((i) => ({
          ...i,
          bookValueMinor: i.bookValueMinor.toString(),
        })),
      };
    });
  }

  /**
   * Total book value of the register, by category.
   *
   * The figure finance reconciles against the fixed-asset ledger. Disposed
   * assets are excluded: they are gone, and counting them is how a register
   * comes to disagree with the balance sheet.
   */
  async valuation(asOf = new Date().toISOString().slice(0, 10)) {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select({ a: assets, categoryName: assetCategories.name })
        .from(assets)
        .leftJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
        .where(inArray(assets.state, ["in_stock", "assigned", "in_repair", "lost"]));

      const byCategory = new Map<
        string,
        { count: number; costMinor: bigint; bookValueMinor: bigint }
      >();

      for (const { a, categoryName } of rows) {
        const key = categoryName ?? a.category;
        const depreciable = toDepreciable(a);
        const book = depreciable ? depreciate(depreciable, asOf).bookValueMinor : 0n;

        const entry = byCategory.get(key) ?? {
          count: 0,
          costMinor: 0n,
          bookValueMinor: 0n,
        };

        byCategory.set(key, {
          count: entry.count + 1,
          costMinor: entry.costMinor + (a.purchaseCostMinor ?? 0n),
          bookValueMinor: entry.bookValueMinor + book,
        });
      }

      const categories = [...byCategory.entries()].map(([category, v]) => ({
        category,
        count: v.count,
        costMinor: v.costMinor.toString(),
        bookValueMinor: v.bookValueMinor.toString(),
      }));

      return {
        asOf,
        categories,
        totalCostMinor: [...byCategory.values()]
          .reduce((sum, v) => sum + v.costMinor, 0n)
          .toString(),
        totalBookValueMinor: [...byCategory.values()]
          .reduce((sum, v) => sum + v.bookValueMinor, 0n)
          .toString(),
      };
    });
  }

  /** The month-by-month schedule an auditor asks for. */
  async scheduleFor(assetId: string) {
    return withTenant(this.ctx, async (tx) => {
      const [asset] = await tx.select().from(assets).where(eq(assets.id, assetId)).limit(1);
      if (!asset) throw new NotFoundError("Asset", assetId);

      const depreciable = toDepreciable(asset);
      if (!depreciable) {
        throw new RepositoryError(
          "This asset has no purchase date or cost, so it cannot be depreciated",
          400
        );
      }

      return depreciationSchedule(depreciable).map((row) => ({
        ...row,
        chargeMinor: row.chargeMinor.toString(),
        bookValueMinor: row.bookValueMinor.toString(),
      }));
    });
  }

  /** Who held an asset, and when. */
  async history(assetId: string) {
    return withTenant(this.ctx, async (tx) => {
      const assignments = await tx
        .select({
          a: assetAssignments,
          first: employees.firstName,
          last: employees.lastName,
        })
        .from(assetAssignments)
        .leftJoin(employees, eq(employees.id, assetAssignments.employeeId))
        .where(eq(assetAssignments.assetId, assetId))
        .orderBy(desc(assetAssignments.issuedAt));

      const events = await tx
        .select()
        .from(assetEvents)
        .where(eq(assetEvents.assetId, assetId))
        .orderBy(desc(assetEvents.occurredAt));

      return {
        assignments: assignments.map(({ a, first, last }) => ({
          employeeId: a.employeeId,
          employeeName: first && last ? `${first} ${last}` : undefined,
          issuedAt: a.issuedAt.toISOString(),
          returnedAt: a.returnedAt?.toISOString(),
          conditionOnIssue: a.conditionOnIssue,
          conditionOnReturn: a.conditionOnReturn ?? undefined,
        })),
        events: events.map((e) => ({
          action: e.action,
          fromState: e.fromState ?? undefined,
          toState: e.toState ?? undefined,
          detail: e.detail ?? undefined,
          occurredAt: e.occurredAt.toISOString(),
        })),
      };
    });
  }

  /** Lists all active asset categories. */
  async listCategories(): Promise<AssetCategoryRecord[]> {
    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(assetCategories)
        .where(eq(assetCategories.isActive, true))
        .orderBy(asc(assetCategories.name));

      return rows.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        defaultUsefulLifeMonths: c.defaultUsefulLifeMonths,
        defaultMethod: c.defaultMethod,
        defaultSalvagePercent: c.defaultSalvagePercent,
        maxPerEmployee: c.maxPerEmployee,
        serviceIntervalMonths: c.serviceIntervalMonths,
        requiresAcceptance: c.requiresAcceptance,
        isActive: c.isActive,
      }));
    });
  }

  /** Provisions a new asset into company inventory. */
  async create(input: AssetCreateInput, actorId: string): Promise<AssetRecord> {
    return withTenant(this.ctx, async (tx) => {
      let tag = input.assetTag?.trim();
      if (!tag) {
        const count = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(assets);
        const nextNum = (count[0]?.count ?? 0) + 1;
        tag = `CIR-AST-${String(nextNum).padStart(4, "0")}`;
      }

      const costMinor = input.purchaseCostMinor !== undefined && input.purchaseCostMinor !== null
        ? BigInt(input.purchaseCostMinor.toString())
        : null;

      const salvageMinor = input.salvageValueMinor !== undefined && input.salvageValueMinor !== null
        ? BigInt(input.salvageValueMinor.toString())
        : 0n;

      const [row] = await tx
        .insert(assets)
        .values({
          orgId: this.ctx.orgId,
          assetTag: tag,
          name: input.name,
          category: input.category,
          categoryId: input.categoryId || null,
          serialNumber: input.serialNumber || null,
          manufacturer: input.manufacturer || null,
          model: input.model || null,
          purchaseDate: input.purchaseDate || null,
          purchaseCostMinor: costMinor,
          currency: input.currency || "INR",
          warrantyExpiresOn: input.warrantyExpiresOn || null,
          supplier: input.supplier || null,
          invoiceNumber: input.invoiceNumber || null,
          depreciationMethod: input.depreciationMethod || "straight_line",
          usefulLifeMonths: input.usefulLifeMonths || 36,
          salvageValueMinor: salvageMinor,
          condition: input.condition || "new",
          state: input.state || "in_stock",
          status: input.state === "assigned" ? "assigned" : (input.state === "in_repair" ? "in_repair" : "available"),
          locationId: input.locationId || null,
          assignedToId: input.assignedToId || null,
          assignedAt: input.assignedToId ? new Date() : null,
          notes: input.notes || null,
        })
        .returning();

      await this.log(tx, row.id, "create", "in_stock", row.state, {
        actorId,
        employeeId: input.assignedToId,
        detail: "Asset created and registered",
      });

      if (input.assignedToId) {
        await tx.insert(assetAssignments).values({
          orgId: this.ctx.orgId,
          assetId: row.id,
          employeeId: input.assignedToId,
          issuedById: actorId,
          conditionOnIssue: input.condition || "new",
          bookValueOnIssueMinor: costMinor,
        });
      }

      return this.toRecord(row);
    });
  }

  /** Updates asset properties and metadata. */
  async update(id: string, input: AssetUpdateInput, actorId: string): Promise<AssetRecord> {
    return withTenant(this.ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(assets)
        .where(eq(assets.id, id))
        .for("update")
        .limit(1);

      if (!existing) throw new NotFoundError("Asset", id);

      const updates: Partial<typeof assets.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) updates.name = input.name;
      if (input.category !== undefined) updates.category = input.category;
      if (input.categoryId !== undefined) updates.categoryId = input.categoryId || null;
      if (input.assetTag !== undefined) updates.assetTag = input.assetTag;
      if (input.serialNumber !== undefined) updates.serialNumber = input.serialNumber || null;
      if (input.manufacturer !== undefined) updates.manufacturer = input.manufacturer || null;
      if (input.model !== undefined) updates.model = input.model || null;
      if (input.purchaseDate !== undefined) updates.purchaseDate = input.purchaseDate || null;
      if (input.purchaseCostMinor !== undefined) {
        updates.purchaseCostMinor = input.purchaseCostMinor !== null ? BigInt(input.purchaseCostMinor.toString()) : null;
      }
      if (input.warrantyExpiresOn !== undefined) updates.warrantyExpiresOn = input.warrantyExpiresOn || null;
      if (input.supplier !== undefined) updates.supplier = input.supplier || null;
      if (input.invoiceNumber !== undefined) updates.invoiceNumber = input.invoiceNumber || null;
      if (input.depreciationMethod !== undefined) updates.depreciationMethod = input.depreciationMethod;
      if (input.usefulLifeMonths !== undefined) updates.usefulLifeMonths = input.usefulLifeMonths;
      if (input.salvageValueMinor !== undefined) {
        updates.salvageValueMinor = input.salvageValueMinor !== null ? BigInt(input.salvageValueMinor.toString()) : 0n;
      }
      if (input.condition !== undefined) updates.condition = input.condition;
      if (input.locationId !== undefined) updates.locationId = input.locationId || null;
      if (input.notes !== undefined) updates.notes = input.notes || null;

      const [updated] = await tx
        .update(assets)
        .set(updates)
        .where(eq(assets.id, id))
        .returning();

      await this.log(tx, id, "update", existing.state, updated.state, {
        actorId,
        detail: "Asset properties modified",
      });

      return this.toRecord(updated);
    });
  }

  /** Deletes an unassigned / disposed / retired asset. */
  async delete(id: string, actorId: string): Promise<void> {
    return withTenant(this.ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(assets)
        .where(eq(assets.id, id))
        .limit(1);

      if (!existing) throw new NotFoundError("Asset", id);

      if (existing.state === "assigned") {
        throw new RepositoryError("Cannot delete an asset that is currently assigned to an employee", 400);
      }

      await tx.delete(assets).where(eq(assets.id, id));
    });
  }

  // ─── Internals ─────────────────────────────────────────────

  private async log(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    assetId: string,
    action: string,
    from: AssetState,
    to: AssetState,
    context: { employeeId?: string; actorId?: string; detail?: string }
  ): Promise<void> {
    await tx.insert(assetEvents).values({
      orgId: this.ctx.orgId,
      assetId,
      action,
      fromState: from,
      toState: to,
      employeeId: context.employeeId,
      actorId: context.actorId,
      detail: context.detail,
    });
  }

  private toRecord(row: typeof assets.$inferSelect): AssetRecord {
    const depreciable = toDepreciable(row);
    const today = new Date().toISOString().slice(0, 10);
    const warranty = warrantyPosition(row.warrantyExpiresOn, today);

    return {
      id: row.id,
      assetTag: row.assetTag,
      name: row.name,
      category: row.category,
      categoryId: row.categoryId ?? undefined,
      serialNumber: row.serialNumber ?? undefined,
      manufacturer: row.manufacturer ?? undefined,
      model: row.model ?? undefined,
      state: row.state,
      condition: row.condition,
      assignedToId: row.assignedToId ?? undefined,
      purchaseCostMinor: row.purchaseCostMinor?.toString(),
      bookValueMinor: depreciable
        ? depreciate(depreciable, today).bookValueMinor.toString()
        : undefined,
      purchaseDate: row.purchaseDate ?? undefined,
      warrantyExpiresOn: row.warrantyExpiresOn ?? undefined,
      isUnderWarranty: warranty.isUnderWarranty,
      warrantyExpiringSoon: warranty.expiringSoon,
      depreciationMethod: row.depreciationMethod ?? undefined,
      usefulLifeMonths: row.usefulLifeMonths ?? undefined,
      salvageValueMinor: row.salvageValueMinor?.toString(),
      locationId: row.locationId ?? undefined,
      notes: row.notes ?? undefined,
    };
  }
}
