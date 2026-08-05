// ═══════════════════════════════════════════════════════════════
// SCHEDULING SCHEMA — shift patterns, rosters, swaps, availability
// ═══════════════════════════════════════════════════════════════
// Workforce scheduling for the parts of a company that do not work 09:00-17:00
// Monday to Friday: support desks, facilities, manufacturing, retail, clinical
// staff.
//
// The tables carry the *constraints* alongside the schedule, because a
// published roster has to be defensible months later. "What rest rules were in
// force when this was published?" is a question a labour inspector asks, and
// pointing at today's configuration is not an answer — so the constraint set
// is snapshotted onto the roster at publication.

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./identity";
import { hrms, employees, departments, locations } from "./hrms";

// ─── Shift patterns ──────────────────────────────────────────

export const shiftPatterns = hrms.table(
  "shift_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    code: text("code").notNull(),
    description: text("description"),
    /** Shown on the roster grid so a shift is identifiable at a glance. */
    colour: text("colour").notNull().default("#64748b"),

    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    breakMinutes: integer("break_minutes").notNull().default(0),
    /**
     * Whether the end time falls on the following day.
     *
     * Stored rather than derived from `endTime < startTime`, because a genuine
     * 24-hour shift has identical start and end times and would otherwise
     * compute as zero minutes.
     */
    crossesMidnight: boolean("crosses_midnight").notNull().default(false),

    /** ISO weekday numbers, 1 = Monday. */
    weekdays: jsonb("weekdays").$type<number[]>().notNull().default(sql`'[1,2,3,4,5]'::jsonb`),

    /**
     * Uplift applied to base pay for this shift, as a multiplier. Night and
     * weekend work usually attracts a premium, and payroll needs it from the
     * roster rather than from someone re-keying it.
     */
    payMultiplier: numeric("pay_multiplier", { precision: 5, scale: 3 })
      .notNull()
      .default("1.000"),
    /** Flat allowance per shift in minor units, on top of any multiplier. */
    allowanceMinor: integer("allowance_minor").notNull().default(0),

    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shift_patterns_org_code_key").on(t.orgId, t.code),
    index("shift_patterns_org_active_idx").on(t.orgId, t.isActive),
  ]
);

/**
 * Which employees may work which patterns.
 *
 * Not everyone can work every shift: night work needs a health assessment in
 * many jurisdictions, and some patterns need a certification. Without this
 * table the generator would happily roster an untrained person onto a shift
 * they legally cannot cover.
 */
export const shiftEligibility = hrms.table(
  "shift_eligibility",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    patternId: uuid("pattern_id")
      .notNull()
      .references(() => shiftPatterns.id, { onDelete: "cascade" }),

    /** Certifications lapse; an eligibility that never expires is a liability. */
    validFrom: date("valid_from"),
    validUntil: date("valid_until"),
    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shift_eligibility_employee_pattern_key").on(t.employeeId, t.patternId),
    index("shift_eligibility_org_idx").on(t.orgId),
  ]
);

// ─── Availability ────────────────────────────────────────────

export const availabilityKindEnum = hrms.enum("availability_kind", [
  "unavailable",
  "preferred",
  "leave",
  "training",
  "holiday",
]);

/**
 * When someone can or cannot work.
 *
 * `leave` entries are projected here from approved leave requests rather than
 * being entered twice — a roster that ignores approved leave is the single
 * most common scheduling complaint.
 */
export const availability = hrms.table(
  "availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),

    kind: availabilityKindEnum("kind").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    /** Null means the whole day. */
    startTime: time("start_time"),
    endTime: time("end_time"),

    reason: text("reason"),
    /** The leave request this was projected from, if any. */
    sourceLeaveRequestId: uuid("source_leave_request_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("availability_org_employee_idx").on(t.orgId, t.employeeId),
    index("availability_range_idx").on(t.orgId, t.startDate, t.endDate),
  ]
);

// ─── Rosters ─────────────────────────────────────────────────

export const rosterStatusEnum = hrms.enum("roster_status", [
  "draft",
  "pending_approval",
  "published",
  "archived",
]);

export const rosters = hrms.table(
  "rosters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),

    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),

    status: rosterStatusEnum("status").notNull().default("draft"),

    /**
     * The constraint set in force at publication, snapshotted.
     *
     * Configuration changes; a published roster must stay explicable against
     * the rules it was published under.
     */
    constraintsSnapshot: jsonb("constraints_snapshot").$type<{
      minRestHours: number;
      maxHoursPerWeek: number;
      maxConsecutiveDays: number;
      maxShiftsPerDay: number;
      minDaysOffPerWeek: number;
    }>(),
    /**
     * Violations accepted at publication with a reason.
     *
     * Blocking violations cannot be published, but warnings sometimes are —
     * and a manager overriding one should have to say why.
     */
    acceptedWarnings: jsonb("accepted_warnings")
      .$type<{ code: string; employeeId: string; date: string; justification: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    publishedById: uuid("published_by_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),

    createdById: uuid("created_by_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rosters_org_period_idx").on(t.orgId, t.periodStart, t.periodEnd),
    index("rosters_org_status_idx").on(t.orgId, t.status),
  ]
);

export const assignmentStatusEnum = hrms.enum("roster_assignment_status", [
  "scheduled",
  "confirmed",
  "swapped_out",
  "cancelled",
  "completed",
  "no_show",
]);

export const rosterAssignments = hrms.table(
  "roster_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    rosterId: uuid("roster_id")
      .notNull()
      .references(() => rosters.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    patternId: uuid("pattern_id")
      .notNull()
      .references(() => shiftPatterns.id, { onDelete: "restrict" }),

    shiftDate: date("shift_date").notNull(),
    /**
     * Absolute instants, not just a date plus the pattern's times.
     *
     * The pattern may be edited after publication; the assignment must keep
     * the hours the employee was actually asked to work.
     */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),

    status: assignmentStatusEnum("status").notNull().default("scheduled"),
    /** Set when this assignment was created by a swap, pointing at the original. */
    replacesAssignmentId: uuid("replaces_assignment_id"),
    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("roster_assignments_roster_idx").on(t.rosterId),
    index("roster_assignments_employee_date_idx").on(t.employeeId, t.shiftDate),
    index("roster_assignments_org_date_idx").on(t.orgId, t.shiftDate),
  ]
);

// ─── Swaps and open shifts ───────────────────────────────────

export const swapStatusEnum = hrms.enum("shift_swap_status", [
  "open",
  "accepted",
  "pending_approval",
  "approved",
  "rejected",
  "cancelled",
  "expired",
]);

/**
 * A request to hand a shift to someone else.
 *
 * Two-step by design: a colleague accepts, then a manager approves. The
 * colleague's agreement does not make an illegal roster legal, so the
 * constraint check runs again at approval — by then the recipient's schedule
 * may have changed.
 */
export const shiftSwapRequests = hrms.table(
  "shift_swap_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => rosterAssignments.id, { onDelete: "cascade" }),
    requestedById: uuid("requested_by_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** Null means offered to anyone eligible rather than to one person. */
    targetEmployeeId: uuid("target_employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    acceptedById: uuid("accepted_by_id").references(() => employees.id, {
      onDelete: "set null",
    }),

    status: swapStatusEnum("status").notNull().default("open"),
    reason: text("reason"),

    /** Why it was refused, whether by a constraint or by a manager. */
    rejectionReason: text("rejection_reason"),
    approvedById: uuid("approved_by_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    /** An open swap for a shift that has already started is noise. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shift_swaps_org_status_idx").on(t.orgId, t.status),
    index("shift_swaps_assignment_idx").on(t.assignmentId),
    index("shift_swaps_target_idx").on(t.targetEmployeeId),
  ]
);

/** Coverage a roster needs but has nobody assigned to. */
export const openShifts = hrms.table(
  "open_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    rosterId: uuid("roster_id")
      .notNull()
      .references(() => rosters.id, { onDelete: "cascade" }),
    patternId: uuid("pattern_id")
      .notNull()
      .references(() => shiftPatterns.id, { onDelete: "cascade" }),

    shiftDate: date("shift_date").notNull(),
    headcountNeeded: integer("headcount_needed").notNull().default(1),
    /** Why the generator could not fill it, carried through for the manager. */
    reason: text("reason"),

    claimedById: uuid("claimed_by_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("open_shifts_roster_idx").on(t.rosterId),
    index("open_shifts_org_date_idx").on(t.orgId, t.shiftDate),
  ]
);

/** Coverage requirements a roster is generated against. */
export const coverageRequirements = hrms.table(
  "coverage_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    patternId: uuid("pattern_id")
      .notNull()
      .references(() => shiftPatterns.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "cascade",
    }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),

    /** ISO weekday, 1 = Monday. Null means the rule applies every day. */
    weekday: integer("weekday"),
    headcount: integer("headcount").notNull().default(1),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("coverage_requirements_org_pattern_idx").on(t.orgId, t.patternId)]
);
