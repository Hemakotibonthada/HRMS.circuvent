// ═══════════════════════════════════════════════════════════════
// REPOSITORY FACTORY
// ═══════════════════════════════════════════════════════════════
// Postgres is the only backend. The DATA_BACKEND switch that used to select
// between Firestore, Neon and a dual-write comparison mode is gone: the cutover
// is finished, and a switch that can still be pointed at a retired store is a
// way to take production down by editing an environment variable.

import { HttpEmployeeRepository } from "./employee.http";
import type { EmployeeRepository } from "./types";

let cached: EmployeeRepository | undefined;

/**
 * Client-side repository for employees.
 *
 * Server code must not use this — it constructs the HTTP repository, which
 * would have an API route calling itself. API routes build
 * NeonEmployeeRepository directly with the caller's tenant context.
 */
export function employeeRepository(): EmployeeRepository {
  if (!cached) cached = new HttpEmployeeRepository();
  return cached;
}

/** Test seam: drops the memoised instance. */
export function resetRepositories(): void {
  cached = undefined;
}

export * from "./types";
export { HttpEmployeeRepository } from "./employee.http";
