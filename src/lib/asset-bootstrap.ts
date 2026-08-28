import "server-only";

import { eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { assetCategories } from "@/db/schema/assets";

const DEFAULT_CATEGORIES: {
  name: string;
  code: string;
  defaultUsefulLifeMonths: number;
  defaultMethod: "straight_line" | "declining_balance" | "double_declining" | "none";
  defaultSalvagePercent: number;
  maxPerEmployee: number;
  serviceIntervalMonths: number;
}[] = [
  {
    name: "Laptops & Notebooks",
    code: "laptop",
    defaultUsefulLifeMonths: 36,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 5,
    maxPerEmployee: 1,
    serviceIntervalMonths: 12,
  },
  {
    name: "Workstations & Displays",
    code: "display",
    defaultUsefulLifeMonths: 48,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 5,
    maxPerEmployee: 2,
    serviceIntervalMonths: 0,
  },
  {
    name: "Mobile Devices & Tablets",
    code: "mobile",
    defaultUsefulLifeMonths: 24,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 5,
    maxPerEmployee: 1,
    serviceIntervalMonths: 0,
  },
  {
    name: "Servers & Network Equipment",
    code: "network",
    defaultUsefulLifeMonths: 60,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 0,
    maxPerEmployee: 0,
    serviceIntervalMonths: 12,
  },
  {
    name: "Office Furniture & Setup",
    code: "furniture",
    defaultUsefulLifeMonths: 84,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 10,
    maxPerEmployee: 0,
    serviceIntervalMonths: 0,
  },
  {
    name: "Peripherals & Accessories",
    code: "peripheral",
    defaultUsefulLifeMonths: 36,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 0,
    maxPerEmployee: 0,
    serviceIntervalMonths: 0,
  },
];

/** Ensures every org has asset categories for the register UI. */
export async function ensureAssetCategories(ctx: TenantContext): Promise<void> {
  await withTenant(ctx, async (tx) => {
    const existing = await tx
      .select({ id: assetCategories.id })
      .from(assetCategories)
      .where(eq(assetCategories.orgId, ctx.orgId))
      .limit(1);

    if (existing.length > 0) return;

    for (const cat of DEFAULT_CATEGORIES) {
      await tx.insert(assetCategories).values({
        orgId: ctx.orgId,
        name: cat.name,
        code: cat.code,
        defaultUsefulLifeMonths: cat.defaultUsefulLifeMonths,
        defaultMethod: cat.defaultMethod,
        defaultSalvagePercent: cat.defaultSalvagePercent,
        maxPerEmployee: cat.maxPerEmployee,
        serviceIntervalMonths: cat.serviceIntervalMonths,
        requiresAcceptance: false,
        isActive: true,
      });
    }
  });
}
