// ═══════════════════════════════════════════════════════════════
// Recording what somebody's job used to be
// ═══════════════════════════════════════════════════════════════
//
// `employees.designation`, `department_id`, `reporting_to_id` and
// `employment_type` are overwritten in place, so the previous value is gone the
// instant HR saves. This writes the before and after into `hrms.job_history` so
// a timeline, a promotion letter and a performance conversation have something
// to read.
//
// ─── On tolerating a missing table ───
//
// Every function here tolerates `hrms.job_history` not existing. That is not
// defensive habit, it is a deployment fact: the application database role is
// `hrms_app`, which deliberately has no CREATE on the `hrms` schema, so this
// migration is applied separately by whoever holds owner credentials. Code that
// shipped first and threw would turn "the migration has not run yet" into
// "nobody can be given a promotion".
//
// The write is best-effort and the edit is not. Losing a history row is a gap
// in a timeline; refusing the edit because the history could not be written
// would stop HR doing their job over an audit trail.
//
// ─── Why it asks first instead of catching ───
//
// Catching the error is not enough, and this was proved against the real
// database rather than reasoned about. A statement that fails inside a
// transaction poisons it: Postgres refuses every later statement with 25P02,
// so `try { insert } catch {}` returns cleanly and then the *employee update
// around it* dies. Tolerating the missing table by catching would have caused
// precisely the failure this tolerance exists to prevent.
//
// So the table's presence is checked with `to_regclass` — a query that succeeds
// either way and therefore never poisons anything — and the real statement is
// only issued when the answer is yes. The result is cached, so the cost is one
// extra round trip shortly after boot and nothing at all once the migration has
// been applied.

import { and, desc, eq, sql } from "drizzle-orm";
import { jobHistory } from "@/db/schema/job-history";

/** The four job facts this system keeps history for. */
export type JobField = "designation" | "department" | "manager" | "employment_type";

export interface JobChange {
  field: JobField;
  fromValue: string | null;
  toValue: string | null;
  fromId?: string | null;
  toId?: string | null;
}

/**
 * Cached answer to "does hrms.job_history exist".
 *
 * `true` is kept for good — tables are not dropped under a running app. `false`
 * is re-checked periodically so that applying the migration starts recording
 * history without anybody restarting the server.
 */
let tablePresent: boolean | null = null;
let lastCheckedAt = 0;
const RECHECK_MS = 60_000;

/** Exposed for tests, which must not inherit a cached answer from each other. */
export function resetJobHistoryTableCache(): void {
  tablePresent = null;
  lastCheckedAt = 0;
}

async function jobHistoryTableExists(tx: {
  execute: (query: unknown) => Promise<unknown>;
}): Promise<boolean> {
  if (tablePresent === true) return true;
  if (tablePresent === false && Date.now() - lastCheckedAt < RECHECK_MS) return false;

  try {
    // Existence alone is not enough. `to_regclass` answers yes for a table this
    // role may not touch, and an INSERT that then fails with permission denied
    // poisons the caller's transaction — the exact outcome this check exists to
    // avoid. So it asks about privileges too.
    //
    // CASE is what makes that safe: Postgres guarantees it short-circuits, and
    // `has_table_privilege` raises if handed a table that is not there, so the
    // two questions cannot be asked as a plain AND.
    const result = (await tx.execute(
      sql`select case
            when to_regclass('hrms.job_history') is null then false
            else has_table_privilege('hrms.job_history', 'SELECT')
             and has_table_privilege('hrms.job_history', 'INSERT')
          end as present`
    )) as { rows?: Array<{ present?: unknown }> } | Array<{ present?: unknown }>;

    const rows = Array.isArray(result) ? result : (result.rows ?? []);
    tablePresent = rows[0]?.present === true;
  } catch {
    // If even this cannot be answered, treat it as absent rather than letting
    // the uncertainty reach a caller who only wanted to save an employee.
    tablePresent = false;
  }

  lastCheckedAt = Date.now();
  if (tablePresent === false) {
    console.warn(
      "[job-history] hrms.job_history is missing or not readable/writable by this role; " +
        "job changes are being saved but not recorded. Apply drizzle/0044_job_history.sql " +
        "with owner credentials — it includes the GRANT to hrms_app."
    );
  }
  return tablePresent;
}

/**
 * Writes one row per genuine change.
 *
 * A change from a value to the same value is dropped here as well as being
 * refused by a CHECK constraint, so "Role changed from Engineer to Engineer"
 * cannot reach anybody's timeline.
 */
export async function recordJobChanges(
  tx: any,
  params: {
    orgId: string;
    employeeId: string;
    changedById?: string | null;
    note?: string | null;
    effectiveOn?: Date;
  },
  changes: JobChange[]
): Promise<number> {
  const real = changes.filter(
    (c) => c.fromValue !== c.toValue || (c.fromId ?? null) !== (c.toId ?? null)
  );
  if (!real.length) return 0;

  // Asked before writing, so a missing table never becomes a failed statement
  // inside the caller's transaction — see the note at the top of this file.
  if (!(await jobHistoryTableExists(tx))) return 0;

  await tx.insert(jobHistory).values(
    real.map((c) => ({
      orgId: params.orgId,
      employeeId: params.employeeId,
      field: c.field,
      fromValue: c.fromValue,
      toValue: c.toValue,
      fromId: c.fromId ?? null,
      toId: c.toId ?? null,
      changedById: params.changedById ?? null,
      note: params.note ?? null,
      ...(params.effectiveOn ? { effectiveOn: params.effectiveOn } : {}),
    }))
  );
  return real.length;
}

export interface JobHistoryRow {
  field: string;
  fromValue: string | null;
  toValue: string | null;
  effectiveOn: string;
  note: string | null;
}

/** One employee's recorded changes, newest first. Empty when the table is absent. */
export async function readJobHistory(
  tx: any,
  orgId: string,
  employeeId: string,
  limit = 100
): Promise<JobHistoryRow[]> {
  if (!(await jobHistoryTableExists(tx))) return [];

  const rows = await tx
    .select({
      field: jobHistory.field,
      fromValue: jobHistory.fromValue,
      toValue: jobHistory.toValue,
      effectiveOn: jobHistory.effectiveOn,
      note: jobHistory.note,
    })
    .from(jobHistory)
    .where(and(eq(jobHistory.orgId, orgId), eq(jobHistory.employeeId, employeeId)))
    .orderBy(desc(jobHistory.effectiveOn))
    .limit(limit);

  return rows.map((r: Record<string, unknown>) => ({
    field: String(r.field),
    fromValue: r.fromValue === null ? null : String(r.fromValue),
    toValue: r.toValue === null ? null : String(r.toValue),
    effectiveOn: new Date(String(r.effectiveOn)).toISOString(),
    note: r.note === null ? null : String(r.note),
  }));
}

/**
 * How a change reads on a timeline.
 *
 * "Role changed" rather than "designation updated", and the old value kept in
 * the sentence — the point of a history is the transition, not the destination.
 */
export function describeChange(row: JobHistoryRow): { title: string; detail: string | null } {
  const from = row.fromValue?.trim() || null;
  const to = row.toValue?.trim() || null;

  const title =
    row.field === "designation" ? "Role changed"
    : row.field === "department" ? "Moved team"
    : row.field === "manager" ? "New manager"
    : "Employment changed";

  const words = (value: string) => value.replace(/_/g, " ");

  const detail =
    from && to ? `${words(from)} → ${words(to)}`
    : to ? words(to)
    : from ? `Was ${words(from)}`
    : null;

  return { title, detail: row.note ? `${detail ?? ""} · ${row.note}`.trim() : detail };
}
