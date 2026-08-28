import "server-only";

import type { ApiContext } from "@/lib/api-context";
import { currentEmployeeId, requireCurrentEmployeeId } from "@/lib/current-employee";

/** Employee id for helpdesk visibility — never the login account id. */
export async function helpdeskViewerId(ctx: ApiContext): Promise<string | null> {
  return currentEmployeeId(ctx);
}

export async function requireHelpdeskViewerId(ctx: ApiContext): Promise<string> {
  return requireCurrentEmployeeId(ctx);
}
