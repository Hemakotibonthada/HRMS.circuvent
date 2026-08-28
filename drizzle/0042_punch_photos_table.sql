-- ═══════════════════════════════════════════════════════════════
-- Punch photographs move to their own table
-- ═══════════════════════════════════════════════════════════════
--
-- 0038 added clock_in_photo_at, clock_out_photo_url and clock_out_photo_at to
-- attendance_records. They are removed here in favour of a separate table, for
-- two reasons.
--
-- The modelling one: a photograph has a different lifetime from the punch it
-- belongs to. Retention deletes the image after an organisation's stated
-- period while the attendance record must survive for payroll and audit — so
-- the image is a related artifact with its own lifecycle, not an attribute of
-- the punch. Keeping it inline meant every retention sweep wrote to
-- attendance_records, the table the whole payroll run reads.
--
-- The practical one: attendance_records is wide, and adding three more columns
-- pushed the inferred schema type past what TypeScript will instantiate
-- consistently. The build started reporting an `employees` row as not
-- assignable to itself — "two different types with this name exist, but they
-- are unrelated" — from code nobody had touched. A narrow side table costs one
-- join on a screen almost nobody opens and keeps the main table's type stable.
--
-- clock_in_photo_url is left alone. It predates all of this, is unused, and
-- renaming or dropping a column other code already selects buys nothing.

CREATE TABLE IF NOT EXISTS "hrms"."attendance_punch_photos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "attendance_record_id" uuid NOT NULL REFERENCES "hrms"."attendance_records"("id") ON DELETE CASCADE,
  "direction" text NOT NULL,
  "object_key" text NOT NULL,
  "taken_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "hrms"."attendance_punch_photos"
  DROP CONSTRAINT IF EXISTS "attendance_punch_photo_direction_known";
--> statement-breakpoint
ALTER TABLE "hrms"."attendance_punch_photos"
  ADD CONSTRAINT "attendance_punch_photo_direction_known"
  CHECK ("direction" IN ('in', 'out'));
--> statement-breakpoint

-- One photograph per punch per direction. A retry that stored a second image
-- would otherwise leave the first orphaned in the bucket with a row still
-- pointing at neither.
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_punch_photo_unique_idx"
  ON "hrms"."attendance_punch_photos" ("attendance_record_id", "direction");
--> statement-breakpoint

-- Drives the retention sweep: find this organisation's oldest images first.
CREATE INDEX IF NOT EXISTS "attendance_punch_photo_expiry_idx"
  ON "hrms"."attendance_punch_photos" ("org_id", "taken_at");
--> statement-breakpoint

ALTER TABLE "hrms"."attendance_punch_photos" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hrms"."attendance_punch_photos" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "hrms"."attendance_punch_photos";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hrms"."attendance_punch_photos"
  USING (app_is_superuser() OR "org_id" = app_current_org())
  WITH CHECK (app_is_superuser() OR "org_id" = app_current_org());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE
  ON "hrms"."attendance_punch_photos" TO hrms_app;
--> statement-breakpoint

DROP INDEX IF EXISTS "hrms"."attendance_photo_expiry_idx";
--> statement-breakpoint
ALTER TABLE "hrms"."attendance_records" DROP COLUMN IF EXISTS "clock_in_photo_at";
--> statement-breakpoint
ALTER TABLE "hrms"."attendance_records" DROP COLUMN IF EXISTS "clock_out_photo_url";
--> statement-breakpoint
ALTER TABLE "hrms"."attendance_records" DROP COLUMN IF EXISTS "clock_out_photo_at";
