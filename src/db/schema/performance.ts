// ═══════════════════════════════════════════════════════════════
// PERFORMANCE SCHEMA — competencies, 360°, calibration, check-ins
// ═══════════════════════════════════════════════════════════════
// Companion tables to `reviewCycles`, `performanceGoals` and
// `performanceReviews`, which live in hrms.ts and are already sound — they
// carry cascading parent goals and the nine-box axes. They are extended by
// migration 0018 rather than replaced.
//
// The table that needs care is `feedbackResponses`. People are told their 360°
// comments are anonymous and then answer honestly about their manager. The
// respondent id is stored because a cycle has to know who has replied and who
// to chase, but nothing that renders feedback may join through it — which is
// why the aggregation path in the repository never selects it.

import {
  boolean,
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
import { hrms, departments, employees, reviewCycles } from "./hrms";

export const competencies = hrms.table(
  "competencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    /** Behavioural anchors per rating point, so "4" means the same to everyone. */
    behaviouralAnchors: jsonb("behavioural_anchors")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    /** Applies only to these departments; empty means everyone. */
    appliesToDepartmentIds: jsonb("applies_to_department_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Applies only from this grade upwards, e.g. leadership competencies. */
    appliesFromGrade: text("applies_from_grade"),

    weight: integer("weight").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("competencies_org_name_key").on(t.orgId, t.name),
    index("competencies_org_active_idx").on(t.orgId, t.isActive),
  ]
);

export const competencyRatings = hrms.table(
  "competency_ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reviewId: uuid("review_id").notNull(),
    competencyId: uuid("competency_id")
      .notNull()
      .references(() => competencies.id, { onDelete: "cascade" }),

    rating: integer("rating").notNull(),
    /** Weight at the time of rating, frozen so a later change cannot re-score. */
    weight: integer("weight").notNull().default(1),
    comments: text("comments"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("competency_ratings_review_competency_key").on(t.reviewId, t.competencyId),
    index("competency_ratings_org_idx").on(t.orgId),
  ]
);

export const feedbackRelationshipEnum = hrms.enum("feedback_relationship", [
  "peer",
  "direct_report",
  "manager",
  "self",
  "external",
]);

/** One 360° exercise for one person in one cycle. */
export const feedbackRequests = hrms.table(
  "feedback_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycles.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),

    respondentId: uuid("respondent_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    relationship: feedbackRelationshipEnum("relationship").notNull(),

    /** Nominated by the subject, or assigned. Nominations need approval. */
    isNominatedBySubject: boolean("is_nominated_by_subject").notNull().default(false),
    approvedById: uuid("approved_by_id"),

    dueOn: date("due_on"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    declineReason: text("decline_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("feedback_requests_cycle_subject_respondent_key").on(
      t.cycleId,
      t.subjectId,
      t.respondentId
    ),
    index("feedback_requests_subject_idx").on(t.subjectId),
    index("feedback_requests_respondent_idx").on(t.respondentId, t.completedAt),
  ]
);

/**
 * The answers.
 *
 * Deliberately separate from `feedbackRequests`. The request carries who was
 * asked, which the cycle needs in order to chase people; the response carries
 * what was said. Keeping them apart means the aggregation query never has to
 * touch a table containing the respondent's identity, so an accidental
 * `SELECT *` cannot leak it.
 */
export const feedbackResponses = hrms.table(
  "feedback_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => feedbackRequests.id, { onDelete: "cascade" }),

    /** Duplicated so aggregation can group without joining the request. */
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    relationship: feedbackRelationshipEnum("relationship").notNull(),

    ratings: jsonb("ratings").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    strengths: text("strengths"),
    improvements: text("improvements"),
    comments: text("comments"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("feedback_responses_request_key").on(t.requestId),
    index("feedback_responses_subject_idx").on(t.subjectId, t.relationship),
  ]
);

export const calibrationStatusEnum = hrms.enum("calibration_status", [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);

/**
 * A meeting where managers compare ratings across teams.
 *
 * The point is consistency: a 4 in one team should mean what a 4 means in
 * another. The session records both the rating before and after, because "my
 * manager rated me a 4 and I was given a 3" is a conversation that has to be
 * answerable with who changed it and why.
 */
export const calibrationSessions = hrms.table(
  "calibration_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycles.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    facilitatorId: uuid("facilitator_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    participantIds: jsonb("participant_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    /** The target curve in force, snapshotted so the session stays explicable. */
    distributionTarget: jsonb("distribution_target")
      .$type<{ rating: number; targetShare: number; tolerance: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    status: calibrationStatusEnum("status").notNull().default("scheduled"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("calibration_sessions_cycle_idx").on(t.cycleId, t.status)]
);

/**
 * A rating changed at calibration.
 *
 * Insert-only. This is the record that answers "why was my rating lowered?",
 * and a row that can be edited afterwards answers nothing.
 */
export const calibrationAdjustments = hrms.table(
  "calibration_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => calibrationSessions.id, { onDelete: "cascade" }),
    reviewId: uuid("review_id").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),

    ratingBefore: numeric("rating_before", { precision: 3, scale: 1 }),
    ratingAfter: numeric("rating_after", { precision: 3, scale: 1 }).notNull(),
    /** Required: an unexplained downgrade is indefensible at appeal. */
    justification: text("justification").notNull(),

    adjustedById: uuid("adjusted_by_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    adjustedAt: timestamp("adjusted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("calibration_adjustments_session_idx").on(t.sessionId),
    index("calibration_adjustments_employee_idx").on(t.employeeId),
  ]
);

/**
 * Continuous check-ins between formal cycles.
 *
 * The annual review is a poor feedback mechanism on its own — a problem raised
 * in March and first mentioned in December has had nine months to become
 * someone's reason for leaving.
 */
export const checkIns = hrms.table(
  "check_ins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    managerId: uuid("manager_id").references(() => employees.id, { onDelete: "set null" }),

    heldOn: date("held_on").notNull(),
    /** What the employee wrote before the conversation. */
    employeeNotes: text("employee_notes"),
    managerNotes: text("manager_notes"),
    /** Visible only to the manager; not part of the employee's record. */
    privateNotes: text("private_notes"),

    agreedActions: jsonb("agreed_actions")
      .$type<{ description: string; dueOn?: string; completedOn?: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** 1-5, tracked over time as an early warning. */
    moodRating: integer("mood_rating"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("check_ins_employee_held_idx").on(t.employeeId, t.heldOn)]
);
