-- ═══════════════════════════════════════════════════════════════
-- RESIGNATION AND THE LEAVER PATH
-- ═══════════════════════════════════════════════════════════════
-- The outbox defect that motivated this migration was specifically a leaver
-- bug: `directory_group_join_outbox` and `paystub_employee_sync_outbox` both
-- wrote `attempt_count`/`next_attempt_at` on failure, and until the cron
-- sweep in `outbox-sweep.ts` existed nothing ever read them back — the only
-- re-drive was the next edit to that employee's record. A new hire gets
-- edited constantly in their first weeks, so a failed join quietly healed
-- itself. A leaver gets no such edit; nobody touches an ex-employee's row
-- again. A failed push waited forever, and the account it should have
-- removed from `all@circuvent.com` kept receiving company mail.
--
-- `directory_group_leave_outbox` below is the leave-side counterpart, built
-- so the same cron sweep drains it exactly like the two outboxes that came
-- before it. `resignations` is the record of how an employee arrived at
-- their last working day — this table, not `employees.exit_date` directly,
-- is where the leaver path's own state (submitted, accepted, exit
-- processed, which documents have actually been issued) lives, so nothing
-- downstream has to infer "has this leaver already been fully processed"
-- from an employee row that was never designed to answer it.

CREATE TYPE "hrms"."resignation_status" AS ENUM ('submitted', 'accepted');

CREATE TABLE IF NOT EXISTS "hrms"."resignations" (
  "id"                                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"                              uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "employee_id"                         uuid NOT NULL REFERENCES "hrms"."employees"("id") ON DELETE CASCADE,
  "status"                              "hrms"."resignation_status" NOT NULL DEFAULT 'submitted',
  "reason"                              text NOT NULL,
  "intended_last_working_day"           date NOT NULL,
  "agreed_last_working_day"             date,
  "submitted_at"                        timestamptz DEFAULT now() NOT NULL,
  "accepted_at"                         timestamptz,
  "accepted_by_id"                      uuid,
  "last_working_day_adjusted_at"        timestamptz,
  "last_working_day_adjusted_by_id"     uuid,
  "exit_processed_at"                   timestamptz,
  -- The computed settlement, frozen the first time exit processing runs.
  -- Salary structures and leave balances keep changing after somebody
  -- leaves; recomputing on every read would change an amount a payslip
  -- already promised. Read back instead of recalculated, so a retry or a
  -- second cron tick produces the same number rather than a new one.
  "settlement_snapshot"                 jsonb,
  "relieving_letter_document_id"        uuid,
  "experience_certificate_document_id"  uuid,
  "internship_completion_document_id"   uuid,
  "created_at"                          timestamptz DEFAULT now() NOT NULL,
  "updated_at"                          timestamptz DEFAULT now() NOT NULL
);

-- One resignation *in flight* per employee — partial rather than absolute,
-- because an absolute unique constraint on employee_id would mean nobody
-- who ever resigned could be rehired and resign again. Once exit processing
-- has run the row is history, not an open request, so it drops out of the
-- constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "resignations_employee_key"
  ON "hrms"."resignations" ("employee_id")
  WHERE "exit_processed_at" IS NULL;

CREATE INDEX IF NOT EXISTS "resignations_org_status_idx"
  ON "hrms"."resignations" ("org_id", "status");

-- The cron sweep's whole query is "agreed dates that have passed and have
-- not been processed yet". Without this index that is a sequential scan
-- over every resignation the org has ever recorded.
CREATE INDEX IF NOT EXISTS "resignations_org_unprocessed_idx"
  ON "hrms"."resignations" ("org_id", "agreed_last_working_day");

-- Acceptance is one event, not three independent fields: a row cannot be
-- `accepted` without also recording who accepted it and what was agreed, and
-- cannot carry that acceptance metadata while still `submitted`. The same
-- shape as `lifecycle_journeys_completion_consistent` in 0027, for the same
-- reason — three columns that must agree are a bug waiting to desync the
-- moment one write path forgets one of them.
ALTER TABLE "hrms"."resignations"
  DROP CONSTRAINT IF EXISTS "resignations_acceptance_consistent";
ALTER TABLE "hrms"."resignations"
  ADD CONSTRAINT "resignations_acceptance_consistent"
    CHECK (
      ("status" = 'accepted' AND "accepted_at" IS NOT NULL AND "accepted_by_id" IS NOT NULL
        AND "agreed_last_working_day" IS NOT NULL)
      OR
      ("status" = 'submitted' AND "accepted_at" IS NULL AND "accepted_by_id" IS NULL)
    );

-- Exit processing (group removal, Paystub inactivation, document issuance)
-- presumes both sides have already agreed to a last working day. Without
-- this a bug could fire the whole leaver path off a resignation nobody on
-- the other side had signed off on yet.
ALTER TABLE "hrms"."resignations"
  DROP CONSTRAINT IF EXISTS "resignations_processed_requires_accepted";
ALTER TABLE "hrms"."resignations"
  ADD CONSTRAINT "resignations_processed_requires_accepted"
    CHECK ("exit_processed_at" IS NULL OR "status" = 'accepted');

-- ─── Directory group leave outbox ────────────────────────────
-- The leave-side mirror of `directory_group_join_outbox` (0033). A group
-- *join* gets an accidental safety net for free — the next unrelated edit to
-- that employee re-queues it — a group *leave* gets no such thing, because
-- nobody edits an ex-employee's record again. This table, drained by the
-- same cron sweep, is what makes a failed removal retried rather than the
-- silent, indefinite hole this whole migration exists to close.

CREATE TABLE IF NOT EXISTS "hrms"."directory_group_leave_outbox" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"          uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "employee_id"     uuid NOT NULL REFERENCES "hrms"."employees"("id") ON DELETE CASCADE,
  "group_address"   text NOT NULL,
  "member_email"    text NOT NULL,
  "status"          text NOT NULL DEFAULT 'pending',
  "attempt_count"   integer NOT NULL DEFAULT 0,
  "last_error"      text,
  "next_attempt_at" timestamptz,
  "last_attempt_at" timestamptz,
  "left_at"         timestamptz,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

-- One pending intent per employee per group, the same reasoning as the
-- join-side unique key: re-running exit processing reopens the same row
-- rather than queuing the same removal twice.
CREATE UNIQUE INDEX IF NOT EXISTS "directory_group_leave_outbox_member_key"
  ON "hrms"."directory_group_leave_outbox" ("org_id", "employee_id", "group_address");

CREATE INDEX IF NOT EXISTS "directory_group_leave_outbox_retry_idx"
  ON "hrms"."directory_group_leave_outbox" ("status", "next_attempt_at");

ALTER TABLE "hrms"."directory_group_leave_outbox"
  DROP CONSTRAINT IF EXISTS "directory_group_leave_outbox_status_valid";
ALTER TABLE "hrms"."directory_group_leave_outbox"
  ADD CONSTRAINT "directory_group_leave_outbox_status_valid"
    CHECK ("status" IN ('pending', 'processing', 'succeeded', 'failed'));

-- ─── Tenant isolation ────────────────────────────────────────
-- The sweep from 0003. Every migration that adds an org-scoped table must
-- call it, or that table returns every tenant's rows to every caller.

SELECT apply_tenant_rls();
