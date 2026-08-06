// ═══════════════════════════════════════════════════════════════
// GOVERNANCE SCHEMA — retention, legal holds, erasure, consent
// ═══════════════════════════════════════════════════════════════
// The record of what was kept, what was destroyed, and on what authority.
//
// Every table here is append-heavy on purpose. When a regulator asks why a
// record was destroyed, or a former employee asks what happened to their data,
// the answer has to be evidence rather than recollection — and a row that was
// updated in place cannot show what it used to say.

import {
  boolean,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, users } from "./identity";
import { hrms, employees } from "./hrms";

export const erasureMethodEnum = hrms.enum("erasure_method", [
  "delete",
  "anonymise",
  "pseudonymise",
  "retain",
]);

export const retentionAnchorEnum = hrms.enum("retention_anchor", [
  "created_at",
  "exit_date",
  "closed_at",
  "period_end",
]);

export const retentionPolicies = hrms.table(
  "retention_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    entityType: text("entity_type").notNull(),
    retainForMonths: integer("retain_for_months").notNull(),
    anchor: retentionAnchorEnum("anchor").notNull().default("created_at"),
    method: erasureMethodEnum("method").notNull().default("anonymise"),

    /**
     * The statute or policy requiring this period.
     *
     * Not decoration. A policy with no stated basis is one nobody can defend
     * when challenged, or safely change when the law does.
     */
    basis: text("basis").notNull(),
    /** Overrides an erasure request: a tax obligation beats a deletion wish. */
    overridesErasure: boolean("overrides_erasure").notNull().default(false),

    isActive: boolean("is_active").notNull().default(true),
    createdById: uuid("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("retention_policies_org_entity_key").on(t.orgId, t.entityType),
    index("retention_policies_org_active_idx").on(t.orgId, t.isActive),
  ]
);

/**
 * Suspends retention and erasure for specific records.
 *
 * Destroying evidence during litigation is a far worse outcome than keeping a
 * record past its schedule, so a hold beats everything else.
 */
export const legalHolds = hrms.table(
  "legal_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    reference: text("reference").notNull(),
    reason: text("reason").notNull(),
    entityType: text("entity_type").notNull(),
    /** Null holds every record of the type — a blanket hold on a matter. */
    entityId: uuid("entity_id"),

    placedById: uuid("placed_by_id"),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    /** A hold with no end date is one nobody ever lifts. */
    reviewOn: text("review_on"),
    releasedById: uuid("released_by_id"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason"),
  },
  (t) => [
    index("legal_holds_org_entity_idx").on(t.orgId, t.entityType, t.entityId),
    index("legal_holds_reference_idx").on(t.orgId, t.reference),
  ]
);

export const dataRequestTypeEnum = hrms.enum("data_request_type", [
  "access",
  "erasure",
  "rectification",
  "portability",
  "restriction",
  "objection",
]);

export const dataRequestStatusEnum = hrms.enum("data_request_status", [
  "received",
  "identity_pending",
  "in_progress",
  "awaiting_approval",
  "completed",
  "partially_completed",
  "refused",
]);

/**
 * A data subject's request.
 *
 * `dueOn` exists because these are time-limited by statute — a month under
 * GDPR, and a request quietly sitting in someone's inbox is a breach in
 * itself, separate from whatever it asked about.
 */
export const dataSubjectRequests = hrms.table(
  "data_subject_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    requestType: dataRequestTypeEnum("request_type").notNull(),
    status: dataRequestStatusEnum("status").notNull().default("received"),

    /** The person the data is about, who may no longer be an employee. */
    subjectEmployeeId: uuid("subject_employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    subjectEmail: text("subject_email").notNull(),
    subjectName: text("subject_name"),

    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    dueOn: text("due_on").notNull(),
    identityVerifiedAt: timestamp("identity_verified_at", { withTimezone: true }),
    identityVerifiedById: uuid("identity_verified_by_id"),

    /** The plan, reviewed before anything irreversible happens. */
    plan: jsonb("plan")
      .$type<{ area: string; method: string; reason: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    approvedById: uuid("approved_by_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** What was actually done, recorded after the fact. */
    outcome: jsonb("outcome")
      .$type<{ area: string; method: string; rowsAffected: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Areas withheld, with the obligation that required it. */
    refusedAreas: jsonb("refused_areas")
      .$type<{ area: string; reason: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    refusalReason: text("refusal_reason"),

    handledById: uuid("handled_by_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("data_subject_requests_org_status_idx").on(t.orgId, t.status),
    index("data_subject_requests_due_idx").on(t.orgId, t.dueOn),
    index("data_subject_requests_subject_idx").on(t.orgId, t.subjectEmail),
  ]
);

/**
 * What a retention or erasure run actually did.
 *
 * Insert-only. This is the evidence that a destruction was authorised and
 * scoped, and a log that can be edited proves nothing.
 */
export const erasureLog = hrms.table(
  "erasure_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    requestId: uuid("request_id").references(() => dataSubjectRequests.id, {
      onDelete: "set null",
    }),
    /** Null when the run came from a retention schedule rather than a request. */
    policyId: uuid("policy_id").references(() => retentionPolicies.id, {
      onDelete: "set null",
    }),

    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    area: text("area").notNull(),
    method: erasureMethodEnum("method").notNull(),
    rowsAffected: integer("rows_affected").notNull().default(0),
    /** The pseudonym issued, when the method was pseudonymise. */
    pseudonym: text("pseudonym"),

    basis: text("basis").notNull(),
    performedById: uuid("performed_by_id"),
    performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("erasure_log_org_performed_idx").on(t.orgId, t.performedAt),
    index("erasure_log_entity_idx").on(t.orgId, t.entityType, t.entityId),
  ]
);

/**
 * Consent, recorded per purpose and per policy version.
 *
 * Append-only: withdrawing consent adds a row rather than deleting the grant,
 * because proving consent *was* held at the time of a past processing is the
 * whole point of keeping the record.
 */
export const consentRecords = hrms.table(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    subjectUserId: uuid("subject_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    subjectEmail: text("subject_email").notNull(),

    purpose: text("purpose").notNull(),
    policyVersion: integer("policy_version").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),

    /** Evidence of how consent was captured. */
    capturedVia: text("captured_via"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("consent_records_subject_purpose_idx").on(t.orgId, t.subjectEmail, t.purpose),
  ]
);

/**
 * The register of what personal data the organisation holds and why.
 *
 * Required by GDPR Article 30, and the thing nobody maintains until an
 * auditor asks. Keeping it as rows next to the schema it describes at least
 * gives it a chance of staying true.
 */
export const processingActivities = hrms.table(
  "processing_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    purpose: text("purpose").notNull(),
    lawfulBasis: text("lawful_basis").notNull(),
    dataCategories: jsonb("data_categories").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    dataSubjects: jsonb("data_subjects").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    recipients: jsonb("recipients").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Countries data is transferred to, and the safeguard relied on. */
    transfers: jsonb("transfers")
      .$type<{ country: string; safeguard: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    retentionPolicyId: uuid("retention_policy_id").references(() => retentionPolicies.id, {
      onDelete: "set null",
    }),
    securityMeasures: text("security_measures"),

    ownerId: uuid("owner_id"),
    lastReviewedOn: text("last_reviewed_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("processing_activities_org_idx").on(t.orgId)]
);
