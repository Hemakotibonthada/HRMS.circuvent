-- ═══════════════════════════════════════════════════════════════
-- Working from home, and being on duty elsewhere
-- ═══════════════════════════════════════════════════════════════
--
-- One table with a kind, because the two are the same shape. They are not
-- leave: somebody working from home is working, and modelling this as a leave
-- type deducts a day's entitlement for turning up in their own front room.

CREATE TABLE IF NOT EXISTS "hrms"."work_arrangement_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "hrms"."employees"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "reason" text,
  "location" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "decided_by_id" uuid REFERENCES "hrms"."employees"("id") ON DELETE SET NULL,
  "decided_at" timestamp with time zone,
  "decision_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "work_arrangement_employee_idx"
  ON "hrms"."work_arrangement_requests" ("employee_id", "start_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_arrangement_org_status_idx"
  ON "hrms"."work_arrangement_requests" ("org_id", "status");
--> statement-breakpoint

ALTER TABLE "hrms"."work_arrangement_requests"
  DROP CONSTRAINT IF EXISTS "work_arrangement_kind_known";
--> statement-breakpoint
ALTER TABLE "hrms"."work_arrangement_requests"
  ADD CONSTRAINT "work_arrangement_kind_known"
  CHECK ("kind" IN ('wfh', 'on_duty'));
--> statement-breakpoint

ALTER TABLE "hrms"."work_arrangement_requests"
  DROP CONSTRAINT IF EXISTS "work_arrangement_status_known";
--> statement-breakpoint
ALTER TABLE "hrms"."work_arrangement_requests"
  ADD CONSTRAINT "work_arrangement_status_known"
  CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled'));
--> statement-breakpoint

-- A range that ends before it begins is not a range.
ALTER TABLE "hrms"."work_arrangement_requests"
  DROP CONSTRAINT IF EXISTS "work_arrangement_dates_ordered";
--> statement-breakpoint
ALTER TABLE "hrms"."work_arrangement_requests"
  ADD CONSTRAINT "work_arrangement_dates_ordered"
  CHECK ("end_date" >= "start_date");
--> statement-breakpoint

-- An on-duty request must say where. That is the entire difference between it
-- and working from home, and it is what makes the attendance record defensible.
ALTER TABLE "hrms"."work_arrangement_requests"
  DROP CONSTRAINT IF EXISTS "work_arrangement_on_duty_has_location";
--> statement-breakpoint
ALTER TABLE "hrms"."work_arrangement_requests"
  ADD CONSTRAINT "work_arrangement_on_duty_has_location"
  CHECK ("kind" <> 'on_duty' OR ("location" IS NOT NULL AND length(trim("location")) > 0));
--> statement-breakpoint

ALTER TABLE "hrms"."work_arrangement_requests"
  DROP CONSTRAINT IF EXISTS "work_arrangement_rejection_has_reason";
--> statement-breakpoint
ALTER TABLE "hrms"."work_arrangement_requests"
  ADD CONSTRAINT "work_arrangement_rejection_has_reason"
  CHECK ("status" <> 'rejected' OR ("decision_reason" IS NOT NULL AND length(trim("decision_reason")) > 0));
--> statement-breakpoint

ALTER TABLE "hrms"."work_arrangement_requests"
  DROP CONSTRAINT IF EXISTS "work_arrangement_no_self_approval";
--> statement-breakpoint
ALTER TABLE "hrms"."work_arrangement_requests"
  ADD CONSTRAINT "work_arrangement_no_self_approval"
  CHECK ("decided_by_id" IS NULL OR "decided_by_id" <> "employee_id");
--> statement-breakpoint

ALTER TABLE "hrms"."work_arrangement_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hrms"."work_arrangement_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "hrms"."work_arrangement_requests";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hrms"."work_arrangement_requests"
  USING (app_is_superuser() OR "org_id" = app_current_org())
  WITH CHECK (app_is_superuser() OR "org_id" = app_current_org());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE
  ON "hrms"."work_arrangement_requests" TO hrms_app;
