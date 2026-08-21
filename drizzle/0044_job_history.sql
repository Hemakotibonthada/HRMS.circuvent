-- ═══════════════════════════════════════════════════════════════
-- Job history: what somebody's job used to be
-- ═══════════════════════════════════════════════════════════════
--
-- employees.designation, department_id, reporting_to_id and employment_type are
-- single columns that get overwritten. The moment HR types a new title the old
-- one is gone, so the system could answer "what is your role" and never "what
-- was it, and when did it change" — which is what a timeline, a promotion
-- letter and half of a performance conversation are actually about.
--
-- A row is written here whenever one of those four changes. Nothing is
-- backfilled: an employee whose record predates this table genuinely has no
-- recorded history, and inventing one would put a career on screen that no
-- record supports.
--
-- Both sides of every change are stored. Keeping only the new value would mean
-- reconstructing the old one from the previous row, which fails for the first
-- row and for any gap.
--
-- Names are stored beside the ids deliberately. A department can be renamed or
-- deleted, and "moved to Engineering" must keep saying that after Engineering
-- becomes Platform — because that is what happened at the time.
--
-- Its own TypeScript module rather than hrms.ts, which at 81KB is already at
-- the inference limit that 0042 ran into.

CREATE TABLE IF NOT EXISTS "hrms"."job_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "hrms"."employees"("id") ON DELETE CASCADE,
  "field" text NOT NULL,
  "from_value" text,
  "to_value" text,
  "from_id" uuid,
  "to_id" uuid,
  -- The day the change took effect, which is not the day it was typed. HR
  -- records a promotion in March that applied from January, and a timeline
  -- ordered by when somebody got round to the paperwork is a timeline of the
  -- paperwork.
  "effective_on" timestamp with time zone DEFAULT now() NOT NULL,
  "note" text,
  "changed_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "hrms"."job_history"
  DROP CONSTRAINT IF EXISTS "job_history_field_known";
--> statement-breakpoint
-- A closed list. An open one becomes a place to record anything, and a
-- timeline that mixes "designation" with "note_from_hr" cannot be read.
ALTER TABLE "hrms"."job_history"
  ADD CONSTRAINT "job_history_field_known"
  CHECK ("field" IN ('designation', 'department', 'manager', 'employment_type'));
--> statement-breakpoint

-- A change from a value to the same value is not a change, and recording one
-- puts "Role changed from Engineer to Engineer" on somebody's timeline.
ALTER TABLE "hrms"."job_history"
  DROP CONSTRAINT IF EXISTS "job_history_actually_changed";
--> statement-breakpoint
ALTER TABLE "hrms"."job_history"
  ADD CONSTRAINT "job_history_actually_changed"
  CHECK ("from_value" IS DISTINCT FROM "to_value" OR "from_id" IS DISTINCT FROM "to_id");
--> statement-breakpoint

-- Drives the timeline: one employee, newest first.
CREATE INDEX IF NOT EXISTS "job_history_employee_idx"
  ON "hrms"."job_history" ("employee_id", "effective_on");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "job_history_org_idx"
  ON "hrms"."job_history" ("org_id");
--> statement-breakpoint

ALTER TABLE "hrms"."job_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hrms"."job_history" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "hrms"."job_history";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hrms"."job_history"
  USING (app_is_superuser() OR "org_id" = app_current_org())
  WITH CHECK (app_is_superuser() OR "org_id" = app_current_org());
--> statement-breakpoint

-- Stated explicitly rather than left to ALTER DEFAULT PRIVILEGES, which only
-- applies to tables created by the role that set it. This migration is run by
-- the owner, not by hrms_app, so the default may not reach it — and 0028 is
-- blunt about the consequence: "a migration silently breaks the application for
-- want of a grant."
--
-- The failure would be quiet in the worst way. The table would exist, the
-- application's to_regclass check would say so, and the INSERT would then fail
-- with permission denied *inside* the employee update's transaction — turning
-- a missing grant into "HR cannot save anybody".
--
-- No DELETE. A history exists so that a record cannot be quietly rewritten;
-- handing the application the ability to erase rows from it defeats the table.
GRANT SELECT, INSERT ON "hrms"."job_history" TO hrms_app;
