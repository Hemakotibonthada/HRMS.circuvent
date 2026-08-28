-- ═══════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY AND INTEGRITY FOR GOVERNANCE TABLES
-- ═══════════════════════════════════════════════════════════════
-- The sweep from 0003. Every migration that adds an org-scoped table must call
-- it, or that table returns every tenant's rows to every caller.

SELECT apply_tenant_rls();

-- ─── Retention policy integrity ──────────────────────────────

ALTER TABLE hrms.retention_policies
  DROP CONSTRAINT IF EXISTS retention_policies_period_sane;
ALTER TABLE hrms.retention_policies
  ADD CONSTRAINT retention_policies_period_sane
    CHECK (retain_for_months >= 0 AND retain_for_months <= 1200);

-- A policy with no stated basis is one nobody can defend when challenged, or
-- safely change when the law does.
ALTER TABLE hrms.retention_policies
  DROP CONSTRAINT IF EXISTS retention_policies_has_basis;
ALTER TABLE hrms.retention_policies
  ADD CONSTRAINT retention_policies_has_basis CHECK (length(btrim(basis)) >= 3);

-- ─── Legal hold integrity ────────────────────────────────────

-- A hold with no review date is one nobody ever lifts, and an indefinite hold
-- quietly defeats the whole retention schedule.
ALTER TABLE hrms.legal_holds
  DROP CONSTRAINT IF EXISTS legal_holds_has_review_date;
ALTER TABLE hrms.legal_holds
  ADD CONSTRAINT legal_holds_has_review_date
    CHECK (released_at IS NOT NULL OR review_on IS NOT NULL);

-- A released hold must say why. "It was lifted" is not a record.
ALTER TABLE hrms.legal_holds
  DROP CONSTRAINT IF EXISTS legal_holds_release_has_reason;
ALTER TABLE hrms.legal_holds
  ADD CONSTRAINT legal_holds_release_has_reason
    CHECK (released_at IS NULL OR length(btrim(coalesce(release_reason, ''))) >= 5);

-- ─── Subject request integrity ───────────────────────────────

-- Approving before the requester is who they say they are is how someone
-- else's data gets destroyed by a person who merely claimed to be them.
ALTER TABLE hrms.data_subject_requests
  DROP CONSTRAINT IF EXISTS data_subject_requests_approval_needs_identity;
ALTER TABLE hrms.data_subject_requests
  ADD CONSTRAINT data_subject_requests_approval_needs_identity
    CHECK (approved_at IS NULL OR identity_verified_at IS NOT NULL);

-- The same separation payroll uses. One person deciding and executing an
-- irreversible deletion has no check on it at all.
ALTER TABLE hrms.data_subject_requests
  DROP CONSTRAINT IF EXISTS data_subject_requests_separate_approver;
ALTER TABLE hrms.data_subject_requests
  ADD CONSTRAINT data_subject_requests_separate_approver
    CHECK (
      approved_by_id IS NULL
      OR identity_verified_by_id IS NULL
      OR approved_by_id IS DISTINCT FROM identity_verified_by_id
    );

-- A completed request must have been approved first.
ALTER TABLE hrms.data_subject_requests
  DROP CONSTRAINT IF EXISTS data_subject_requests_completion_needs_approval;
ALTER TABLE hrms.data_subject_requests
  ADD CONSTRAINT data_subject_requests_completion_needs_approval
    CHECK (
      completed_at IS NULL
      OR request_type <> 'erasure'
      OR approved_at IS NOT NULL
    );

-- ─── Erasure log immutability ────────────────────────────────
--
-- This is the evidence that a destruction was authorised and scoped. A log
-- that can be edited or deleted proves nothing at all, so the table refuses
-- both — the same treatment identity.audit_log gets in 0001.

CREATE OR REPLACE FUNCTION hrms.erasure_log_is_append_only()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'hrms.erasure_log is append-only; % is not permitted', TG_OP;
END
$$;

DROP TRIGGER IF EXISTS erasure_log_no_update ON hrms.erasure_log;
CREATE TRIGGER erasure_log_no_update
  BEFORE UPDATE OR DELETE ON hrms.erasure_log
  FOR EACH ROW EXECUTE FUNCTION hrms.erasure_log_is_append_only();

ALTER TABLE hrms.erasure_log
  DROP CONSTRAINT IF EXISTS erasure_log_rows_non_negative;
ALTER TABLE hrms.erasure_log
  ADD CONSTRAINT erasure_log_rows_non_negative CHECK (rows_affected >= 0);

-- ─── Consent integrity ───────────────────────────────────────

-- A row is either a grant or a withdrawal, never both and never neither.
ALTER TABLE hrms.consent_records
  DROP CONSTRAINT IF EXISTS consent_records_single_outcome;
ALTER TABLE hrms.consent_records
  ADD CONSTRAINT consent_records_single_outcome
    CHECK ((granted_at IS NULL) <> (withdrawn_at IS NULL));

ALTER TABLE hrms.consent_records
  DROP CONSTRAINT IF EXISTS consent_records_version_positive;
ALTER TABLE hrms.consent_records
  ADD CONSTRAINT consent_records_version_positive CHECK (policy_version >= 1);

-- Append-only for the same reason as the erasure log: proving consent WAS
-- held at the time of a past processing is the entire point of the record,
-- and an editable history proves nothing.
CREATE OR REPLACE FUNCTION hrms.consent_records_is_append_only()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'hrms.consent_records is append-only; withdraw by inserting a new row';
END
$$;

DROP TRIGGER IF EXISTS consent_records_no_update ON hrms.consent_records;
CREATE TRIGGER consent_records_no_update
  BEFORE UPDATE OR DELETE ON hrms.consent_records
  FOR EACH ROW EXECUTE FUNCTION hrms.consent_records_is_append_only();
