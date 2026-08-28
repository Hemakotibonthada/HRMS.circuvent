import "server-only";

import { eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { slaPolicies, ticketCategories } from "@/db/schema/helpdesk";

const DEFAULT_BUSINESS_HOURS = {
  timezone: "Asia/Kolkata",
  days: {
    "1": { open: "09:00", close: "18:00" },
    "2": { open: "09:00", close: "18:00" },
    "3": { open: "09:00", close: "18:00" },
    "4": { open: "09:00", close: "18:00" },
    "5": { open: "09:00", close: "18:00" },
  },
  holidays: [] as string[],
};

const DEFAULT_CATEGORIES: { name: string; confidential: boolean }[] = [
  { name: "IT Support", confidential: false },
  { name: "HR Query", confidential: false },
  { name: "Payroll", confidential: false },
  { name: "Access Request", confidential: false },
  { name: "Hardware", confidential: false },
  { name: "Facilities", confidential: false },
  { name: "Grievance (confidential)", confidential: true },
  { name: "General", confidential: false },
];

/** Ensures every org has a default SLA policy and ticket categories. */
export async function ensureHelpdeskDefaults(ctx: TenantContext): Promise<void> {
  await withTenant(ctx, async (tx) => {
    const [sla] = await tx
      .select({ id: slaPolicies.id })
      .from(slaPolicies)
      .where(eq(slaPolicies.orgId, ctx.orgId))
      .limit(1);

    let slaId = sla?.id;
    if (!slaId) {
      const [created] = await tx
        .insert(slaPolicies)
        .values({
          orgId: ctx.orgId,
          name: "Standard",
          businessHours: DEFAULT_BUSINESS_HOURS,
          isDefault: true,
          isActive: true,
        })
        .returning({ id: slaPolicies.id });
      slaId = created.id;
    }

    const existing = await tx
      .select({ name: ticketCategories.name })
      .from(ticketCategories)
      .where(eq(ticketCategories.orgId, ctx.orgId))
      .limit(1);

    if (existing.length > 0) return;

    for (const cat of DEFAULT_CATEGORIES) {
      await tx.insert(ticketCategories).values({
        orgId: ctx.orgId,
        name: cat.name,
        slaPolicyId: slaId,
        isConfidential: cat.confidential,
        isActive: true,
      });
    }
  });
}
