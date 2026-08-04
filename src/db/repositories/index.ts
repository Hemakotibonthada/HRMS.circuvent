// ═══════════════════════════════════════════════════════════════
// REPOSITORY FACTORY — the DATA_BACKEND switch
// ═══════════════════════════════════════════════════════════════
// One place decides which backend serves a call, so the cutover from Firestore
// to Neon is an environment variable rather than a code change, and rolling
// back does not need a redeploy.
//
//   firestore  the current production path
//   neon       Neon serves reads and writes
//   dual       writes go to both, reads come from Firestore
//
// `dual` exists so the two stores can be compared under real traffic before
// anything depends on the new one. A nightly job on the Oracle worker VM diffs
// them, and reads only move to Neon after the diff has been clean for a week
// (docs/PLATFORM-ARCHITECTURE.md §3).

import { FirestoreEmployeeRepository } from "./employee.firestore";
import { HttpEmployeeRepository } from "./employee.http";
import { DualWriteEmployeeRepository } from "./employee.dual";
import type { EmployeeRepository } from "./types";

export type DataBackend = "firestore" | "neon" | "dual";

const VALID: readonly DataBackend[] = ["firestore", "neon", "dual"];

export function dataBackend(): DataBackend {
  const raw = (process.env.NEXT_PUBLIC_DATA_BACKEND ?? process.env.DATA_BACKEND ?? "firestore")
    .trim()
    .toLowerCase();

  if (!VALID.includes(raw as DataBackend)) {
    // Defaulting silently on a typo would route production traffic at the
    // wrong store, so this is loud and falls back to the known-good path.
    console.error(
      `Invalid DATA_BACKEND "${raw}". Expected one of ${VALID.join(", ")}. Using "firestore".`
    );
    return "firestore";
  }
  return raw as DataBackend;
}

let cached: EmployeeRepository | undefined;

/**
 * Client-side repository for employees.
 *
 * Server code must not use this — it constructs the HTTP repository, which
 * would have an API route calling itself. API routes build
 * NeonEmployeeRepository directly with the caller's tenant context.
 */
export function employeeRepository(): EmployeeRepository {
  if (cached) return cached;

  switch (dataBackend()) {
    case "neon":
      cached = new HttpEmployeeRepository();
      break;
    case "dual":
      cached = new DualWriteEmployeeRepository(
        new FirestoreEmployeeRepository(),
        new HttpEmployeeRepository()
      );
      break;
    default:
      cached = new FirestoreEmployeeRepository();
  }
  return cached;
}

/** Test seam: drops the memoised instance so a test can change the backend. */
export function resetRepositories(): void {
  cached = undefined;
}

export * from "./types";
export { FirestoreEmployeeRepository } from "./employee.firestore";
export { HttpEmployeeRepository } from "./employee.http";
export { DualWriteEmployeeRepository } from "./employee.dual";
