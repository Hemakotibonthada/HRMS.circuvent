-- ═══════════════════════════════════════════════════════════════
-- 0043 — mailbox address changes
-- ═══════════════════════════════════════════════════════════════
-- An intern who becomes permanent loses the "cvi-" prefix from their address
-- and keeps the rest: cvi-rahul@circuvent.com becomes rahul@circuvent.com, so
-- that six months of correspondence, address books and documents quoting them
-- still resolve to a person.
--
-- Carried by an outbox rather than performed inline because the mail server
-- has no rename operation: a Maildir path is derived from the address, so the
-- move is a create, a delete and an alias against a single small VM — three
-- calls, in that order, each able to fail on its own. `status` records how far
-- the sequence has got so a retry resumes rather than repeats.
--
-- `employees.work_email` is deliberately NOT updated when a row is queued
-- here. It moves only once the new address is confirmed to exist. An HRMS
-- record naming a mailbox that cannot receive is worse than one still naming
-- the old address, because payroll, the directory and colleagues all read it.

CREATE TABLE IF NOT EXISTS hrms.mailbox_change_outbox (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  employee_id        uuid NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
  from_address       text NOT NULL,
  to_address         text NOT NULL,
  reason             text NOT NULL,
  alias_old_address  boolean NOT NULL DEFAULT true,
  status             text NOT NULL DEFAULT 'pending',
  attempt_count      integer NOT NULL DEFAULT 0,
  last_error         text,
  next_attempt_at    timestamptz,
  last_attempt_at    timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- One outstanding move per employee per target, so a conversion clicked twice
-- queues one change — matching the idempotency the conversion itself already
-- guarantees under its row lock.
CREATE UNIQUE INDEX IF NOT EXISTS mailbox_change_outbox_employee_target_key
  ON hrms.mailbox_change_outbox (org_id, employee_id, to_address);

CREATE INDEX IF NOT EXISTS mailbox_change_outbox_retry_idx
  ON hrms.mailbox_change_outbox (status, next_attempt_at);

-- Tenant isolation, matching every other org-scoped table in this schema.
-- FORCE matters because the application role owns these tables and would
-- otherwise be exempt from its own policy.
ALTER TABLE hrms.mailbox_change_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms.mailbox_change_outbox FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mailbox_change_outbox_tenant_isolation ON hrms.mailbox_change_outbox;
CREATE POLICY mailbox_change_outbox_tenant_isolation ON hrms.mailbox_change_outbox
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
