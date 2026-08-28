-- ═══════════════════════════════════════════════════════════════
-- Selfie on punch: the switch, and the promise about deletion
-- ═══════════════════════════════════════════════════════════════
--
-- A photograph of an employee's face on every clock-in is not a feature that
-- should be on by default anywhere. It is off unless an organisation turns it
-- on, and a row here is what "on" means — no row is the same as off, so an
-- organisation that has never heard of this is not opted into it by a
-- migration.
--
-- Retention lives in the same row as the switch and is NOT NULL, so it is
-- impossible to enable capture without having answered "for how long". A face
-- photograph per punch is roughly 250 images per employee per year; deciding
-- the deletion rule afterwards means deciding it about images already held.
--
-- The ceiling is a year. Beyond that the images stop being evidence about a
-- disputed shift, which is the only argument for keeping them, and become a
-- face database.
--
-- `updated_by_user_id` records who turned it on. This is a decision about
-- other people's faces; it should not be possible to find it switched on with
-- nobody's name against it.
--
-- Comments stay outside the parenthesised body: the migration runner splits on
-- lines and treats a comment inside the column list as a statement boundary,
-- which cuts the CREATE TABLE in half.

CREATE TABLE IF NOT EXISTS "hrms"."attendance_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL UNIQUE REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "require_selfie_on_punch" boolean DEFAULT false NOT NULL,
  "selfie_retention_days" integer DEFAULT 90 NOT NULL,
  "updated_by_user_id" uuid REFERENCES "identity"."users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "hrms"."attendance_policies"
  DROP CONSTRAINT IF EXISTS "attendance_selfie_retention_bounded";
--> statement-breakpoint
ALTER TABLE "hrms"."attendance_policies"
  ADD CONSTRAINT "attendance_selfie_retention_bounded"
  CHECK ("selfie_retention_days" BETWEEN 1 AND 365);
--> statement-breakpoint

ALTER TABLE "hrms"."attendance_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hrms"."attendance_policies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "hrms"."attendance_policies";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hrms"."attendance_policies"
  USING (app_is_superuser() OR "org_id" = app_current_org())
  WITH CHECK (app_is_superuser() OR "org_id" = app_current_org());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE
  ON "hrms"."attendance_policies" TO hrms_app;
--> statement-breakpoint

-- `clock_in_photo_url` already exists and has never been written to. It is
-- reused rather than replaced: it holds an object-store key, not a URL, and
-- renaming a column other code already selects buys nothing.
--
-- When the image was taken is recorded separately from the punch. They are
-- normally seconds apart; on a queued offline punch they are not, and that
-- difference is exactly what somebody reviewing a disputed punch needs.
ALTER TABLE "hrms"."attendance_records"
  ADD COLUMN IF NOT EXISTS "clock_in_photo_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "hrms"."attendance_records"
  ADD COLUMN IF NOT EXISTS "clock_out_photo_url" text;
--> statement-breakpoint
ALTER TABLE "hrms"."attendance_records"
  ADD COLUMN IF NOT EXISTS "clock_out_photo_at" timestamp with time zone;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "attendance_photo_expiry_idx"
  ON "hrms"."attendance_records" ("org_id", "clock_in_photo_at")
  WHERE "clock_in_photo_url" IS NOT NULL;
