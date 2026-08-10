// ═══════════════════════════════════════════════════════════════
// ATS SCHEMA — pipeline, scorecards, offers
// ═══════════════════════════════════════════════════════════════
// Companions to hrms.job_postings, hrms.candidates, hrms.applications and
// hrms.interviews, which already exist and are sound. Those are extended by
// migration 0020, not replaced.
//
// `interviewScorecards` carries a `visibleFrom` timestamp rather than relying
// on the application layer to hide unsubmitted work. Panels converge hard on
// the first opinion voiced, so an interviewer must not read the others until
// they have committed their own — and a rule that lives only in a query is one
// refactor from being lost.

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  bigint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./identity";
import {
  hrms,
  applications,
  candidates,
  employees,
  interviews,
  jobPostings,
} from "./hrms";

export const pipelineStageKindEnum = hrms.enum("pipeline_stage_kind", [
  "sourcing",
  "screening",
  "interview",
  "assessment",
  "offer",
  "hired",
]);

/**
 * Configurable stages, replacing the free-text `applications.stage`.
 *
 * A state machine cannot be enforced over arbitrary strings, and a typo like
 * "intervew" produces a candidate who is in no stage at all and drops out of
 * every funnel report.
 */
export const pipelineStages = hrms.table(
  "pipeline_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /** Null means the org-wide default pipeline. */
    jobId: uuid("job_id").references(() => jobPostings.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    sequence: integer("sequence").notNull(),
    kind: pipelineStageKindEnum("kind").notNull().default("screening"),

    requiredScorecards: integer("required_scorecards").notNull().default(0),
    autoRejectBelow: integer("auto_reject_below"),
    /** Days after which an application sitting here is flagged as stalled. */
    staleAfterDays: integer("stale_after_days"),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pipeline_stages_job_sequence_key").on(t.orgId, t.jobId, t.sequence),
    index("pipeline_stages_org_job_idx").on(t.orgId, t.jobId),
  ]
);

/**
 * Every stage movement.
 *
 * Insert-only. An unsuccessful candidate's discrimination claim asks for the
 * record of why they were considered and rejected, and a current-stage column
 * alone answers none of it.
 */
export const applicationEvents = hrms.table(
  "application_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),

    eventType: text("event_type").notNull(),
    fromStageId: uuid("from_stage_id"),
    toStageId: uuid("to_stage_id"),
    actorId: uuid("actor_id").references(() => employees.id, { onDelete: "set null" }),
    reason: text("reason"),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("application_events_application_idx").on(t.applicationId, t.occurredAt)]
);

export const recommendationEnum = hrms.enum("interview_recommendation", [
  "strong_hire",
  "hire",
  "no_hire",
  "strong_no_hire",
]);

export const interviewScorecards = hrms.table(
  "interview_scorecards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    interviewId: uuid("interview_id").references(() => interviews.id, {
      onDelete: "set null",
    }),
    interviewerId: uuid("interviewer_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),

    /** Per competency, 1-5. */
    scores: jsonb("scores").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    recommendation: recommendationEnum("recommendation"),
    strengths: text("strengths"),
    concerns: text("concerns"),
    notes: text("notes"),

    /**
     * Set on submission.
     *
     * Also the gate on reading the rest of the panel: an interviewer with no
     * submission timestamp has not committed an opinion and must not see
     * anyone else's.
     */
    submittedAt: timestamp("submitted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("interview_scorecards_application_interviewer_key").on(
      t.applicationId,
      t.interviewerId,
      t.interviewId
    ),
    index("interview_scorecards_application_idx").on(t.applicationId),
  ]
);

export const offerStatusEnum = hrms.enum("offer_status", [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "accepted",
  "declined",
  "expired",
  "withdrawn",
]);

export const offers = hrms.table(
  "offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),

    /** Revisions are new rows, so a renegotiation keeps both figures. */
    version: integer("version").notNull().default(1),
    supersedesOfferId: uuid("supersedes_offer_id"),

    designation: text("designation").notNull(),
    gradeCode: text("grade_code"),
    annualCtcMinor: bigint("annual_ctc_minor", { mode: "bigint" }).notNull(),
    joiningBonusMinor: bigint("joining_bonus_minor", { mode: "bigint" }),
    equityUnits: integer("equity_units"),
    currency: text("currency").notNull().default("INR"),

    proposedStartDate: date("proposed_start_date"),
    status: offerStatusEnum("status").notNull().default("draft"),
    /** A signing window that never closes is not a window. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    createdById: uuid("created_by_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    approvedById: uuid("approved_by_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    declineReason: text("decline_reason"),

    /** The generated offer letter, once one exists. */
    documentId: uuid("document_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("offers_application_idx").on(t.applicationId, t.version),
    index("offers_org_status_idx").on(t.orgId, t.status),
  ]
);

/**
 * Where each application came from.
 *
 * Separate from a column on the application so a candidate arriving through
 * two channels keeps both. Attribution disputes between an agency and a
 * referral scheme are about real money.
 */
export const applicationSources = hrms.table(
  "application_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),

    source: text("source").notNull(),
    channel: text("channel"),
    campaign: text("campaign"),
    referrerId: uuid("referrer_id").references(() => employees.id, { onDelete: "set null" }),
    agencyName: text("agency_name"),
    /** The first touch wins attribution unless a rule says otherwise. */
    isPrimary: boolean("is_primary").notNull().default(true),

    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("application_sources_application_idx").on(t.applicationId),
    index("application_sources_org_source_idx").on(t.orgId, t.source),
  ]
);
