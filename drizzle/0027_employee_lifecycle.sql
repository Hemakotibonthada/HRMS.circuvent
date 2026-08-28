-- ═══════════════════════════════════════════════════════════════
-- EMPLOYEE LIFECYCLE — onboarding and offboarding checklists
-- ═══════════════════════════════════════════════════════════════
-- The templates and the progress arithmetic have existed in
-- `src/lib/employee-lifecycle.ts` since early on. What was missing was
-- anywhere to put the answer: both dashboard pages held their tick state in
-- React `useState`, so an HR admin working through an exit checklist —
-- "Laptop returned", "Access revoked", "Final settlement processed" — lost
-- every tick on refresh. Offboarding compounded it by showing a
-- "Clearance updated" toast, which said the opposite of what happened.
--
-- Exit clearance is not ordinary lost work. It is the record that proves
-- company property came back and access was cut, and it is the first thing
-- anyone asks for after an incident involving someone who has left.

CREATE TYPE "hrms"."lifecycle_kind" AS ENUM ('onboarding', 'offboarding');

CREATE TABLE IF NOT EXISTS "hrms"."lifecycle_journeys" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"       uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "employee_id"  uuid NOT NULL REFERENCES "hrms"."employees"("id") ON DELETE CASCADE,
  "kind"         "hrms"."lifecycle_kind" NOT NULL,
  "anchor_date"  date NOT NULL,
  "status"       text NOT NULL DEFAULT 'in_progress',
  "exit_reason"  text,
  "completed_at" timestamptz,
  "created_at"   timestamptz DEFAULT now() NOT NULL,
  "updated_at"   timestamptz DEFAULT now() NOT NULL
);

-- One live journey of each kind per person. Somebody is onboarded once and
-- offboarded once; a second concurrent checklist means two people ticking
-- different copies of the same list and neither being the record.
CREATE UNIQUE INDEX IF NOT EXISTS "lifecycle_journeys_employee_kind_key"
  ON "hrms"."lifecycle_journeys" ("employee_id", "kind");

CREATE INDEX IF NOT EXISTS "lifecycle_journeys_org_status_idx"
  ON "hrms"."lifecycle_journeys" ("org_id", "status");

CREATE INDEX IF NOT EXISTS "lifecycle_journeys_org_created_idx"
  ON "hrms"."lifecycle_journeys" ("org_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "hrms"."lifecycle_tasks" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"           uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "journey_id"       uuid NOT NULL REFERENCES "hrms"."lifecycle_journeys"("id") ON DELETE CASCADE,
  "task_key"         text NOT NULL,
  "title"            text NOT NULL,
  "phase"            text NOT NULL,
  "phase_order"      integer DEFAULT 0 NOT NULL,
  "assignee"         text DEFAULT 'hr' NOT NULL,
  "mandatory"        boolean DEFAULT false NOT NULL,
  "due_offset_days"  integer DEFAULT 0 NOT NULL,
  "completed"        boolean DEFAULT false NOT NULL,
  "completed_at"     timestamptz,
  "completed_by_id"  uuid,
  "notes"            text,
  "created_at"       timestamptz DEFAULT now() NOT NULL
);

-- A template task appears once per journey. Without this a retried request
-- silently duplicates the checklist, and the progress percentage drops for a
-- reason nobody can see.
CREATE UNIQUE INDEX IF NOT EXISTS "lifecycle_tasks_journey_key_key"
  ON "hrms"."lifecycle_tasks" ("journey_id", "task_key");

CREATE INDEX IF NOT EXISTS "lifecycle_tasks_journey_idx"
  ON "hrms"."lifecycle_tasks" ("journey_id");

CREATE INDEX IF NOT EXISTS "lifecycle_tasks_org_completed_idx"
  ON "hrms"."lifecycle_tasks" ("org_id", "completed");

-- ─── Integrity ───────────────────────────────────────────────

-- `completed` and `completed_at` must agree. Reading one while the other says
-- otherwise is how a clearance ends up looking done with no record of when or
-- by whom — which is exactly the question an audit asks.
ALTER TABLE "hrms"."lifecycle_tasks"
  DROP CONSTRAINT IF EXISTS "lifecycle_tasks_completion_consistent";
ALTER TABLE "hrms"."lifecycle_tasks"
  ADD CONSTRAINT "lifecycle_tasks_completion_consistent"
    CHECK (("completed" AND "completed_at" IS NOT NULL)
        OR (NOT "completed" AND "completed_at" IS NULL));

ALTER TABLE "hrms"."lifecycle_journeys"
  DROP CONSTRAINT IF EXISTS "lifecycle_journeys_status_valid";
ALTER TABLE "hrms"."lifecycle_journeys"
  ADD CONSTRAINT "lifecycle_journeys_status_valid"
    CHECK ("status" IN ('in_progress', 'completed', 'cancelled'));

-- A completed journey records when. Same reasoning as the task constraint.
ALTER TABLE "hrms"."lifecycle_journeys"
  DROP CONSTRAINT IF EXISTS "lifecycle_journeys_completion_consistent";
ALTER TABLE "hrms"."lifecycle_journeys"
  ADD CONSTRAINT "lifecycle_journeys_completion_consistent"
    CHECK (("status" = 'completed' AND "completed_at" IS NOT NULL)
        OR ("status" <> 'completed' AND "completed_at" IS NULL));

-- ─── Tenant isolation ────────────────────────────────────────
-- The sweep from 0003. Every migration that adds an org-scoped table must call
-- it, or that table returns every tenant's rows to every caller.

SELECT apply_tenant_rls();
