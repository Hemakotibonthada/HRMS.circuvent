// ═══════════════════════════════════════════════════════════════
// HRMS SCHEMA — core HR domain on Neon Postgres
// ═══════════════════════════════════════════════════════════════
// Transcribed from the existing TypeScript domain model in src/types/
// (models.ts, hrms.ts, index.ts). Two things change versus Firestore:
//
//  1. Denormalised display copies (employeeName, departmentName,
//     reportingToName, …) are dropped. Firestore has no joins so those fields
//     existed to avoid N+1 reads; in Postgres they are a consistency hazard
//     and a join is cheaper.
//  2. Every tenant-scoped table carries org_id and is protected by row-level
//     security, so a forgotten WHERE clause cannot leak another tenant.
//     Firestore only filtered in the query (src/lib/tenant.ts).
//
// Money is stored in minor units (paise) as bigint. Floating point must never
// be used for payroll.

import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, users } from "./identity";

export const hrms = pgSchema("hrms");

// ─── Enums ───────────────────────────────────────────────────

export const employmentTypeEnum = hrms.enum("employment_type", [
  "full_time",
  "part_time",
  "contract",
  "intern",
  "freelance",
]);

export const employeeStatusEnum = hrms.enum("employee_status", [
  "active",
  "on_leave",
  "probation",
  "notice_period",
  "terminated",
  "inactive",
]);

export const genderEnum = hrms.enum("gender", [
  "male",
  "female",
  "other",
  "prefer_not_to_say",
]);

export const approvalStatusEnum = hrms.enum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const attendanceStatusEnum = hrms.enum("attendance_status", [
  "present",
  "absent",
  "late",
  "half_day",
  "on_leave",
  "holiday",
  "weekend",
  "wfh",
]);

export const clockMethodEnum = hrms.enum("clock_method", [
  "biometric",
  "web",
  "mobile",
  "manual",
  "geo_fence",
]);

export const leaveTypeEnum = hrms.enum("leave_type", [
  "casual",
  "sick",
  "earned",
  "maternity",
  "paternity",
  "compensatory",
  "unpaid",
  "bereavement",
  "wfh",
  "marriage",
  "study",
]);

export const payrollStatusEnum = hrms.enum("payroll_status", [
  "draft",
  "processing",
  "processed",
  "approved",
  "paid",
  "on_hold",
  "error",
]);

export const priorityEnum = hrms.enum("priority", [
  "low",
  "medium",
  "high",
  "critical",
  "urgent",
]);

// ─── Locations ───────────────────────────────────────────────

export const locations = hrms.table(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    addressLine1: text("address_line1"),
    city: text("city"),
    state: text("state"),
    country: text("country").notNull().default("India"),
    postalCode: text("postal_code"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    /** Geofence centre for mobile punch-in, decimal degrees. */
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    geofenceRadiusMeters: integer("geofence_radius_meters").default(200),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("locations_org_code_key").on(t.orgId, t.code)]
);

// ─── Departments ─────────────────────────────────────────────

export const departments = hrms.table(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    description: text("description"),
    headId: uuid("head_id"),
    parentId: uuid("parent_id"),
    budgetMinor: bigint("budget_minor", { mode: "bigint" }),
    costCenter: text("cost_center"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("departments_org_code_key").on(t.orgId, t.code),
    index("departments_org_idx").on(t.orgId),
  ]
);

// ─── Employees ───────────────────────────────────────────────

export const employees = hrms.table(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Link to the shared identity row. Null for employees without a login. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Human-readable code, e.g. CIR-0042. Unique per organization. */
    employeeCode: text("employee_code").notNull(),

    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    workEmail: text("work_email").notNull(),
    personalEmail: text("personal_email"),
    phone: text("phone"),
    avatarUrl: text("avatar_url"),
    gender: genderEnum("gender"),
    dateOfBirth: date("date_of_birth"),
    bloodGroup: text("blood_group"),
    maritalStatus: text("marital_status"),

    addressLine1: text("address_line1"),
    city: text("city"),
    state: text("state"),
    country: text("country").default("India"),
    postalCode: text("postal_code"),

    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    designation: text("designation").notNull(),
    /** Self-reference resolved via a deferred FK in the migration. */
    reportingToId: uuid("reporting_to_id"),
    employmentType: employmentTypeEnum("employment_type").notNull().default("full_time"),
    status: employeeStatusEnum("status").notNull().default("active"),

    joinDate: date("join_date").notNull(),
    confirmationDate: date("confirmation_date"),
    exitDate: date("exit_date"),
    exitReason: text("exit_reason"),
    noticePeriodDays: integer("notice_period_days").default(60),

    /**
     * Expected last day of an internship. `joinDate` already doubles as the
     * internship start for every employment type, so this is the only date
     * an intern record needs that a permanent one does not — it is what the
     * last-working-day reminder sweep and the interns list count down to.
     */
    internshipEndDate: date("internship_end_date"),

    /**
     * The CVI- code this row was hired under, kept after conversion to
     * permanent so payslips, signed letters and attendance already issued
     * under it stay verifiable. Null for anyone who has never converted.
     */
    previousEmployeeCode: text("previous_employee_code"),
    /** When `employeeCode` last changed because of a conversion. */
    codeChangedAt: timestamp("code_changed_at", { withTimezone: true }),

    /**
     * Contracted hours per week.
     *
     * Needed by rostering to allocate fairly — without it a part-time employee
     * and a full-time one look identical to the scheduler, and the part-timer
     * gets rostered into a full week.
     */
    contractedHoursPerWeek: numeric("contracted_hours_per_week", { precision: 5, scale: 2 })
      .notNull()
      .default("40.00"),

    /** Annual cost to company in minor units. */
    ctcMinor: bigint("ctc_minor", { mode: "bigint" }),
    currency: text("currency").notNull().default("INR"),

    /**
     * Written by `NeonEmployeeRepository.updateBankDetails` (see
     * `db/repositories/employee.neon.ts`) from the employee self-service form
     * at `/bankdetails`. Still not encrypted, despite holding an account
     * number and IFSC: `jsonb` cannot hold a ciphertext string without a type
     * change, so that needs a migration rather than the backfill the `text`
     * columns below use. The account number is masked to its last 4 digits on
     * every read that reaches a browser (`toBankDetailsView` in
     * `lib/bank-details-rules.ts`); the column itself remains full-precision
     * plaintext in Postgres. Tracked in docs/ROADMAP.md.
     */
    bankDetails: jsonb("bank_details").$type<{
      bankName: string;
      accountHolderName: string;
      accountNumber: string;
      ifsc: string;
      accountType: "savings" | "current";
    }>(),
    emergencyContact: jsonb("emergency_contact"),
    skills: jsonb("skills").notNull().default(sql`'[]'::jsonb`),
    qualifications: jsonb("qualifications").notNull().default(sql`'[]'::jsonb`),

    /**
     * Indian statutory identifiers.
     *
     * PAN is a national identifier and, as of `updateBankDetails`, is the one
     * of these five actually encrypted at rest by `lib/crypto/field-encryption`
     * — every earlier row and every other write path left it in the clear, so
     * `decryptNullable` tolerates a plaintext PAN read back unchanged (see the
     * field-encryption module for why that fallback exists at all). Aadhaar
     * has no capture path anywhere in the product yet, encrypted or otherwise,
     * despite once being claimed encrypted by this same comment. UAN, PF and
     * ESI are scheme membership numbers, are quoted on statutory filings, and
     * are left in the clear.
     */
    panNumber: text("pan_number"),
    aadhaarNumber: text("aadhaar_number"),
    uanNumber: text("uan_number"),
    pfNumber: text("pf_number"),
    esiNumber: text("esi_number"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("employees_org_code_key").on(t.orgId, t.employeeCode),
    uniqueIndex("employees_org_work_email_key").on(t.orgId, t.workEmail),
    uniqueIndex("employees_user_id_key").on(t.userId),
    index("employees_org_status_idx").on(t.orgId, t.status),
    index("employees_org_department_idx").on(t.orgId, t.departmentId),
    index("employees_reporting_to_idx").on(t.reportingToId),
    index("employees_internship_end_date_idx").on(t.orgId, t.internshipEndDate),
  ]
);

export const paystubEmployeeSyncOutbox = hrms.table(
  "paystub_employee_sync_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    lastCreated: boolean("last_created"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("paystub_employee_sync_outbox_employee_key").on(t.orgId, t.employeeId),
    index("paystub_employee_sync_outbox_retry_idx").on(t.status, t.nextAttemptAt),
  ]
);

/**
 * Records that a last-working-day reminder milestone (e.g. 14 days out) has
 * already been sent for an intern. The daily cron is the only invocation
 * this path gets — Vercel's Hobby plan allows one run per path per day — so
 * a row is claimed here with `ON CONFLICT (employeeId, leadDays) DO NOTHING`
 * before any mail goes out. Without it, a cron that fires twice in a day, or
 * is retried after a partial failure, would mail HR, the manager and the
 * intern again for the same milestone.
 */
export const internReminderLog = hrms.table(
  "intern_reminder_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** Days before `internshipEndDate` this milestone fires at — 14, 3, ... */
    leadDays: integer("lead_days").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("intern_reminder_log_key").on(t.employeeId, t.leadDays)]
);

export const directoryGroupJoinOutbox = hrms.table(
  "directory_group_join_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** The group's address at the identity provider — "all@circuvent.com". */
    groupAddress: text("group_address").notNull(),
    /** The address being added, as it was at the time the intent was recorded. */
    memberEmail: text("member_email").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("directory_group_join_outbox_member_key").on(t.orgId, t.employeeId, t.groupAddress),
    index("directory_group_join_outbox_retry_idx").on(t.status, t.nextAttemptAt),
  ]
);

/**
 * A resignation is not the same fact as `employees.exitDate`: it is the
 * record of how that date was arrived at — who asked to leave, when, why,
 * and who on the other side agreed to it. `employees.exitDate` stays the
 * one field every other system already reads (Paystub's sync, the
 * offboarding journey's anchor date, the relieving letter gate); this table
 * is where the negotiation that produced it is kept, so "why does this
 * person have that last working day" has an answer beyond "someone edited
 * the employee record."
 */
export const resignationStatusEnum = hrms.enum("resignation_status", [
  "submitted",
  "accepted",
]);

export const resignations = hrms.table(
  "resignations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    status: resignationStatusEnum("status").notNull().default("submitted"),
    reason: text("reason").notNull(),
    /** What the employee asked for. HR may move the agreed date; this copy never changes, so the original request stays visible after an adjustment. */
    intendedLastWorkingDay: date("intended_last_working_day").notNull(),
    /**
     * What was actually agreed — null until acceptance sets it from notice
     * policy, mutable afterwards for the one HR override this path needs.
     * Every downstream step (the journey anchor, the outbox removals, the
     * settlement, the relieving letter gate) reads this column, never
     * `intendedLastWorkingDay`.
     */
    agreedLastWorkingDay: date("agreed_last_working_day"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedById: uuid("accepted_by_id"),
    lastWorkingDayAdjustedAt: timestamp("last_working_day_adjusted_at", { withTimezone: true }),
    lastWorkingDayAdjustedById: uuid("last_working_day_adjusted_by_id"),
    /**
     * Set once — not at the start of a run, but at the end of one that fully
     * succeeded: settlement priced, group removal queued, and every document
     * this leaver is owed actually issued. Whichever trigger in
     * `offboarding-exit.ts` gets there first sets it, HR confirming exit or
     * the cron sweep noticing the last working day has passed; every
     * exit-processing write locks the row and checks this column before
     * doing anything, so a second trigger arriving after a completed run is
     * a no-op rather than a re-send. A run that only partly succeeds
     * deliberately leaves this null — each piece it did finish is recorded on
     * its own column instead (see below), so the parts already done are not
     * redone, but the row stays due for the next sweep until every part is.
     */
    exitProcessedAt: timestamp("exit_processed_at", { withTimezone: true }),
    /**
     * The computed settlement, frozen the first time exit processing runs.
     * Salary structures and leave balances are live rows that keep changing
     * after somebody leaves — a correction to last month's attendance, a
     * policy edit — and a settlement that recomputed from them on every read
     * would quietly change the amount a payslip already promised. Reading
     * this back instead of recalculating is what makes running exit
     * processing twice (a retry, a second cron tick, a manual "process now"
     * click after a partial failure) produce the same number rather than a
     * new one.
     */
    settlementSnapshot: jsonb("settlement_snapshot"),
    /** Set once a document is actually generated — not attempted, generated — so a failed render can be retried without ever producing a second copy. */
    relievingLetterDocumentId: uuid("relieving_letter_document_id"),
    experienceCertificateDocumentId: uuid("experience_certificate_document_id"),
    internshipCompletionDocumentId: uuid("internship_completion_document_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One resignation *in flight* per employee — partial rather than
    // absolute, because an absolute unique constraint on employeeId would
    // mean nobody who ever resigned could be rehired and resign again. Once
    // exit processing has run the row is history, not an open request, so it
    // drops out of the constraint.
    uniqueIndex("resignations_employee_key")
      .on(t.employeeId)
      .where(sql`${t.exitProcessedAt} IS NULL`),
    index("resignations_org_status_idx").on(t.orgId, t.status),
    // The cron sweep's whole query is "agreed dates that have passed and
    // have not been processed yet". Without this index that is a
    // sequential scan over every resignation the org has ever recorded.
    index("resignations_org_unprocessed_idx").on(t.orgId, t.agreedLastWorkingDay),
  ]
);

/**
 * The leave-side mirror of `directoryGroupJoinOutbox`, and the fix for the
 * bug this whole leaver path exists to close: a group *join* only ever
 * needed retrying because of a transient identity-provider failure, and the
 * very next edit to that employee's record — a department change, a
 * probation confirmation — would naturally re-queue it. A group *leave* has
 * no such safety net: nobody edits an ex-employee's record again, so a
 * failed removal used to just sit there, and the account stayed in `all@`
 * and every distribution list it was ever added to, silently, forever.
 * `drainDueGroupLeaves` in `outbox-sweep.ts` retries a failed removal the
 * same way the join side already retries a failed add, so leaving repeats
 * none of joining's own history of that defect.
 */
export const directoryGroupLeaveOutbox = hrms.table(
  "directory_group_leave_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** The group's address at the identity provider — "all@circuvent.com". */
    groupAddress: text("group_address").notNull(),
    /** The address being removed, as it was when the intent was recorded — the mailbox itself may already be suspended by the time this drains. */
    memberEmail: text("member_email").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    leftAt: timestamp("left_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("directory_group_leave_outbox_member_key").on(t.orgId, t.employeeId, t.groupAddress),
    index("directory_group_leave_outbox_retry_idx").on(t.status, t.nextAttemptAt),
  ]
);

export const employeeDocuments = hrms.table(
  "employee_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    documentType: text("document_type").notNull(),
    /** Vercel Blob URL, replacing Firebase Storage. */
    blobUrl: text("blob_url").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    mimeType: text("mime_type"),
    isVerified: boolean("is_verified").notNull().default(false),
    verifiedById: uuid("verified_by_id"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiresOn: date("expires_on"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("employee_documents_employee_idx").on(t.employeeId)]
);

// ─── Shifts & attendance ─────────────────────────────────────

export const shifts = hrms.table(
  "shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    breakMinutes: integer("break_minutes").notNull().default(60),
    graceMinutes: integer("grace_minutes").notNull().default(15),
    halfDayThresholdMinutes: integer("half_day_threshold_minutes").notNull().default(240),
    fullDayThresholdMinutes: integer("full_day_threshold_minutes").notNull().default(480),
    /** ISO weekday numbers (1 = Monday) treated as the weekly off. */
    weeklyOffDays: jsonb("weekly_off_days").notNull().default(sql`'[6,7]'::jsonb`),
    isNightShift: boolean("is_night_shift").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("shifts_org_code_key").on(t.orgId, t.code)]
);

export const attendanceRecords = hrms.table(
  "attendance_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workDate: date("work_date").notNull(),
    clockInAt: timestamp("clock_in_at", { withTimezone: true }),
    clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
    status: attendanceStatusEnum("status").notNull(),
    shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),

    workedMinutes: integer("worked_minutes"),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    breakMinutes: integer("break_minutes").notNull().default(0),
    lateByMinutes: integer("late_by_minutes").notNull().default(0),
    earlyLeaveByMinutes: integer("early_leave_by_minutes").notNull().default(0),

    clockInMethod: clockMethodEnum("clock_in_method"),
    clockOutMethod: clockMethodEnum("clock_out_method"),
    clockInLatitude: numeric("clock_in_latitude", { precision: 10, scale: 7 }),
    clockInLongitude: numeric("clock_in_longitude", { precision: 10, scale: 7 }),
    /**
     * Object-store key for the punch photograph, not a URL.
     *
     * Predates the feature and is unused. Punch photographs live in
     * `attendancePunchPhotos`, which has its own lifecycle: retention deletes
     * the image while this record survives for payroll. Left in place because
     * renaming a column other code already selects buys nothing.
     */
    clockInPhotoUrl: text("clock_in_photo_url"),
    /** False when a mobile punch fell outside the location's geofence. */
    isWithinGeofence: boolean("is_within_geofence"),
    /**
     * How firm `is_within_geofence` is: inside / probably_inside / uncertain.
     * A boolean alone cannot express "the fix was too rough to say", which is
     * the common case indoors, so it used to be recorded as a confident yes.
     */
    geofenceConfidence: text("geofence_confidence"),
    /**
     * Set when the punch was accepted but something about it warrants a look —
     * a mock-provider flag, an implausible fix, an edge-of-fence position.
     * Accepted rather than refused because every signal has an innocent
     * explanation, and refusing on a heuristic docks real pay.
     */
    requiresLocationReview: boolean("requires_location_review").notNull().default(false),
    /** The specific spoofing signals, so a reviewer sees why it was flagged. */
    locationSignals: jsonb("location_signals"),
    ipAddress: text("ip_address"),

    isRegularized: boolean("is_regularized").notNull().default(false),
    regularizationReason: text("regularization_reason"),
    regularizedById: uuid("regularized_by_id"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("attendance_employee_date_key").on(t.employeeId, t.workDate),
    index("attendance_org_date_idx").on(t.orgId, t.workDate),
    index("attendance_org_status_date_idx").on(t.orgId, t.status, t.workDate),
    // Partial: the review queue is a small slice of a large table, and the
    // whole point is to find the few flagged rows quickly.
    index("attendance_location_review_idx")
      .on(t.orgId, t.workDate)
      .where(sql`${t.requiresLocationReview}`),
  ]
);



// ─── Leave ───────────────────────────────────────────────────
export const leavePolicies = hrms.table(
  "leave_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    leaveType: leaveTypeEnum("leave_type").notNull(),
    label: text("label").notNull(),
    annualQuotaDays: numeric("annual_quota_days", { precision: 5, scale: 2 }).notNull(),
    carryForwardLimitDays: numeric("carry_forward_limit_days", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    maxConsecutiveDays: integer("max_consecutive_days"),
    minDaysNotice: integer("min_days_notice").notNull().default(0),
    /** Accrue monthly in proportion to service rather than granting up front. */
    isProRata: boolean("is_pro_rata").notNull().default(true),
    accrualFrequency: text("accrual_frequency").notNull().default("monthly"),
    isEncashable: boolean("is_encashable").notNull().default(false),
    requiresAttachmentAfterDays: integer("requires_attachment_after_days"),
    applicableGenders: jsonb("applicable_genders"),
    isPaid: boolean("is_paid").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("leave_policies_org_type_key").on(t.orgId, t.leaveType)]
);

export const leaveRequests = hrms.table(
  "leave_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveType: leaveTypeEnum("leave_type").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    totalDays: numeric("total_days", { precision: 5, scale: 2 }).notNull(),
    isHalfDay: boolean("is_half_day").notNull().default(false),
    halfDayPeriod: text("half_day_period"),
    reason: text("reason").notNull(),
    status: approvalStatusEnum("status").notNull().default("pending"),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    approvedById: uuid("approved_by_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    cancellationReason: text("cancellation_reason"),
    contactDuringLeave: text("contact_during_leave"),
    handoverToId: uuid("handover_to_id"),
    attachments: jsonb("attachments").notNull().default(sql`'[]'::jsonb`),
    /** Links to the generic workflow engine when a multi-step chain applies. */
    workflowInstanceId: uuid("workflow_instance_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leave_requests_org_status_idx").on(t.orgId, t.status),
    index("leave_requests_employee_idx").on(t.employeeId, t.startDate),
    index("leave_requests_org_dates_idx").on(t.orgId, t.startDate, t.endDate),
  ]
);

export const leaveBalances = hrms.table(
  "leave_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    leaveType: leaveTypeEnum("leave_type").notNull(),
    openingDays: numeric("opening_days", { precision: 6, scale: 2 }).notNull().default("0"),
    accruedDays: numeric("accrued_days", { precision: 6, scale: 2 }).notNull().default("0"),
    usedDays: numeric("used_days", { precision: 6, scale: 2 }).notNull().default("0"),
    pendingDays: numeric("pending_days", { precision: 6, scale: 2 }).notNull().default("0"),
    carryForwardDays: numeric("carry_forward_days", { precision: 6, scale: 2 })
      .notNull()
      .default("0"),
    lapsedDays: numeric("lapsed_days", { precision: 6, scale: 2 }).notNull().default("0"),
    encashedDays: numeric("encashed_days", { precision: 6, scale: 2 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("leave_balances_employee_year_type_key").on(t.employeeId, t.year, t.leaveType),
    index("leave_balances_org_year_idx").on(t.orgId, t.year),
  ]
);

export const holidays = hrms.table(
  "holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    holidayDate: date("holiday_date").notNull(),
    /** Optional holidays let employees choose from a floating pool. */
    isOptional: boolean("is_optional").notNull().default(false),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("holidays_org_year_idx").on(t.orgId, t.year)]
);

// ─── Employee loans and advances ─────────────────────────────

/**
 * Money lent to an employee and recovered from their pay.
 *
 * The interest rate stored here is what the *employer* charges, which is very
 * often zero. That is not the same as the loan being free: the shortfall
 * against SBI's rate is a taxable perquisite, and the benchmark it is measured
 * against lives in `loanBenchmarkRates` because it is a published figure rather
 * than a property of the loan.
 */
export const employeeLoans = hrms.table(
  "employee_loans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** "personal", "housing", "vehicle", "education", "medical", "salary_advance". */
    loanType: text("loan_type").notNull(),
    principalMinor: bigint("principal_minor", { mode: "bigint" }).notNull(),
    /** What the employer charges, as a percentage per annum. Zero is common. */
    interestRatePercent: numeric("interest_rate_percent", { precision: 6, scale: 3 })
      .notNull()
      .default("0"),
    tenureMonths: integer("tenure_months").notNull(),
    firstRecoveryMonth: integer("first_recovery_month").notNull(),
    firstRecoveryYear: integer("first_recovery_year").notNull(),
    purpose: text("purpose"),
    status: text("status").notNull().default("pending"),
    approvedById: uuid("approved_by_id").references(() => employees.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("employee_loans_employee_idx").on(t.employeeId, t.status),
    index("employee_loans_org_status_idx").on(t.orgId, t.status),
  ]
);

/**
 * What payroll actually recovered, month by month.
 *
 * Recorded rather than inferred from the schedule. A month of unpaid leave
 * recovers nothing and a settlement may clear the balance in one go; a system
 * that assumes the instalments were taken reports a loan closed while money is
 * still outstanding.
 */
export const loanRepayments = hrms.table(
  "loan_repayments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => employeeLoans.id, { onDelete: "cascade" }),
    periodMonth: integer("period_month").notNull(),
    periodYear: integer("period_year").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    /** "payroll", "lump_sum", "settlement". */
    source: text("source").notNull().default("payroll"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("loan_repayments_loan_period_key").on(t.loanId, t.periodYear, t.periodMonth),
    index("loan_repayments_org_idx").on(t.orgId),
  ]
);

/**
 * The benchmark rate a concessional loan is measured against.
 *
 * Rule 3(7)(i) is specific: the rate charged by the State Bank of India **as on
 * the first day of the relevant previous year**, for a loan of **the same
 * purpose**. So it is keyed by financial year and loan type, and it is neither
 * a property of the loan nor a single organisation-wide number.
 *
 * There is no default. The rate is published annually and a figure invented
 * here would be wrong within the year and wrong silently, understating somebody's
 * taxable income every month. Where no rate is configured the perquisite is
 * reported as unknown rather than as zero.
 */
export const loanBenchmarkRates = hrms.table(
  "loan_benchmark_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    financialYear: integer("financial_year").notNull(),
    loanType: text("loan_type").notNull(),
    ratePercent: numeric("rate_percent", { precision: 6, scale: 3 }).notNull(),
    /** Where the figure came from, so it can be checked later. */
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("loan_benchmark_rates_org_year_type_key").on(
      t.orgId,
      t.financialYear,
      t.loanType
    ),
  ]
);

// ─── Working away from the office ────────────────────────────

/**
 * A request to work somewhere other than the usual place.
 *
 * Working from home and being on duty elsewhere are the same shape — a day or
 * a range, a reason, and somebody's approval — so they are one table with a
 * `kind`, rather than two tables that drift apart the first time one of them
 * gains a field.
 *
 * They are deliberately **not** leave. An employee working from home is
 * working: their attendance should show a present day, not a deducted balance,
 * and modelling this as a leave type is how people end up losing a day's
 * entitlement for turning up in their own front room.
 */
export const workArrangementRequests = hrms.table(
  "work_arrangement_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** "wfh" or "on_duty". */
    kind: text("kind").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    reason: text("reason"),
    /** Where the employee will be. Required for on-duty, optional for home. */
    location: text("location"),
    status: text("status").notNull().default("pending"),
    decidedById: uuid("decided_by_id").references(() => employees.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("work_arrangement_employee_idx").on(t.employeeId, t.startDate),
    index("work_arrangement_org_status_idx").on(t.orgId, t.status),
  ]
);

// ─── Attendance regularisation ───────────────────────────────

/**
 * A correction to a day's attendance, raised by the employee.
 *
 * Kept apart from `attendanceRecords` rather than editing them in place. The
 * record is what payroll computed from, so the request is the audit trail of
 * who asked for what and who agreed — an edit with no trail is indistinguishable
 * from somebody quietly awarding themselves a day.
 *
 * `routing` says whether the correction can change the month it belongs to or
 * has to travel to the next payroll run as an adjustment. A month that has
 * already been paid cannot be reshaped without the payslip, the register and
 * the record disagreeing.
 */
export const attendanceRegularisations = hrms.table(
  "attendance_regularisations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** The day being corrected. */
    attendanceDate: date("attendance_date").notNull(),
    /** "missed_punch", "on_duty", "system_error" and the rest. */
    reason: text("reason").notNull(),
    note: text("note"),
    /** Corrected times, as HH:MM. Null where the reason does not need them. */
    inTime: time("in_time"),
    outTime: time("out_time"),
    hasProof: boolean("has_proof").notNull().default(false),
    status: text("status").notNull().default("pending"),
    /** "normal" or "adjustment", decided when the request is raised. */
    routing: text("routing").notNull().default("normal"),
    decidedById: uuid("decided_by_id").references(() => employees.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Required when rejecting. Somebody losing a day's pay is owed a reason. */
    decisionReason: text("decision_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attendance_regularisations_employee_idx").on(t.employeeId, t.attendanceDate),
    index("attendance_regularisations_org_status_idx").on(t.orgId, t.status),
  ]
);

// ─── Income tax declarations ─────────────────────────────────

/**
 * What an employee declares they will invest, so TDS is deducted against their
 * likely liability rather than their gross pay.
 *
 * One row per employee per financial year. The regime is stored here rather
 * than on the employee, because it is a per-year choice: somebody may be better
 * off under the old regime this year and the new one next.
 *
 * `proofWindowClosedAt` is the moment unproven claims stop counting. Payroll
 * reads it rather than comparing dates itself, so that extending a deadline is
 * one update and not a rule change in two places.
 */
export const itDeclarations = hrms.table(
  "it_declarations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** Indian financial year, written as the year it begins: 2025 is 2025-26. */
    financialYear: integer("financial_year").notNull(),
    regime: text("regime").notNull().default("new"),
    status: text("status").notNull().default("draft"),
    /** Raises the 80D ceiling; asked once rather than inferred from a birthday. */
    selfOrFamilyIsSenior: boolean("self_or_family_is_senior").notNull().default(false),
    parentsAreSenior: boolean("parents_are_senior").notNull().default(false),
    /** HRA inputs, kept beside the declaration they belong to. */
    rentPaidMinor: bigint("rent_paid_minor", { mode: "bigint" }).notNull().default(0n),
    metroCity: boolean("metro_city").notNull().default(false),
    landlordPan: text("landlord_pan"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    proofWindowClosedAt: timestamp("proof_window_closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("it_declarations_employee_year_key").on(t.employeeId, t.financialYear),
    index("it_declarations_org_year_idx").on(t.orgId, t.financialYear),
  ]
);

/**
 * One claimed section within a declaration.
 *
 * `declaredMinor` is what the employee claimed and never changes on its own;
 * `verifiedMinor` is what evidence supported. Payroll uses the declared figure
 * while the window is open and the verified one after it shuts, which is why
 * both are kept rather than one being overwritten — overwriting loses the
 * record of what was originally claimed, and that is the first thing an audit
 * asks for.
 */
export const itDeclarationItems = hrms.table(
  "it_declaration_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    declarationId: uuid("declaration_id")
      .notNull()
      .references(() => itDeclarations.id, { onDelete: "cascade" }),
    /** "80C", "80CCD(1B)", "24B" — as an employee and an auditor both know it. */
    section: text("section").notNull(),
    declaredMinor: bigint("declared_minor", { mode: "bigint" }).notNull().default(0n),
    verifiedMinor: bigint("verified_minor", { mode: "bigint" }),
    proofStatus: text("proof_status").notNull().default("awaiting"),
    /** Where the uploaded evidence lives, if any. */
    proofDocumentId: uuid("proof_document_id"),
    reviewedById: uuid("reviewed_by_id").references(() => employees.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Why a proof was refused. Required by the route when rejecting. */
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("it_declaration_items_declaration_section_key").on(t.declarationId, t.section),
    index("it_declaration_items_org_idx").on(t.orgId),
  ]
);

// ─── Payroll ─────────────────────────────────────────────────

export const salaryStructures = hrms.table(
  "salary_structures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    ctcMinor: bigint("ctc_minor", { mode: "bigint" }).notNull(),
    basicMinor: bigint("basic_minor", { mode: "bigint" }).notNull(),
    hraMinor: bigint("hra_minor", { mode: "bigint" }).notNull().default(sql`0`),
    conveyanceMinor: bigint("conveyance_minor", { mode: "bigint" }).notNull().default(sql`0`),
    medicalMinor: bigint("medical_minor", { mode: "bigint" }).notNull().default(sql`0`),
    ltaMinor: bigint("lta_minor", { mode: "bigint" }).notNull().default(sql`0`),
    specialAllowanceMinor: bigint("special_allowance_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    otherAllowancesMinor: bigint("other_allowances_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    employerPfMinor: bigint("employer_pf_minor", { mode: "bigint" }).notNull().default(sql`0`),
    employerEsiMinor: bigint("employer_esi_minor", { mode: "bigint" }).notNull().default(sql`0`),
    gratuityMinor: bigint("gratuity_minor", { mode: "bigint" }).notNull().default(sql`0`),
    /** Revision reason: hire, annual merit, promotion, correction. */
    revisionReason: text("revision_reason"),
    approvedById: uuid("approved_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("salary_structures_employee_idx").on(t.employeeId, t.effectiveFrom),
    index("salary_structures_org_idx").on(t.orgId),
  ]
);

/**
 * A payroll run is the unit of approval. Records belong to a run so a month can
 * be recalculated, approved by a second person (maker-checker) and paid as one
 * batch.
 */
export const payrollRuns = hrms.table(
  "payroll_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    periodMonth: integer("period_month").notNull(),
    periodYear: integer("period_year").notNull(),
    /** "regular", "off_cycle", "bonus", "arrears". */
    runType: text("run_type").notNull().default("regular"),
    status: payrollStatusEnum("status").notNull().default("draft"),
    employeeCount: integer("employee_count").notNull().default(0),
    totalGrossMinor: bigint("total_gross_minor", { mode: "bigint" }).notNull().default(sql`0`),
    totalDeductionsMinor: bigint("total_deductions_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    totalNetMinor: bigint("total_net_minor", { mode: "bigint" }).notNull().default(sql`0`),
    processedById: uuid("processed_by_id"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    /** Maker-checker: the approver must differ from the processor. */
    approvedById: uuid("approved_by_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    bankAdviceUrl: text("bank_advice_url"),
    errorLog: jsonb("error_log"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payroll_runs_org_period_type_key").on(
      t.orgId,
      t.periodYear,
      t.periodMonth,
      t.runType
    ),
    index("payroll_runs_org_status_idx").on(t.orgId, t.status),
  ]
);

export const payrollRecords = hrms.table(
  "payroll_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),

    workingDays: numeric("working_days", { precision: 5, scale: 2 }).notNull(),
    presentDays: numeric("present_days", { precision: 5, scale: 2 }).notNull(),
    lopDays: numeric("lop_days", { precision: 5, scale: 2 }).notNull().default("0"),

    // Earnings
    basicMinor: bigint("basic_minor", { mode: "bigint" }).notNull().default(sql`0`),
    hraMinor: bigint("hra_minor", { mode: "bigint" }).notNull().default(sql`0`),
    conveyanceMinor: bigint("conveyance_minor", { mode: "bigint" }).notNull().default(sql`0`),
    medicalMinor: bigint("medical_minor", { mode: "bigint" }).notNull().default(sql`0`),
    ltaMinor: bigint("lta_minor", { mode: "bigint" }).notNull().default(sql`0`),
    specialAllowanceMinor: bigint("special_allowance_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    otherEarningsMinor: bigint("other_earnings_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    overtimeMinor: bigint("overtime_minor", { mode: "bigint" }).notNull().default(sql`0`),
    bonusMinor: bigint("bonus_minor", { mode: "bigint" }).notNull().default(sql`0`),
    arrearsMinor: bigint("arrears_minor", { mode: "bigint" }).notNull().default(sql`0`),
    grossMinor: bigint("gross_minor", { mode: "bigint" }).notNull().default(sql`0`),

    // Deductions
    pfEmployeeMinor: bigint("pf_employee_minor", { mode: "bigint" }).notNull().default(sql`0`),
    esiEmployeeMinor: bigint("esi_employee_minor", { mode: "bigint" }).notNull().default(sql`0`),
    professionalTaxMinor: bigint("professional_tax_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    incomeTaxMinor: bigint("income_tax_minor", { mode: "bigint" }).notNull().default(sql`0`),
    loanRecoveryMinor: bigint("loan_recovery_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    lopDeductionMinor: bigint("lop_deduction_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    otherDeductionsMinor: bigint("other_deductions_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    totalDeductionsMinor: bigint("total_deductions_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),

    netPayMinor: bigint("net_pay_minor", { mode: "bigint" }).notNull().default(sql`0`),

    // Employer contributions, reported but not deducted
    pfEmployerMinor: bigint("pf_employer_minor", { mode: "bigint" }).notNull().default(sql`0`),
    esiEmployerMinor: bigint("esi_employer_minor", { mode: "bigint" }).notNull().default(sql`0`),

    status: payrollStatusEnum("status").notNull().default("draft"),
    paymentMode: text("payment_mode").default("bank_transfer"),
    transactionRef: text("transaction_ref"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    payslipUrl: text("payslip_url"),
    /** Flags raised by the payroll anomaly detector for reviewer attention. */
    anomalies: jsonb("anomalies").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payroll_records_run_employee_key").on(t.runId, t.employeeId),
    index("payroll_records_employee_idx").on(t.employeeId),
    index("payroll_records_org_status_idx").on(t.orgId, t.status),
  ]
);

// ─── Recruitment ─────────────────────────────────────────────

export const jobPostings = hrms.table(
  "job_postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Public slug used by the careers site and the ATS app. */
    slug: text("slug").notNull(),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    employmentType: employmentTypeEnum("employment_type").notNull().default("full_time"),
    experienceMinYears: integer("experience_min_years"),
    experienceMaxYears: integer("experience_max_years"),
    salaryMinMinor: bigint("salary_min_minor", { mode: "bigint" }),
    salaryMaxMinor: bigint("salary_max_minor", { mode: "bigint" }),
    description: text("description"),
    requirements: jsonb("requirements").notNull().default(sql`'[]'::jsonb`),
    skills: jsonb("skills").notNull().default(sql`'[]'::jsonb`),
    openings: integer("openings").notNull().default(1),
    filled: integer("filled").notNull().default(0),
    status: text("status").notNull().default("draft"),
    hiringManagerId: uuid("hiring_manager_id"),
    recruiterId: uuid("recruiter_id"),
    isPublished: boolean("is_published").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    closesOn: date("closes_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_postings_org_slug_key").on(t.orgId, t.slug),
    index("job_postings_org_status_idx").on(t.orgId, t.status),
  ]
);

export const candidates = hrms.table(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    resumeUrl: text("resume_url"),
    /** Structured output of AI resume parsing. */
    parsedResume: jsonb("parsed_resume"),
    currentCompany: text("current_company"),
    currentDesignation: text("current_designation"),
    totalExperienceYears: numeric("total_experience_years", { precision: 4, scale: 1 }),
    expectedCtcMinor: bigint("expected_ctc_minor", { mode: "bigint" }),
    noticePeriodDays: integer("notice_period_days"),
    skills: jsonb("skills").notNull().default(sql`'[]'::jsonb`),
    source: text("source"),
    referredById: uuid("referred_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("candidates_org_email_key").on(t.orgId, t.email),
    index("candidates_org_idx").on(t.orgId),
  ]
);

export const applications = hrms.table(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobPostings.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    stage: text("stage").notNull().default("applied"),
    status: text("status").notNull().default("active"),
    /** 0-100 semantic match between the parsed resume and the job description. */
    matchScore: integer("match_score"),
    rating: integer("rating"),
    rejectionReason: text("rejection_reason"),
    /** Public token used by the candidate-facing status tracker. */
    trackingToken: text("tracking_token"),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("applications_job_candidate_key").on(t.jobId, t.candidateId),
    uniqueIndex("applications_tracking_token_key").on(t.trackingToken),
    index("applications_org_stage_idx").on(t.orgId, t.stage),
  ]
);

export const interviews = hrms.table(
  "interviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    round: integer("round").notNull().default(1),
    interviewType: text("interview_type").notNull().default("technical"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    meetingUrl: text("meeting_url"),
    panelistIds: jsonb("panelist_ids").notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("scheduled"),
    overallRating: integer("overall_rating"),
    recommendation: text("recommendation"),
    feedback: jsonb("feedback"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("interviews_application_idx").on(t.applicationId),
    index("interviews_org_scheduled_idx").on(t.orgId, t.scheduledAt),
  ]
);

// ─── Performance ─────────────────────────────────────────────

export const reviewCycles = hrms.table(
  "review_cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    selfReviewDueOn: date("self_review_due_on"),
    managerReviewDueOn: date("manager_review_due_on"),
    calibrationDueOn: date("calibration_due_on"),
    status: text("status").notNull().default("draft"),
    includesSelfReview: boolean("includes_self_review").notNull().default(true),
    includesPeerReview: boolean("includes_peer_review").notNull().default(false),
    includes360: boolean("includes_360").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("review_cycles_org_status_idx").on(t.orgId, t.status)]
);

export const performanceGoals = hrms.table(  "performance_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    cycleId: uuid("cycle_id").references(() => reviewCycles.id, { onDelete: "set null" }),
    /** Parent objective, enabling OKRs to cascade org → team → individual. */
    parentGoalId: uuid("parent_goal_id"),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category"),
    weightPercent: integer("weight_percent").notNull().default(0),
    targetValue: numeric("target_value", { precision: 14, scale: 2 }),
    currentValue: numeric("current_value", { precision: 14, scale: 2 }),
    unit: text("unit"),
    progressPercent: integer("progress_percent").notNull().default(0),
    status: text("status").notNull().default("not_started"),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("performance_goals_employee_idx").on(t.employeeId),
    index("performance_goals_org_cycle_idx").on(t.orgId, t.cycleId),
  ]
);

export const performanceReviews = hrms.table(
  "performance_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => reviewCycles.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id"),
    reviewType: text("review_type").notNull().default("manager"),
    selfRating: numeric("self_rating", { precision: 3, scale: 1 }),
    managerRating: numeric("manager_rating", { precision: 3, scale: 1 }),
    finalRating: numeric("final_rating", { precision: 3, scale: 1 }),
    /** 9-box placement: 1-3 on each axis, set during calibration. */
    potentialScore: integer("potential_score"),
    performanceScore: integer("performance_score"),
    strengths: text("strengths"),
    improvements: text("improvements"),
    comments: text("comments"),
    /** AI-generated summary of the review inputs, reviewed before publishing. */
    aiSummary: text("ai_summary"),
    status: text("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Peer and 360 responses are hidden from the reviewee when anonymous. */
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("performance_reviews_cycle_employee_idx").on(t.cycleId, t.employeeId),
    index("performance_reviews_org_status_idx").on(t.orgId, t.status),
  ]
);

// ─── Expenses ────────────────────────────────────────────────

export const expenseClaims = hrms.table(
  "expense_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    claimNumber: text("claim_number").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    totalAmountMinor: bigint("total_amount_minor", { mode: "bigint" }).notNull(),
    approvedAmountMinor: bigint("approved_amount_minor", { mode: "bigint" }),
    currency: text("currency").notNull().default("INR"),
    expenseDate: date("expense_date").notNull(),
    description: text("description"),
    lineItems: jsonb("line_items").notNull().default(sql`'[]'::jsonb`),
    receipts: jsonb("receipts").notNull().default(sql`'[]'::jsonb`),
    status: approvalStatusEnum("status").notNull().default("pending"),
    approvedById: uuid("approved_by_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    reimbursedAt: timestamp("reimbursed_at", { withTimezone: true }),
    /** Duplicate/outlier flags from the expense anomaly detector. */
    anomalies: jsonb("anomalies").notNull().default(sql`'[]'::jsonb`),
    workflowInstanceId: uuid("workflow_instance_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("expense_claims_org_number_key").on(t.orgId, t.claimNumber),
    index("expense_claims_employee_idx").on(t.employeeId),
    index("expense_claims_org_status_idx").on(t.orgId, t.status),
  ]
);

// ─── Assets ──────────────────────────────────────────────────

// The asset register — assets, categories, assignment history and maintenance
// — lives in ./assets.ts. The table itself was defined here originally and is
// extended rather than replaced: its columns were sound, so migration 0016
// ALTERs it in place. Only the definition moved, so there is still exactly one.

// ─── Announcements, helpdesk, notifications ──────────────────

export const announcements = hrms.table(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: text("category").default("general"),
    priority: priorityEnum("priority").notNull().default("medium"),
    /** Empty audience means the whole organization. */
    audienceDepartmentIds: jsonb("audience_department_ids").notNull().default(sql`'[]'::jsonb`),
    audienceLocationIds: jsonb("audience_location_ids").notNull().default(sql`'[]'::jsonb`),
    attachments: jsonb("attachments").notNull().default(sql`'[]'::jsonb`),
    isPinned: boolean("is_pinned").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdById: uuid("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("announcements_org_published_idx").on(t.orgId, t.publishedAt)]
);

// The helpdesk tables — tickets, categories, SLA policies, pauses, comments,
// events and the knowledge base — live in ./helpdesk.ts.
//
// A placeholder `tickets` table was sketched here and never read. It is gone
// rather than left alongside the real one, for the same reason the
// custom_fields jsonb columns and the placeholder SSO tables went: a second
// home for one concept is how a row is written to one and read from the other.

export const notifications = hrms.table(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    actionUrl: text("action_url"),
    /** Channels this notification was dispatched on: in_app, email, push, sms. */
    channels: jsonb("channels").notNull().default(sql`'["in_app"]'::jsonb`),
    priority: priorityEnum("priority").notNull().default("medium"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_read_idx").on(t.userId, t.readAt)]
);

// ─── Workflow engine ─────────────────────────────────────────

/**
 * Generic, tenant-configurable approval chains. Leave, expense, travel, loans
 * and offboarding all route through this rather than each hard-coding its own
 * approver logic.
 */
export const workflowDefinitions = hrms.table(
  "workflow_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    entityType: text("entity_type").notNull(),
    /** Ordered steps: approver resolution, conditions, SLA and escalation. */
    steps: jsonb("steps").notNull().default(sql`'[]'::jsonb`),
    /** Conditions deciding whether this definition applies at all. */
    triggerConditions: jsonb("trigger_conditions").notNull().default(sql`'{}'::jsonb`),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workflow_definitions_org_entity_idx").on(t.orgId, t.entityType)]
);

export const workflowInstances = hrms.table(
  "workflow_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: "restrict" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    initiatedById: uuid("initiated_by_id"),
    currentStepIndex: integer("current_step_index").notNull().default(0),
    status: approvalStatusEnum("status").notNull().default("pending"),
    /** One entry per completed step: actor, decision, comment, timestamp. */
    history: jsonb("history").notNull().default(sql`'[]'::jsonb`),
    dueAt: timestamp("due_at", { withTimezone: true }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("workflow_instances_entity_idx").on(t.entityType, t.entityId),
    index("workflow_instances_org_status_idx").on(t.orgId, t.status),
  ]
);

// ─── Inferred types ──────────────────────────────────────────

// ─── Employee lifecycle ──────────────────────────────────────
// Onboarding and offboarding checklists.
//
// The templates in `src/lib/employee-lifecycle.ts` have existed since early
// on, and so has the progress arithmetic. What did not exist was anywhere to
// put the answer: both dashboard pages held tick state in `useState`, so an HR
// admin ticking "Laptop returned" and "Access revoked" watched it all vanish on
// refresh — while offboarding showed a "Clearance updated" toast that promised
// otherwise.
//
// For offboarding that is not merely lost work. Exit clearance is the record
// that proves company property came back and access was cut, which is the
// first thing anyone asks for after an incident involving a leaver.

export const lifecycleKindEnum = hrms.enum("lifecycle_kind", ["onboarding", "offboarding"]);

export const lifecycleJourneys = hrms.table(
  "lifecycle_journeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: lifecycleKindEnum("kind").notNull(),
    /** Joining date for onboarding, last working day for offboarding. */
    anchorDate: date("anchor_date").notNull(),
    status: text("status").notNull().default("in_progress"),
    /** Free text on why someone is leaving; null for onboarding. */
    exitReason: text("exit_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One live journey of each kind per person. Somebody can be onboarded once
    // and offboarded once; a second concurrent checklist means two people
    // ticking different copies of the same list.
    uniqueIndex("lifecycle_journeys_employee_kind_key").on(t.employeeId, t.kind),
    index("lifecycle_journeys_org_status_idx").on(t.orgId, t.status),
    index("lifecycle_journeys_org_created_idx").on(t.orgId, t.createdAt),
  ]
);

export const lifecycleTasks = hrms.table(
  "lifecycle_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    journeyId: uuid("journey_id")
      .notNull()
      .references(() => lifecycleJourneys.id, { onDelete: "cascade" }),
    /** Stable key from the template, e.g. `off_14`. Survives re-wording. */
    taskKey: text("task_key").notNull(),
    title: text("title").notNull(),
    phase: text("phase").notNull(),
    phaseOrder: integer("phase_order").notNull().default(0),
    /** Which function owns it: hr, it, manager, finance, self… */
    assignee: text("assignee").notNull().default("hr"),
    /**
     * A journey cannot be completed while a mandatory task is outstanding.
     * "Access revoked" is mandatory; "Farewell lunch booked" is not.
     */
    mandatory: boolean("mandatory").notNull().default(false),
    /** Days from the anchor date. Negative means before it — pre-boarding. */
    dueOffsetDays: integer("due_offset_days").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedById: uuid("completed_by_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A template task appears once per journey. Without this a retried request
    // silently duplicates the checklist and the progress percentage drops.
    uniqueIndex("lifecycle_tasks_journey_key_key").on(t.journeyId, t.taskKey),
    index("lifecycle_tasks_journey_idx").on(t.journeyId),
    index("lifecycle_tasks_org_completed_idx").on(t.orgId, t.completed),
  ]
);

// ─── Inferred types ──────────────────────────────────────────

/**
 * The employee row.
 *
 * Import this rather than writing `typeof employees.$inferSelect` again at the
 * call site. Each such expression is a fresh instantiation of a very large
 * generic, and this table is close enough to TypeScript's complexity ceiling
 * that two of them stop comparing as the same type — "two different types with
 * this name exist, but they are unrelated", from code that only ever passed a
 * row straight through. Referencing one alias means there is one instantiation
 * to compare against itself.
 */
export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type Department = typeof departments.$inferSelect;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
export type NewAttendanceRecord = typeof attendanceRecords.$inferInsert;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type NewLeaveRequest = typeof leaveRequests.$inferInsert;
export type LeaveBalance = typeof leaveBalances.$inferSelect;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type PayrollRecord = typeof payrollRecords.$inferSelect;
export type SalaryStructure = typeof salaryStructures.$inferSelect;
export type JobPosting = typeof jobPostings.$inferSelect;
export type Candidate = typeof candidates.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type Interview = typeof interviews.$inferSelect;
export type PerformanceGoal = typeof performanceGoals.$inferSelect;
export type PerformanceReview = typeof performanceReviews.$inferSelect;
export type ExpenseClaim = typeof expenseClaims.$inferSelect;
export type WorkflowInstance = typeof workflowInstances.$inferSelect;
export type LifecycleJourney = typeof lifecycleJourneys.$inferSelect;
export type LifecycleTask = typeof lifecycleTasks.$inferSelect;
export type Resignation = typeof resignations.$inferSelect;
export type NewResignation = typeof resignations.$inferInsert;
