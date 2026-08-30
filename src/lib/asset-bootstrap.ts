import "server-only";

import { eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { assetCategories } from "@/db/schema/assets";

export type DefaultAssetCategory = {
  name: string;
  code: string;
  defaultUsefulLifeMonths: number;
  defaultMethod: "straight_line" | "declining_balance" | "double_declining" | "none";
  defaultSalvagePercent: number;
  maxPerEmployee: number;
  serviceIntervalMonths: number;
  requiresAcceptance?: boolean;
};

/** Standard IT / office asset categories seeded for every organisation. */
export const DEFAULT_ASSET_CATEGORIES: DefaultAssetCategory[] = [
  {
    name: "Laptops & Notebooks",
    code: "laptop",
    defaultUsefulLifeMonths: 36,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 5,
    maxPerEmployee: 1,
    serviceIntervalMonths: 12,
    requiresAcceptance: true,
  },
  {
    name: "Workstations & Desktops",
    code: "desktop",
    defaultUsefulLifeMonths: 48,
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
    name: "Monitors & External Displays",
    code: "monitor",
    defaultUsefulLifeMonths: 60,
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
    requiresAcceptance: true,
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
    name: "Storage & NAS Devices",
    code: "storage",
    defaultUsefulLifeMonths: 60,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 0,
    maxPerEmployee: 0,
    serviceIntervalMonths: 12,
  },
  {
    name: "Printers & Scanners",
    code: "printer",
    defaultUsefulLifeMonths: 48,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 5,
    maxPerEmployee: 0,
    serviceIntervalMonths: 6,
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
  {
    name: "Audio / Video Equipment",
    code: "av",
    defaultUsefulLifeMonths: 60,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 5,
    maxPerEmployee: 0,
    serviceIntervalMonths: 12,
  },
  {
    name: "Conference Room Equipment",
    code: "conference",
    defaultUsefulLifeMonths: 60,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 5,
    maxPerEmployee: 0,
    serviceIntervalMonths: 12,
  },
  {
    name: "Security & Surveillance",
    code: "security",
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
    name: "SIM Cards & Telecom",
    code: "telecom",
    defaultUsefulLifeMonths: 12,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 0,
    maxPerEmployee: 1,
    serviceIntervalMonths: 0,
  },
  {
    name: "IoT & Smart Devices",
    code: "iot",
    defaultUsefulLifeMonths: 36,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 0,
    maxPerEmployee: 0,
    serviceIntervalMonths: 0,
  },
  {
    name: "Wearables",
    code: "wearable",
    defaultUsefulLifeMonths: 24,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 0,
    maxPerEmployee: 1,
    serviceIntervalMonths: 0,
  },
  {
    name: "Tools & Field Equipment",
    code: "tools",
    defaultUsefulLifeMonths: 60,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 5,
    maxPerEmployee: 0,
    serviceIntervalMonths: 12,
  },
  {
    name: "Vehicles",
    code: "vehicle",
    defaultUsefulLifeMonths: 120,
    defaultMethod: "declining_balance",
    defaultSalvagePercent: 10,
    maxPerEmployee: 0,
    serviceIntervalMonths: 6,
  },
  {
    name: "Software Licenses",
    code: "software",
    defaultUsefulLifeMonths: 12,
    defaultMethod: "none",
    defaultSalvagePercent: 0,
    maxPerEmployee: 0,
    serviceIntervalMonths: 0,
  },
  {
    name: "Other / Miscellaneous",
    code: "other",
    defaultUsefulLifeMonths: 36,
    defaultMethod: "straight_line",
    defaultSalvagePercent: 0,
    maxPerEmployee: 0,
    serviceIntervalMonths: 0,
  },
];

/** Maps legacy uppercase codes to the canonical bootstrap code. */
function canonicalCategoryCode(code: string): string {
  const normalized = code.trim().toLowerCase();
  if (normalized === "server") return "network";
  return normalized;
}

/** Ensures every org has the full standard category catalogue. */
export async function ensureAssetCategories(ctx: TenantContext): Promise<void> {
  await withTenant(ctx, async (tx) => {
    const existing = await tx
      .select({ code: assetCategories.code })
      .from(assetCategories)
      .where(eq(assetCategories.orgId, ctx.orgId));

    const existingCodes = new Set(
      existing.map((row) => canonicalCategoryCode(row.code))
    );

    for (const cat of DEFAULT_ASSET_CATEGORIES) {
      if (existingCodes.has(cat.code.toLowerCase())) continue;

      await tx.insert(assetCategories).values({
        orgId: ctx.orgId,
        name: cat.name,
        code: cat.code,
        defaultUsefulLifeMonths: cat.defaultUsefulLifeMonths,
        defaultMethod: cat.defaultMethod,
        defaultSalvagePercent: cat.defaultSalvagePercent,
        maxPerEmployee: cat.maxPerEmployee,
        serviceIntervalMonths: cat.serviceIntervalMonths,
        requiresAcceptance: cat.requiresAcceptance ?? false,
        isActive: true,
      });

      existingCodes.add(cat.code.toLowerCase());
    }
  });
}
