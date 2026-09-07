/**
 * Service to sync HRMS holidays and weekend configuration into Paystub.
 */

import { withTenant } from "@/db/client";
import { holidays } from "@/db/schema/hrms";
import type { ApiContext } from "@/lib/api-context";

interface SyncResult {
  ok: boolean;
  syncedCount?: number;
  weekendDays?: number[];
  error?: string;
}

export async function syncHolidaysToPaystub(
  ctx: ApiContext,
  options?: { weekendDays?: number[] }
): Promise<SyncResult> {
  const token = process.env.CROSS_APP_SYNC_TOKEN;
  if (!token) {
    return { ok: false, error: "CROSS_APP_SYNC_TOKEN is not configured in HRMS." };
  }

  // Determine Paystub target URL
  const baseUrl =
    process.env.PAYSTUB_BASE_URL ||
    (process.env.NODE_ENV === "production"
      ? "https://paystub.circuvent.com"
      : "http://localhost:3000");

  const syncUrl = `${baseUrl.replace(/\/$/, "")}/api/sync/holidays`;

  // Determine target Paystub orgId
  let paystubOrgId = "15b17596-eb0b-46fe-a4e2-125bee3f8fb3";
  try {
    const rawMap = process.env.PAYSTUB_SYNC_TENANT_MAP;
    if (rawMap) {
      const map = JSON.parse(rawMap);
      if (map[ctx.orgId]?.orgId) {
        paystubOrgId = map[ctx.orgId].orgId;
      }
    }
  } catch {
    // Fall back to default orgId
  }

  // 1. Fetch holidays from HRMS database
  const hrmsHolidays = await withTenant(ctx, async (tx) => {
    return tx
      .select({
        name: holidays.name,
        holidayDate: holidays.holidayDate,
        isOptional: holidays.isOptional,
      })
      .from(holidays)
      .orderBy(holidays.holidayDate);
  });

  const weekendDays = options?.weekendDays ?? [0, 6]; // Default: Sunday (0) & Saturday (6)

  const payload = {
    orgId: paystubOrgId,
    weekendDays,
    holidays: hrmsHolidays.map((h) => ({
      name: h.name,
      holidayDate: h.holidayDate,
      isOptional: h.isOptional,
      isPaid: true,
    })),
  };

  try {
    const response = await fetch(syncUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Token": token,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return {
        ok: false,
        error: body.error || body.message || `Paystub sync failed with status ${response.status}`,
      };
    }

    const data = await response.json();
    return {
      ok: true,
      syncedCount: data.syncedCount ?? hrmsHolidays.length,
      weekendDays: data.weekendDays ?? weekendDays,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error contacting Paystub sync endpoint",
    };
  }
}
