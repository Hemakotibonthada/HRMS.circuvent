import "server-only";

import { currentEmployeeId, type EmployeeLookupContext } from "@/lib/current-employee";

/** Employee id for asset audit rows — never the login account id. */
export async function assetActorId(ctx: EmployeeLookupContext): Promise<string | null> {
  return currentEmployeeId(ctx);
}
