// ═══════════════════════════════════════════════════════════════
// JOB HISTORY — what somebody's job used to be
// ═══════════════════════════════════════════════════════════════
//
// `employees.designation`, `department_id`, `reporting_to_id` and
// `employment_type` are single columns that get overwritten. The moment HR
// types a new title the old one is gone, so the system could answer "what is
// your role" and never "what was it, and when did it change" — which is the
// question a timeline, a promotion letter and half of a performance
// conversation are actually about.
//
// A row is written here whenever one of those four changes, recording what it
// was before and what it became. Nothing is inferred: an employee whose record
// predates this table has no history, and the timeline says so rather than
// reconstructing one.
//
// ─── Why its own file ───
//
// `hrms.ts` is 81KB and already at TypeScript's inference limit — adding a
// table there makes tsc report an employees row as not assignable to itself.
// This is the same `hrms` Postgres schema; only the TypeScript module is
// separate.

import {
  index,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const hrms = pgSchema("hrms");

/**
 * One recorded change to somebody's job.
 *
 * Both sides of every change are stored. Keeping only the new value would mean
 * reconstructing the old one by looking at the previous row, which breaks the
 * moment a row is missing — and the first row would have nothing before it at
 * all.
 *
 * The names are stored alongside the ids on purpose. A department can be
 * renamed or deleted, and "moved to Engineering" must keep saying that even
 * after Engineering becomes Platform, because that is what happened at the
 * time. Ids are kept too, for anything that needs to follow the link.
 */
export const jobHistory = hrms.table(
  "job_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    employeeId: uuid("employee_id").notNull(),

    /** designation | department | manager | employment_type */
    field: text("field").notNull(),

    fromValue: text("from_value"),
    toValue: text("to_value"),

    /** Set for department and manager changes, so the link survives a rename. */
    fromId: uuid("from_id"),
    toId: uuid("to_id"),

    /**
     * The day the change took effect, which is not the day it was typed.
     *
     * HR records a promotion in March that applied from January, and a
     * timeline ordered by when somebody got round to the paperwork is a
     * timeline of the paperwork.
     */
    effectiveOn: timestamp("effective_on", { withTimezone: true }).notNull().defaultNow(),

    /** Free text — "annual cycle", "team restructure". Optional, never invented. */
    note: text("note"),

    /** The account that made the change, for the audit trail. */
    changedById: uuid("changed_by_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("job_history_employee_idx").on(t.employeeId, t.effectiveOn),
    index("job_history_org_idx").on(t.orgId),
  ]
);
