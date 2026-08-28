-- ═══════════════════════════════════════════════════════════════
-- DIRECTORY GROUP JOIN OUTBOX
-- ═══════════════════════════════════════════════════════════════
-- Groups live in the identity provider, not here. `lib/directory-sdk.ts` says
-- why in its own header: a synced roster is a wrong roster, so people and
-- groups are asked for at the moment they are needed rather than copied.
--
-- But onboarding has to *write* — a new hire joins the groups that grant their
-- standard access and put them on the all-staff address — and a hire must not
-- fail because auth.circuvent.com is unreachable, any more than it may fail
-- because Paystub is. This table is the same shape and the same idea as
-- `paystub_employee_sync_outbox`: the durable intent to add somebody to a
-- group, plus the retry state a scheduled sweep re-drives after an outage.
--
-- It is an outbox, not a copy. Nothing reads membership from here; the only
-- question it answers is "has this join been carried out yet".

CREATE TABLE IF NOT EXISTS "hrms"."directory_group_join_outbox" (
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
  "joined_at"       timestamptz,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

-- One pending intent per employee per group. Re-running onboarding, or a
-- backfill overlapping a live hire, reopens the same row rather than queuing
-- the same join twice.
CREATE UNIQUE INDEX IF NOT EXISTS "directory_group_join_outbox_member_key"
  ON "hrms"."directory_group_join_outbox" ("org_id", "employee_id", "group_address");

CREATE INDEX IF NOT EXISTS "directory_group_join_outbox_retry_idx"
  ON "hrms"."directory_group_join_outbox" ("status", "next_attempt_at");

ALTER TABLE "hrms"."directory_group_join_outbox"
  DROP CONSTRAINT IF EXISTS "directory_group_join_outbox_status_valid";
ALTER TABLE "hrms"."directory_group_join_outbox"
  ADD CONSTRAINT "directory_group_join_outbox_status_valid"
    CHECK ("status" IN ('pending', 'processing', 'succeeded', 'failed'));

SELECT apply_tenant_rls();
