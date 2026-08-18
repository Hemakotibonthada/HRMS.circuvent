-- ═══════════════════════════════════════════════════════════════
-- PAYSTUB EMPLOYEE SYNC OUTBOX
-- ═══════════════════════════════════════════════════════════════
-- HRMS is the source of truth for employee identity and employment facts, but
-- a hire must not fail because Paystub is unreachable. This table records the
-- durable intent to push the current employee row to Paystub, and the retry
-- state a human or scheduled script can re-drive after an outage.

CREATE TABLE IF NOT EXISTS "hrms"."paystub_employee_sync_outbox" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"          uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "employee_id"     uuid NOT NULL REFERENCES "hrms"."employees"("id") ON DELETE CASCADE,
  "status"          text NOT NULL DEFAULT 'pending',
  "attempt_count"   integer NOT NULL DEFAULT 0,
  "last_error"      text,
  "last_created"    boolean,
  "next_attempt_at" timestamptz,
  "last_attempt_at" timestamptz,
  "synced_at"       timestamptz,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "paystub_employee_sync_outbox_employee_key"
  ON "hrms"."paystub_employee_sync_outbox" ("org_id", "employee_id");

CREATE INDEX IF NOT EXISTS "paystub_employee_sync_outbox_retry_idx"
  ON "hrms"."paystub_employee_sync_outbox" ("status", "next_attempt_at");

ALTER TABLE "hrms"."paystub_employee_sync_outbox"
  DROP CONSTRAINT IF EXISTS "paystub_employee_sync_outbox_status_valid";
ALTER TABLE "hrms"."paystub_employee_sync_outbox"
  ADD CONSTRAINT "paystub_employee_sync_outbox_status_valid"
    CHECK ("status" IN ('pending', 'processing', 'succeeded', 'failed'));

SELECT apply_tenant_rls();
