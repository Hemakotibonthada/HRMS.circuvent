-- ═══════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY + AUDIT CHAIN
-- ═══════════════════════════════════════════════════════════════
-- Tenant isolation is enforced by Postgres, not by application code.
--
-- The Firestore design in src/lib/tenant.ts relied on every query remembering
-- to add `where organizationId == <caller org>`. One forgotten filter leaked
-- another company's employees, payroll and leave. Here the database refuses to
-- return rows from another tenant even if the query has no WHERE clause at all.
--
-- The tenant is carried in the `app.org_id` GUC, set by withTenant() in
-- src/db/client.ts using `SET LOCAL` inside a transaction, so it is discarded
-- when the pooled connection is handed to the next request.

-- ─── Helpers ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_is_superuser() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.superuser', true), 'off') = 'on'
$$;

-- ─── Application role ────────────────────────────────────────
-- RLS is bypassed by the table owner and by BYPASSRLS roles, so the runtime
-- must connect as a role that has neither. Neon's default owner role owns the
-- tables, hence a separate, deliberately unprivileged application role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
    CREATE ROLE hrms_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA identity, hrms TO hrms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity, hrms TO hrms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity, hrms
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hrms_app;

-- ─── Apply RLS to every org-scoped table ─────────────────────

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name   = c.table_name
     AND t.table_type   = 'BASE TABLE'
    WHERE c.column_name = 'org_id'
      AND c.table_schema IN ('identity', 'hrms')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
                   target.table_schema, target.table_name);
    -- FORCE makes the policy apply to the table owner too, so a mistake in a
    -- migration script cannot quietly read across tenants either.
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
                   target.table_schema, target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I',
                   target.table_schema, target.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I'
      ' USING (app_is_superuser() OR org_id = app_current_org())'
      ' WITH CHECK (app_is_superuser() OR org_id = app_current_org())',
      target.table_schema, target.table_name);
  END LOOP;
END
$$;

-- organizations keys on `id` rather than `org_id`, so it needs its own policy.
ALTER TABLE identity.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON identity.organizations;
CREATE POLICY tenant_isolation ON identity.organizations
  USING (app_is_superuser() OR id = app_current_org())
  WITH CHECK (app_is_superuser() OR id = app_current_org());

-- ─── Sign-in path ────────────────────────────────────────────
-- Authentication happens before the tenant is known: the caller supplies only
-- an email address, and the organization is a result of the lookup rather than
-- an input to it. That single query runs as superuser via
-- withTenant({ superuser: true }) and must expose nothing beyond the
-- credential check.

CREATE OR REPLACE VIEW identity.login_lookup
WITH (security_barrier = true) AS
  SELECT id, org_id, email, password_hash, status, mfa_secret,
         failed_login_attempts, locked_until, must_reset_password, display_name
  FROM identity.users
  WHERE deleted_at IS NULL;

GRANT SELECT ON identity.login_lookup TO hrms_app;

-- ─── Audit log is append-only ────────────────────────────────
-- A tamper-evident trail is worthless if a compromised application role can
-- rewrite it, so UPDATE and DELETE are rejected outright.

CREATE OR REPLACE FUNCTION identity.audit_log_is_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'identity.audit_log is append-only; % is not permitted', TG_OP;
END
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON identity.audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON identity.audit_log
  FOR EACH ROW EXECUTE FUNCTION identity.audit_log_is_append_only();

REVOKE UPDATE, DELETE ON identity.audit_log FROM hrms_app;

-- Hash-chain each entry to the previous one for the same organization, so
-- removing a row from the middle of the history is detectable.
CREATE OR REPLACE FUNCTION identity.audit_log_chain()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prev_hash text;
BEGIN
  SELECT hash INTO prev_hash
  FROM identity.audit_log
  WHERE org_id = NEW.org_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  NEW.previous_hash := prev_hash;
  -- sha256() is built into Postgres 11+, so this needs no extension.
  NEW.hash := encode(
    sha256(
      convert_to(
        COALESCE(prev_hash, '') ||
        NEW.org_id::text ||
        COALESCE(NEW.actor_id::text, '') ||
        NEW.action ||
        NEW.entity_type ||
        COALESCE(NEW.entity_id, '') ||
        COALESCE(NEW.after::text, '') ||
        NEW.created_at::text,
        'UTF8'
      )
    ),
    'hex'
  );
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS audit_log_chain_hash ON identity.audit_log;
CREATE TRIGGER audit_log_chain_hash
  BEFORE INSERT ON identity.audit_log
  FOR EACH ROW EXECUTE FUNCTION identity.audit_log_chain();

-- ─── Self-referencing foreign keys ───────────────────────────
-- Declared here rather than in the Drizzle schema, where a column referencing
-- its own table would be a circular reference at module scope.

ALTER TABLE hrms.employees
  DROP CONSTRAINT IF EXISTS employees_reporting_to_id_fk;
ALTER TABLE hrms.employees
  ADD CONSTRAINT employees_reporting_to_id_fk
    FOREIGN KEY (reporting_to_id) REFERENCES hrms.employees(id) ON DELETE SET NULL;

ALTER TABLE hrms.departments
  DROP CONSTRAINT IF EXISTS departments_parent_id_fk;
ALTER TABLE hrms.departments
  ADD CONSTRAINT departments_parent_id_fk
    FOREIGN KEY (parent_id) REFERENCES hrms.departments(id) ON DELETE SET NULL;

ALTER TABLE hrms.performance_goals
  DROP CONSTRAINT IF EXISTS performance_goals_parent_goal_id_fk;
ALTER TABLE hrms.performance_goals
  ADD CONSTRAINT performance_goals_parent_goal_id_fk
    FOREIGN KEY (parent_goal_id) REFERENCES hrms.performance_goals(id) ON DELETE SET NULL;

-- ─── Integrity constraints ───────────────────────────────────

ALTER TABLE hrms.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_date_order;
ALTER TABLE hrms.leave_requests
  ADD CONSTRAINT leave_requests_date_order CHECK (end_date >= start_date);

ALTER TABLE hrms.payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_month_range;
ALTER TABLE hrms.payroll_runs
  ADD CONSTRAINT payroll_runs_month_range CHECK (period_month BETWEEN 1 AND 12);

-- Maker-checker: payroll must not be approved by whoever processed it.
ALTER TABLE hrms.payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_separate_approver;
ALTER TABLE hrms.payroll_runs
  ADD CONSTRAINT payroll_runs_separate_approver
    CHECK (approved_by_id IS NULL OR approved_by_id IS DISTINCT FROM processed_by_id);

ALTER TABLE hrms.payroll_records
  DROP CONSTRAINT IF EXISTS payroll_records_non_negative_net;
ALTER TABLE hrms.payroll_records
  ADD CONSTRAINT payroll_records_non_negative_net CHECK (net_pay_minor >= 0);

ALTER TABLE hrms.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_clock_order;
ALTER TABLE hrms.attendance_records
  ADD CONSTRAINT attendance_clock_order
    CHECK (clock_out_at IS NULL OR clock_in_at IS NULL OR clock_out_at >= clock_in_at);