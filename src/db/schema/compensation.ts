// ═══════════════════════════════════════════════════════════════
// COMPENSATION SCHEMA — bands, merit cycles, budgets, equity
// ═══════════════════════════════════════════════════════════════
// Money is bigint minor units throughout, the same as payroll. A merit cycle
// applies a percentage to thousands of salaries and sums them against a
// budget; float loses that sum, and the amount it loses it by is somebody's
// raise.

import {
  boolean,
  bigint,
  date,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./identity";
import { hrms, departments, employees, locations } from "./hrms";

export const salaryBands = hrms.table(
  "salary_bands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    gradeCode: text("grade_code").notNull(),
    name: text("name").notNull(),
    /** Bands differ by market; the same grade is not the same money everywhere. */
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    jobFamily: text("job_family"),

    minMinor: bigint("min_minor", { mode: "bigint" }).notNull(),
    midMinor: bigint("mid_minor", { mode: "bigint" }).notNull(),
    maxMinor: bigint("max_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("INR"),

    /** External benchmark this band was set against, for the next review. */
    benchmarkSource: text("benchmark_source"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("salary_bands_org_grade_location_key").on(t.orgId, t.gradeCode, t.locationId),
    index("salary_bands_org_active_idx").on(t.orgId, t.isActive),
  ]
);

export const cycleStatusEnum = hrms.enum("comp_cycle_status", [
  "planning",
  "manager_input",
  "calibration",
  "approval",
  "approved",
  "applied",
  "cancelled",
]);

export const compensationCycles = hrms.table(
  "compensation_cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    status: cycleStatusEnum("status").notNull().default("planning"),

    /** The period performance is being rewarded for. */
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    /** When approved increases take effect in payroll. */
    effectiveOn: date("effective_on").notNull(),

    /** Eligibility: minimum months of service at the effective date. */
    minimumTenureMonths: integer("minimum_tenure_months").notNull().default(0),
    /**
     * Whether someone who joined mid-period gets a prorated increase.
     *
     * A full increase for two months' service is a raise the rest of the team
     * funded, so this defaults on.
     */
    prorateNewJoiners: boolean("prorate_new_joiners").notNull().default(true),

    /**
     * The matrix in force, snapshotted.
     *
     * Guidelines get retuned between cycles. A completed cycle must stay
     * explicable against the rules it ran under, or nobody can answer "why did
     * I get 6%?" a year later.
     */
    meritMatrix: jsonb("merit_matrix")
      .$type<Record<string, [number, number, number, number]>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    managerInputClosesOn: date("manager_input_closes_on"),
    approvedById: uuid("approved_by_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),

    createdById: uuid("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("compensation_cycles_org_status_idx").on(t.orgId, t.status)]
);

/**
 * A pot of money a set of recommendations draws from.
 *
 * Split by department so one manager cannot spend another's budget, which is
 * the whole reason budgets are delegated rather than held centrally.
 */
export const budgetPools = hrms.table(
  "budget_pools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => compensationCycles.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "cascade",
    }),
    /** Merit, promotion and market adjustment are different pots. */
    purpose: text("purpose").notNull().default("merit"),

    allocatedMinor: bigint("allocated_minor", { mode: "bigint" }).notNull(),
    /**
     * Maintained by the database as recommendations are approved.
     *
     * Application-level accounting would let two concurrent approvals both
     * read the same committed figure and both fit.
     */
    committedMinor: bigint("committed_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    currency: text("currency").notNull().default("INR"),

    ownerId: uuid("owner_id").references(() => employees.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("budget_pools_cycle_idx").on(t.cycleId),
    uniqueIndex("budget_pools_cycle_dept_purpose_key").on(
      t.cycleId,
      t.departmentId,
      t.purpose
    ),
  ]
);

export const recommendationStatusEnum = hrms.enum("comp_recommendation_status", [
  "draft",
  "submitted",
  "calibrated",
  "approved",
  "rejected",
  "applied",
]);

export const compensationRecommendations = hrms.table(
  "compensation_recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => compensationCycles.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    poolId: uuid("pool_id").references(() => budgetPools.id, { onDelete: "set null" }),

    /** Salary at the moment the cycle opened, frozen. */
    currentSalaryMinor: bigint("current_salary_minor", { mode: "bigint" }).notNull(),
    bandId: uuid("band_id").references(() => salaryBands.id, { onDelete: "set null" }),
    compaRatio: numeric("compa_ratio", { precision: 6, scale: 4 }),
    quartile: integer("quartile"),
    rating: text("rating"),

    /** What the matrix suggested, kept even after a manager overrides it. */
    systemPercent: numeric("system_percent", { precision: 6, scale: 2 }),
    systemIncreaseMinor: bigint("system_increase_minor", { mode: "bigint" }),

    /** What the manager actually proposed. */
    proposedPercent: numeric("proposed_percent", { precision: 6, scale: 2 }),
    proposedIncreaseMinor: bigint("proposed_increase_minor", { mode: "bigint" }),
    /**
     * Why the manager departed from the guideline.
     *
     * Required by the repository whenever the proposal differs from the
     * system figure. An unexplained override is indefensible at calibration
     * and impossible to answer for at an equal-pay claim.
     */
    overrideReason: text("override_reason"),

    /** Set after calibration, which may adjust the proposal again. */
    finalPercent: numeric("final_percent", { precision: 6, scale: 2 }),
    finalIncreaseMinor: bigint("final_increase_minor", { mode: "bigint" }),
    newSalaryMinor: bigint("new_salary_minor", { mode: "bigint" }),

    promotionToGradeCode: text("promotion_to_grade_code"),
    /** Warnings raised at generation, carried through to the approver. */
    warnings: jsonb("warnings").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    rationale: text("rationale"),

    status: recommendationStatusEnum("status").notNull().default("draft"),
    submittedById: uuid("submitted_by_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedById: uuid("approved_by_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("comp_recommendations_cycle_employee_key").on(t.cycleId, t.employeeId),
    index("comp_recommendations_cycle_status_idx").on(t.cycleId, t.status),
    index("comp_recommendations_pool_idx").on(t.poolId),
  ]
);

export const equityGrants = hrms.table(
  "equity_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),

    grantNumber: text("grant_number").notNull(),
    instrument: text("instrument").notNull().default("option"),
    totalUnits: integer("total_units").notNull(),
    strikePriceMinor: bigint("strike_price_minor", { mode: "bigint" }),
    currency: text("currency").notNull().default("INR"),

    grantDate: date("grant_date").notNull(),
    cliffMonths: integer("cliff_months").notNull().default(12),
    vestingMonths: integer("vesting_months").notNull().default(48),
    cadenceMonths: integer("cadence_months").notNull().default(1),

    /** Set when someone leaves; unvested units lapse at this date. */
    terminationDate: date("termination_date"),
    /** Units already exercised, which cannot exceed the vested total. */
    exercisedUnits: integer("exercised_units").notNull().default(0),
    cancelledUnits: integer("cancelled_units").notNull().default(0),

    boardApprovalDate: date("board_approval_date"),
    agreementDocumentId: uuid("agreement_document_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("equity_grants_org_number_key").on(t.orgId, t.grantNumber),
    index("equity_grants_employee_idx").on(t.employeeId),
  ]
);

/**
 * Salary history.
 *
 * Insert-only. "What was this person paid in March 2025?" is asked by payroll
 * reconciliation, by equal-pay analysis and by litigation, and a salary column
 * that is updated in place cannot answer any of them.
 */
export const salaryHistory = hrms.table(
  "salary_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),

    previousSalaryMinor: bigint("previous_salary_minor", { mode: "bigint" }),
    newSalaryMinor: bigint("new_salary_minor", { mode: "bigint" }).notNull(),
    changePercent: numeric("change_percent", { precision: 6, scale: 2 }),
    currency: text("currency").notNull().default("INR"),

    reason: text("reason").notNull(),
    cycleId: uuid("cycle_id").references(() => compensationCycles.id, {
      onDelete: "set null",
    }),
    recommendationId: uuid("recommendation_id").references(
      () => compensationRecommendations.id,
      { onDelete: "set null" }
    ),

    effectiveOn: date("effective_on").notNull(),
    approvedById: uuid("approved_by_id"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("salary_history_employee_effective_idx").on(t.employeeId, t.effectiveOn),
    index("salary_history_org_cycle_idx").on(t.orgId, t.cycleId),
  ]
);
