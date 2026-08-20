// ═══════════════════════════════════════════════════════════════
// TALENT SCHEMA — referrals, benefits, learning, documents
// ═══════════════════════════════════════════════════════════════
// Separated from hrms.ts, which already carries the core employment record.
// These are the modules where an employee is a participant rather than a
// subject: they refer people, elect benefits, take courses and sign documents.

import {
  bigint,
  boolean,
  date,
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
import { hrms, employees, departments, jobPostings, candidates } from "./hrms";

// ─── Referrals ───────────────────────────────────────────────

/**
 * Referral pipeline stages.
 *
 * Deliberately mirrors the ATS application stages rather than inventing a
 * parallel vocabulary. The previous implementation had two conflicting sets —
 * one store said `applied|screening|interview|offer|hired|rejected`, the live
 * one said `submitted|interviewing|hired|rejected` — so the same referral
 * meant different things depending on which file you read.
 */
export const referralStatusEnum = hrms.enum("referral_status", [
  "submitted",
  "screening",
  "interviewing",
  "offered",
  "hired",
  "rejected",
  "withdrawn",
  "duplicate",
]);

export const referralPayoutStatusEnum = hrms.enum("referral_payout_status", [
  "not_eligible",
  "pending_milestone",
  "approved",
  "paid",
  "forfeited",
]);

export const referrals = hrms.table(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /** The employee making the referral. */
    referrerId: uuid("referrer_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),

    /**
     * The ATS candidate this referral created. Populated when the referral is
     * accepted into the pipeline.
     *
     * The previous implementation stored a candidate name as free text and
     * never created a candidate at all, so a referred person and the same
     * person applying directly were invisible to each other — and the
     * `candidates.referred_by_id` column existed with nothing writing to it.
     */
    candidateId: uuid("candidate_id").references(() => candidates.id, {
      onDelete: "set null",
    }),
    jobId: uuid("job_id").references(() => jobPostings.id, { onDelete: "set null" }),

    // Captured at submission, before a candidate record exists.
    candidateName: text("candidate_name").notNull(),
    candidateEmail: text("candidate_email").notNull(),
    candidatePhone: text("candidate_phone"),
    positionTitle: text("position_title").notNull(),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    resumeUrl: text("resume_url"),
    /** Why the referrer thinks this person is a fit. */
    recommendation: text("recommendation"),
    relationship: text("relationship"),

    status: referralStatusEnum("status").notNull().default("submitted"),
    rejectionReason: text("rejection_reason"),

    // ── Bonus ──
    /**
     * Bonus in minor units, resolved from policy at submission so a later
     * policy change does not silently alter what someone was promised.
     */
    bonusAmountMinor: bigint("bonus_amount_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    currency: text("currency").notNull().default("INR"),
    payoutStatus: referralPayoutStatusEnum("payout_status")
      .notNull()
      .default("not_eligible"),
    /**
     * Bonuses are typically conditional on the hire staying a qualifying
     * period. This is the date that condition is met.
     */
    payoutEligibleOn: date("payout_eligible_on"),
    payoutApprovedById: uuid("payout_approved_by_id"),
    payoutApprovedAt: timestamp("payout_approved_at", { withTimezone: true }),
    /** The payroll run that actually paid it, so the money is traceable. */
    payoutPayrollRunId: uuid("payout_payroll_run_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    forfeitedReason: text("forfeited_reason"),

    hiredEmployeeId: uuid("hired_employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    hiredOn: date("hired_on"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One referral per candidate email per job. Two colleagues referring the
    // same person for the same role is the classic dispute, and the bonus
    // rules need a deterministic "who was first".
    uniqueIndex("referrals_org_email_job_key").on(t.orgId, t.candidateEmail, t.jobId),
    index("referrals_org_status_idx").on(t.orgId, t.status),
    index("referrals_referrer_idx").on(t.referrerId),
    index("referrals_payout_idx").on(t.orgId, t.payoutStatus),
  ]
);

/**
 * Referral bonus policy, per organization.
 *
 * Amounts vary by seniority and by how hard a role is to fill; a flat bonus
 * makes the scheme useless for exactly the roles it is meant to help with.
 */
export const referralPolicies = hrms.table(
  "referral_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Null matches any department. */
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "cascade",
    }),
    /** Matched against the job posting's seniority; null matches any. */
    seniority: text("seniority"),
    bonusAmountMinor: bigint("bonus_amount_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("INR"),
    /** Days the hire must remain before the bonus is payable. */
    qualifyingPeriodDays: integer("qualifying_period_days").notNull().default(90),
    /** Paid in instalments, e.g. half on joining and half at 6 months. */
    instalments: jsonb("instalments").notNull().default(sql`'[]'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("referral_policies_org_idx").on(t.orgId, t.isActive)]
);

/** Immutable record of every stage change, for disputes about who referred first. */
export const referralEvents = hrms.table(
  "referral_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    referralId: uuid("referral_id")
      .notNull()
      .references(() => referrals.id, { onDelete: "cascade" }),
    fromStatus: referralStatusEnum("from_status"),
    toStatus: referralStatusEnum("to_status").notNull(),
    actorId: uuid("actor_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("referral_events_referral_idx").on(t.referralId, t.createdAt)]
);

// ─── Benefits ────────────────────────────────────────────────

export const benefitTypeEnum = hrms.enum("benefit_type", [
  "health_insurance",
  "life_insurance",
  "accident_insurance",
  "retirement",
  "wellness",
  "meal",
  "transport",
  "education",
  "childcare",
  "other",
]);

export const benefitPlans = hrms.table(
  "benefit_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    benefitType: benefitTypeEnum("benefit_type").notNull(),
    provider: text("provider"),
    policyNumber: text("policy_number"),
    description: text("description"),

    /** Employer and employee shares of the annual premium, in minor units. */
    employerContributionMinor: bigint("employer_contribution_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    employeeContributionMinor: bigint("employee_contribution_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    currency: text("currency").notNull().default("INR"),
    /** Sum insured or equivalent cap. */
    coverageAmountMinor: bigint("coverage_amount_minor", { mode: "bigint" }),

    /** Whether dependants may be added, and which relations qualify. */
    allowsDependants: boolean("allows_dependants").notNull().default(false),
    eligibleRelations: jsonb("eligible_relations").notNull().default(sql`'[]'::jsonb`),
    maxDependants: integer("max_dependants"),

    /** Conditions an employee must meet, evaluated like workflow conditions. */
    eligibilityRules: jsonb("eligibility_rules").notNull().default(sql`'{}'::jsonb`),
    /** Enrolled automatically rather than elected. */
    isAutoEnrolled: boolean("is_auto_enrolled").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),

    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    documentUrl: text("document_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("benefit_plans_org_active_idx").on(t.orgId, t.isActive)]
);

/**
 * Open-enrolment window.
 *
 * Elections outside a window are refused. Without this, benefits become
 * adverse-selectable: someone elects health cover the week they need surgery
 * and drops it after.
 */
export const enrolmentWindows = hrms.table(
  "enrolment_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    opensOn: date("opens_on").notNull(),
    closesOn: date("closes_on").notNull(),
    /** Cover starts from this date for elections made in this window. */
    coverageStartsOn: date("coverage_starts_on").notNull(),
    planIds: jsonb("plan_ids").notNull().default(sql`'[]'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("enrolment_windows_org_dates_idx").on(t.orgId, t.opensOn, t.closesOn)]
);

export const enrolmentStatusEnum = hrms.enum("enrolment_status", [
  "elected",
  "active",
  "waived",
  "terminated",
]);

export const benefitEnrolments = hrms.table(
  "benefit_enrolments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => benefitPlans.id, { onDelete: "restrict" }),
    windowId: uuid("window_id").references(() => enrolmentWindows.id, {
      onDelete: "set null",
    }),

    status: enrolmentStatusEnum("status").notNull().default("elected"),
    /** Election is per plan-year, so history is preserved across renewals. */
    planYear: integer("plan_year").notNull(),
    coverageFrom: date("coverage_from"),
    coverageTo: date("coverage_to"),

    /** Recomputed at election: dependants change the employee's share. */
    employeeCostMinor: bigint("employee_cost_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    employerCostMinor: bigint("employer_cost_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),

    waiverReason: text("waiver_reason"),
    terminatedOn: date("terminated_on"),
    terminationReason: text("termination_reason"),

    electedAt: timestamp("elected_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One election per plan per year. Re-electing is an update, not a second
    // row, or the payroll deduction would double.
    uniqueIndex("benefit_enrolments_employee_plan_year_key").on(
      t.employeeId,
      t.planId,
      t.planYear
    ),
    index("benefit_enrolments_org_status_idx").on(t.orgId, t.status),
  ]
);

export const dependants = hrms.table(
  "dependants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    relation: text("relation").notNull(),
    dateOfBirth: date("date_of_birth"),
    gender: text("gender"),
    /** Identity document reference, encrypted at rest. */
    identifier: text("identifier"),
    isNominee: boolean("is_nominee").notNull().default(false),
    nomineeSharePercent: integer("nominee_share_percent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("dependants_employee_idx").on(t.employeeId)]
);

/** Which dependants are covered by which election. */
export const enrolmentDependants = hrms.table(
  "enrolment_dependants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    enrolmentId: uuid("enrolment_id")
      .notNull()
      .references(() => benefitEnrolments.id, { onDelete: "cascade" }),
    dependantId: uuid("dependant_id")
      .notNull()
      .references(() => dependants.id, { onDelete: "cascade" }),
    addedCostMinor: bigint("added_cost_minor", { mode: "bigint" }).notNull().default(sql`0`),
  },
  (t) => [
    uniqueIndex("enrolment_dependants_key").on(t.enrolmentId, t.dependantId),
  ]
);

export const benefitClaims = hrms.table(
  "benefit_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    enrolmentId: uuid("enrolment_id")
      .notNull()
      .references(() => benefitEnrolments.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    dependantId: uuid("dependant_id").references(() => dependants.id, {
      onDelete: "set null",
    }),
    claimNumber: text("claim_number").notNull(),
    claimedAmountMinor: bigint("claimed_amount_minor", { mode: "bigint" }).notNull(),
    approvedAmountMinor: bigint("approved_amount_minor", { mode: "bigint" }),
    incidentDate: date("incident_date").notNull(),
    description: text("description"),
    documents: jsonb("documents").notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("submitted"),
    providerReference: text("provider_reference"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("benefit_claims_org_number_key").on(t.orgId, t.claimNumber),
    index("benefit_claims_employee_idx").on(t.employeeId),
  ]
);

// ─── Learning ────────────────────────────────────────────────

export const courseFormatEnum = hrms.enum("course_format", [
  "self_paced",
  "instructor_led",
  "blended",
  "external",
]);

export const courses = hrms.table(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    code: text("code").notNull(),
    description: text("description"),
    category: text("category"),
    format: courseFormatEnum("format").notNull().default("self_paced"),
    durationMinutes: integer("duration_minutes"),
    /** Skills this course develops, matched against competency gaps. */
    skills: jsonb("skills").notNull().default(sql`'[]'::jsonb`),
    prerequisiteCourseIds: jsonb("prerequisite_course_ids").notNull().default(sql`'[]'::jsonb`),

    /** Everyone matching these rules must complete it — compliance training. */
    isMandatory: boolean("is_mandatory").notNull().default(false),
    mandatoryForRules: jsonb("mandatory_for_rules").notNull().default(sql`'{}'::jsonb`),
    /** Days after completion before it must be retaken. */
    recertifyAfterDays: integer("recertify_after_days"),

    passingScorePercent: integer("passing_score_percent").default(70),
    maxAttempts: integer("max_attempts"),
    providerName: text("provider_name"),
    externalUrl: text("external_url"),
    thumbnailUrl: text("thumbnail_url"),
    costMinor: bigint("cost_minor", { mode: "bigint" }),
    isPublished: boolean("is_published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("courses_org_code_key").on(t.orgId, t.code),
    index("courses_org_published_idx").on(t.orgId, t.isPublished),
  ]
);

export const courseModules = hrms.table(
  "course_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sequence: integer("sequence").notNull(),
    contentType: text("content_type").notNull().default("video"),
    contentUrl: text("content_url"),
    contentBody: text("content_body"),
    durationMinutes: integer("duration_minutes"),
    isOptional: boolean("is_optional").notNull().default(false),
    /** Questions for an end-of-module check. */
    assessment: jsonb("assessment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("course_modules_course_sequence_key").on(t.courseId, t.sequence)]
);

export const enrolmentStateEnum = hrms.enum("course_enrolment_state", [
  "assigned",
  "in_progress",
  "completed",
  "failed",
  "expired",
  "waived",
]);

export const courseEnrolments = hrms.table(
  "course_enrolments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),

    state: enrolmentStateEnum("state").notNull().default("assigned"),
    /** Derived from module completion, not entered by hand. */
    progressPercent: integer("progress_percent").notNull().default(0),
    /** Module ids finished, so progress survives a course gaining a module. */
    completedModuleIds: jsonb("completed_module_ids").notNull().default(sql`'[]'::jsonb`),

    scorePercent: integer("score_percent"),
    attempts: integer("attempts").notNull().default(0),
    timeSpentMinutes: integer("time_spent_minutes").notNull().default(0),

    assignedById: uuid("assigned_by_id"),
    dueOn: date("due_on"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** When recertification falls due, from the course's recertify window. */
    expiresOn: date("expires_on"),
    certificateUrl: text("certificate_url"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("course_enrolments_employee_idx").on(t.employeeId, t.state),
    index("course_enrolments_org_course_idx").on(t.orgId, t.courseId),
    // Recertification means an employee legitimately takes a course more than
    // once, so this is not unique on (employee, course).
    index("course_enrolments_expiry_idx").on(t.orgId, t.expiresOn),
  ]
);

export const certifications = hrms.table(
  "certifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    issuingBody: text("issuing_body"),
    credentialId: text("credential_id"),
    credentialUrl: text("credential_url"),
    /** Set when earned in-platform rather than externally. */
    courseEnrolmentId: uuid("course_enrolment_id").references(() => courseEnrolments.id, {
      onDelete: "set null",
    }),
    issuedOn: date("issued_on").notNull(),
    expiresOn: date("expires_on"),
    isVerified: boolean("is_verified").notNull().default(false),
    verifiedById: uuid("verified_by_id"),
    documentUrl: text("document_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("certifications_employee_idx").on(t.employeeId),
    // Drives the "expiring soon" report; a lapsed safety certification is a
    // compliance breach, not an inconvenience.
    index("certifications_org_expiry_idx").on(t.orgId, t.expiresOn),
  ]
);

// ─── Documents & e-signature ─────────────────────────────────

export const documentTemplates = hrms.table(
  "document_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    /** Body with {{token}} placeholders resolved against the employee record. */
    body: text("body").notNull(),
    /** Tokens the template uses, for validating before a generation run. */
    requiredTokens: jsonb("required_tokens").notNull().default(sql`'[]'::jsonb`),
    requiresSignature: boolean("requires_signature").notNull().default(false),
    /** Ordered roles that must sign, e.g. ["employee", "hr"]. */
    signatoryRoles: jsonb("signatory_roles").notNull().default(sql`'[]'::jsonb`),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    /**
     * "seed" until an HR/admin user saves an edit through the templates UI,
     * then "custom" forever — even if a later revert restores byte-identical
     * text. The question this answers is "has a human touched this", not
     * "does it currently match the shipped default"; a revert is itself a
     * human decision worth flagging, not a reason to pretend nothing happened.
     * No DB enum, matching `category` above: the small, closed set of values
     * is owned by application code, not a migration.
     */
    origin: text("origin").notNull().default("seed"),
    /** Who last saved an edit, and when (updatedAt, above). Denormalized onto
     * the live row — same pattern as updatedAt itself — so the template list
     * can show "last changed by X on Y" without a join or a subquery per row.
     * The full history lives in documentTemplateVersions; this is just the
     * fast path for the common case of rendering a list. */
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedByEmail: text("updated_by_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("document_templates_org_category_idx").on(t.orgId, t.category)]
);

/**
 * One row per saved version of a document template, oldest to newest.
 *
 * Offer letters and relieving letters are contracts. If their wording can
 * change with nobody able to say who changed it, what it said before, or how
 * to put it back, that is a legal liability, not a UX gap — so this table
 * exists independently of `document_templates` rather than as a "previous
 * body" column on it, because a single column can hold one past version, and
 * "what did version 3 say" needs all of them.
 *
 * Snapshot-after-save: every save (an edit, or a revert) inserts a new row
 * holding the state that save produced, and `document_templates.version` is
 * kept equal to the newest row here. A revert is therefore just "a save
 * whose content happens to come from an old snapshot" — there is no separate
 * "reverted" data shape to keep in sync with the live schema over time.
 *
 * This table starts empty for every template that already exists: nothing
 * backfills version 1 for the whole install. The first edit made through the
 * new UI writes both the as-seeded version 1 (so nothing is lost) and the
 * edited version 2 in the same transaction. A template nobody has ever
 * touched has zero rows here — itself a cheap, corroborating check that a
 * template is still the shipped original, alongside the explicit `origin`
 * flag on the live row.
 */
export const documentTemplateVersions = hrms.table(
  "document_template_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => documentTemplates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** Full snapshot of the editable fields at this version, not a diff — a
     * diff is only useful if every prior diff is intact and applies cleanly;
     * a snapshot can be reverted to on its own, years later, with nothing
     * else in the chain still needing to exist. */
    name: text("name").notNull(),
    category: text("category").notNull(),
    body: text("body").notNull(),
    requiredTokens: jsonb("required_tokens").notNull().default(sql`'[]'::jsonb`),
    requiresSignature: boolean("requires_signature").notNull().default(false),
    signatoryRoles: jsonb("signatory_roles").notNull().default(sql`'[]'::jsonb`),
    /** Optional free-text reason, e.g. "Fixed missing probation clause for
     * interns" — not required, because forcing one on every save is exactly
     * the kind of friction that gets typed as "." and stops meaning anything. */
    changeNote: text("change_note"),
    changedById: uuid("changed_by_id").references(() => users.id, { onDelete: "set null" }),
    changedByEmail: text("changed_by_email"),
    /** No updatedAt: a version row is a snapshot, and a snapshot that can be
     * modified after the fact is not a snapshot. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The invariant the whole revert feature depends on: version numbers for
    // one template never repeat, so "restore version 3" is never ambiguous.
    uniqueIndex("document_template_versions_template_version_key").on(
      t.templateId,
      t.version
    ),
    index("document_template_versions_org_idx").on(t.orgId, t.templateId),
  ]
);

export const signatureStatusEnum = hrms.enum("signature_status", [
  "draft",
  "sent",
  "viewed",
  "partially_signed",
  "completed",
  "declined",
  "expired",
  "voided",
]);

export const generatedDocuments = hrms.table(
  "generated_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").references(() => documentTemplates.id, {
      onDelete: "set null",
    }),
    /** Template version used, so a reissued document is reproducible. */
    templateVersion: integer("template_version"),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").references(() => candidates.id, {
      onDelete: "cascade",
    }),

    title: text("title").notNull(),
    category: text("category").notNull(),
    /** Rendered body, frozen at generation. */
    renderedBody: text("rendered_body"),
    blobUrl: text("blob_url"),
    /** SHA-256 of the rendered bytes, so tampering after signing is detectable. */
    contentHash: text("content_hash"),

    status: signatureStatusEnum("status").notNull().default("draft"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    voidedReason: text("voided_reason"),

    generatedById: uuid("generated_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("generated_documents_employee_idx").on(t.employeeId),
    index("generated_documents_org_status_idx").on(t.orgId, t.status),
  ]
);

/**
 * One row per required signature.
 *
 * The evidence trail matters more than the mark itself: a signature is only
 * defensible if you can show who signed, when, from where, and that the
 * document has not changed since.
 */
export const documentSignatures = hrms.table(
  "document_signatures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => generatedDocuments.id, { onDelete: "cascade" }),

    signatoryUserId: uuid("signatory_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    signatoryEmail: text("signatory_email").notNull(),
    signatoryName: text("signatory_name"),
    signatoryRole: text("signatory_role").notNull(),
    /** Signing order; a countersignature must not precede the first party. */
    sequence: integer("sequence").notNull().default(1),

    /** Single-use token in the emailed signing link. */
    accessTokenHash: text("access_token_hash"),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    declineReason: text("decline_reason"),

    /** Drawn or typed signature image. */
    signatureImageUrl: text("signature_image_url"),
    /** Hash of the document at the moment of signing. */
    signedContentHash: text("signed_content_hash"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("document_signatures_doc_sequence_key").on(t.documentId, t.sequence),
    index("document_signatures_email_idx").on(t.signatoryEmail),
  ]
);

/**
 * Durable intent to render a completed envelope to PDF and put it in R2.
 *
 * Same shape and the same idea as `paystub_employee_sync_outbox` and
 * `directory_group_join_outbox`: the signature itself is recorded and
 * final the moment `documentSignatures.signedAt` is set, but turning that
 * into a stored, downloadable PDF is a second step that talks to an object
 * store, and an object store can be unreachable for reasons that have
 * nothing to do with whether the signature is valid. A person who signed
 * must never be told, or have it silently become true, that the document
 * was archived when it was not — so that step gets exactly the retry
 * discipline the other two integrations already have, rather than a
 * best-effort call made once from inside the signing request.
 *
 * `blob_url` on `generated_documents` is the single source of truth for
 * where the artifact lives; this table only tracks whether it has been put
 * there yet, so the object key is never duplicated across two places that
 * could disagree.
 */
export const documentPdfStorageOutbox = hrms.table(
  "document_pdf_storage_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => generatedDocuments.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One outbox row per document: re-queuing a completed envelope (a retry,
    // or a second signatory finishing the envelope) reopens the same row
    // rather than racing two uploads of the same content.
    uniqueIndex("document_pdf_storage_outbox_document_key").on(t.orgId, t.documentId),
    index("document_pdf_storage_outbox_retry_idx").on(t.status, t.nextAttemptAt),
  ]
);

// ─── Inferred types ──────────────────────────────────────────

export type Referral = typeof referrals.$inferSelect;
export type NewReferral = typeof referrals.$inferInsert;
export type ReferralPolicy = typeof referralPolicies.$inferSelect;
export type BenefitPlan = typeof benefitPlans.$inferSelect;
export type BenefitEnrolment = typeof benefitEnrolments.$inferSelect;
export type Dependant = typeof dependants.$inferSelect;
export type BenefitClaim = typeof benefitClaims.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type CourseModule = typeof courseModules.$inferSelect;
export type CourseEnrolment = typeof courseEnrolments.$inferSelect;
export type Certification = typeof certifications.$inferSelect;
export type DocumentTemplate = typeof documentTemplates.$inferSelect;
export type GeneratedDocument = typeof generatedDocuments.$inferSelect;
export type DocumentSignature = typeof documentSignatures.$inferSelect;
export type DocumentPdfStorageOutboxRow = typeof documentPdfStorageOutbox.$inferSelect;

// ─── Referral invites ────────────────────────────────────────

/**
 * The link a referred candidate receives by email.
 *
 * This is the only table in the schema that grants an *unauthenticated* write
 * into a tenant's data, so it is deliberately narrow: the token is the whole
 * authority, and everything about the row exists to bound what that authority
 * can do.
 *
 * The token itself is never here. Only its SHA-256, exactly like a refresh
 * token — whoever reads this table, or a backup of it, gets nothing they can
 * use, and a leaked dump is not a set of live links.
 */
export const referralInvites = hrms.table(
  "referral_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    referralId: uuid("referral_id")
      .notNull()
      .references(() => referrals.id, { onDelete: "cascade" }),

    /** SHA-256 hex of the emailed token. Never the token. */
    tokenHash: text("token_hash").notNull(),

    /** Where it was sent, recorded so a mistyped address is traceable. */
    sentToEmail: text("sent_to_email").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Delivery failures are kept: a bounce explains a referral that stalled. */
    deliveryError: text("delivery_error"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set on the one successful submission. Afterwards the link is spent. */
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Withdrawn by the company. Beats every other state. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),

    /**
     * What the candidate typed, as sent.
     *
     * Kept verbatim alongside the fields copied onto the referral and the ATS
     * candidate, because this is the only record of what the person themselves
     * asserted — everything downstream can be edited by a recruiter.
     */
    submission: jsonb("submission"),
    /**
     * Their explicit agreement to us holding their details.
     *
     * Not a boolean on the submission blob: this is the lawful basis for
     * processing an outsider's personal data, so it is a first-class column
     * that can be queried, exported and pointed at.
     */
    consentGivenAt: timestamp("consent_given_at", { withTimezone: true }),
    /** For a subject access or erasure request, and for proving provenance. */
    submittedFromIp: text("submitted_from_ip"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The lookup path for every public request. Unique because a hash
    // collision would mean two candidates sharing one link.
    uniqueIndex("referral_invites_token_key").on(t.tokenHash),
    // Finding the live invite for a referral, to resend or revoke it.
    index("referral_invites_referral_idx").on(t.referralId),
    index("referral_invites_org_expiry_idx").on(t.orgId, t.expiresAt),
  ]
);
