-- ═══════════════════════════════════════════════════════════════
-- Attendance regularisation
-- ═══════════════════════════════════════════════════════════════
--
-- A correction to a day's attendance, raised by the employee and decided by
-- somebody else. Held apart from the attendance record it corrects, so that
-- who asked and who agreed survives the correction.

CREATE TABLE IF NOT EXISTS "hrms"."attendance_regularisations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "hrms"."employees"("id") ON DELETE CASCADE,
  "attendance_date" date NOT NULL,
  "reason" text NOT NULL,
  "note" text,
  "in_time" time,
  "out_time" time,
  "has_proof" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "routing" text DEFAULT 'normal' NOT NULL,
  "decided_by_id" uuid REFERENCES "hrms"."employees"("id") ON DELETE SET NULL,
  "decided_at" timestamp with time zone,
  "decision_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "attendance_regularisations_employee_idx"
  ON "hrms"."attendance_regularisations" ("employee_id", "attendance_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attendance_regularisations_org_status_idx"
  ON "hrms"."attendance_regularisations" ("org_id", "status");
--> statement-breakpoint

-- One *open* request per day. A partial index rather than a plain unique one,
-- because a day may be corrected again after a rejection — but two live
-- requests for the same day is somebody double-tapping Submit, and approving
-- both would apply the correction twice.
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_regularisations_one_open_per_day"
  ON "hrms"."attendance_regularisations" ("employee_id", "attendance_date")
  WHERE "status" = 'pending';
--> statement-breakpoint

ALTER TABLE "hrms"."attendance_regularisations"
  DROP CONSTRAINT IF EXISTS "attendance_regularisations_status_known";
--> statement-breakpoint
ALTER TABLE "hrms"."attendance_regularisations"
  ADD CONSTRAINT "attendance_regularisations_status_known"
  CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled'));
--> statement-breakpoint

-- A rejection without a reason is the thing an employee cannot argue with.
ALTER TABLE "hrms"."attendance_regularisations"
  DROP CONSTRAINT IF EXISTS "attendance_regularisations_rejection_has_reason";
--> statement-breakpoint
ALTER TABLE "hrms"."attendance_regularisations"
  ADD CONSTRAINT "attendance_regularisations_rejection_has_reason"
  CHECK ("status" <> 'rejected' OR ("decision_reason" IS NOT NULL AND length(trim("decision_reason")) > 0));
--> statement-breakpoint

-- Self-approval is the hole in every request workflow, and attendance is the
-- one that converts directly into money. Enforced here as well as in the route,
-- because a future import or an admin console is also a writer.
ALTER TABLE "hrms"."attendance_regularisations"
  DROP CONSTRAINT IF EXISTS "attendance_regularisations_no_self_approval";
--> statement-breakpoint
ALTER TABLE "hrms"."attendance_regularisations"
  ADD CONSTRAINT "attendance_regularisations_no_self_approval"
  CHECK ("decided_by_id" IS NULL OR "decided_by_id" <> "employee_id");
--> statement-breakpoint

ALTER TABLE "hrms"."attendance_regularisations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hrms"."attendance_regularisations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "hrms"."attendance_regularisations";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hrms"."attendance_regularisations"
  USING (app_is_superuser() OR "org_id" = app_current_org())
  WITH CHECK (app_is_superuser() OR "org_id" = app_current_org());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE
  ON "hrms"."attendance_regularisations" TO hrms_app;
