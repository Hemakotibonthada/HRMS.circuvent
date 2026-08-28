import { boolean, index, integer, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { hrms, attendanceRecords } from "./hrms";
import { organizations, users } from "./identity";

// ═══════════════════════════════════════════════════════════════
// Attendance policy, and punch photographs
// ═══════════════════════════════════════════════════════════════
//
// Companion tables to `attendanceRecords`, which lives in hrms.ts.
//
// They are here rather than there for a concrete reason. hrms.ts sits at
// TypeScript's ceiling for instantiating the generic drizzle builds from a
// table definition, and adding anything to it — three columns, or one small
// table — tipped it over: the build began reporting an `employees` row as not
// assignable to itself, "two different types with this name exist, but they
// are unrelated", from files nobody had touched. Splitting keeps the main
// schema's inferred types stable, and follows what performance.ts already does
// for the same reason.

/**
 * Per-organisation attendance policy.
 *
 * A row here is what "selfie punch is on" means. No row is the same as off, so
 * an organisation that has never heard of the feature is not opted into
 * photographing its staff by a migration running.
 *
 * Retention sits beside the switch and is not nullable, so it is impossible to
 * turn capture on without having answered how long the images are kept — a
 * decision that is much harder to take honestly once the images exist.
 */
export const attendancePolicies = hrms.table("attendance_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: "cascade" }),
  requireSelfieOnPunch: boolean("require_selfie_on_punch").notNull().default(false),
  /** Bounded to 1..365 by a CHECK constraint. */
  selfieRetentionDays: integer("selfie_retention_days").notNull().default(90),
  /** Who last changed it. A decision about other people's faces needs a name. */
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AttendancePolicy = typeof attendancePolicies.$inferSelect;

/**
 * A photograph taken at the moment of a punch.
 *
 * Its own table, not columns on `attendanceRecords`, because it has its own
 * lifetime: retention deletes the image after the organisation's stated period
 * while the attendance record survives for payroll and audit. Inline columns
 * would also mean every retention sweep wrote to the table the whole payroll
 * run reads.
 *
 * [takenAt] is when the shutter fired, not when the punch reached the server. A
 * queued offline punch can arrive days later, and retention counted from
 * arrival would keep the image longer than was promised.
 */
export const attendancePunchPhotos = hrms.table(
  "attendance_punch_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    attendanceRecordId: uuid("attendance_record_id")
      .notNull()
      .references(() => attendanceRecords.id, { onDelete: "cascade" }),
    /** "in" or "out", bounded by a CHECK constraint. */
    direction: text("direction").notNull(),
    /** Object-store key, not a URL. */
    objectKey: text("object_key").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One photograph per punch per direction. A retry storing a second image
    // would otherwise leave the first orphaned in the bucket.
    uniqueIndex("attendance_punch_photo_unique_idx").on(t.attendanceRecordId, t.direction),
    index("attendance_punch_photo_expiry_idx").on(t.orgId, t.takenAt),
  ]
);

export type AttendancePunchPhoto = typeof attendancePunchPhotos.$inferSelect;
