-- ═══════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY FOR NEW TABLES
-- ═══════════════════════════════════════════════════════════════
-- Migration 0001 applied RLS by scanning for org_id columns, but it ran before
-- the talent tables existed. Rather than repeating that DO block every time a
-- table is added — and inevitably forgetting once — the sweep becomes a
-- function that any later migration calls.
--
-- Forgetting it on a single table is not a cosmetic slip: that table would
-- return every tenant's rows to every caller.

CREATE OR REPLACE FUNCTION apply_tenant_rls(target_schemas text[] DEFAULT ARRAY['identity','hrms'])
RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  target record;
  applied int := 0;
BEGIN
  FOR target IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name   = c.table_name
     AND t.table_type   = 'BASE TABLE'
    WHERE c.column_name = 'org_id'
      AND c.table_schema = ANY(target_schemas)
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
                   target.table_schema, target.table_name);
    -- FORCE so the policy applies to the table owner too; a mistake in a
    -- migration script must not be able to read across tenants either.
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
                   target.table_schema, target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I',
                   target.table_schema, target.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I'
      ' USING (app_is_superuser() OR org_id = app_current_org())'
      ' WITH CHECK (app_is_superuser() OR org_id = app_current_org())',
      target.table_schema, target.table_name);

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.%I TO hrms_app',
                   target.table_schema, target.table_name);

    applied := applied + 1;
  END LOOP;

  RETURN applied;
END
$$;

SELECT apply_tenant_rls();

-- ─── Referral integrity ──────────────────────────────────────

-- A bonus cannot be approved by the person who earns it. Enforced in the
-- repository as well, for a clearer message, but the constraint is what makes
-- it unbypassable by any future code path.
ALTER TABLE hrms.referrals
  DROP CONSTRAINT IF EXISTS referrals_separate_payout_approver;
ALTER TABLE hrms.referrals
  ADD CONSTRAINT referrals_separate_payout_approver
    CHECK (payout_approved_by_id IS NULL OR payout_approved_by_id IS DISTINCT FROM referrer_id);

-- Nobody refers themselves. The repository compares email addresses, which
-- catches the normal case; this catches the case where the candidate later
-- becomes the referrer's own employee record.
ALTER TABLE hrms.referrals
  DROP CONSTRAINT IF EXISTS referrals_no_self_referral;
ALTER TABLE hrms.referrals
  ADD CONSTRAINT referrals_no_self_referral
    CHECK (hired_employee_id IS NULL OR hired_employee_id IS DISTINCT FROM referrer_id);

ALTER TABLE hrms.referrals
  DROP CONSTRAINT IF EXISTS referrals_bonus_non_negative;
ALTER TABLE hrms.referrals
  ADD CONSTRAINT referrals_bonus_non_negative CHECK (bonus_amount_minor >= 0);

-- A paid bonus must record which payroll run paid it, or the money is
-- untraceable at reconciliation.
ALTER TABLE hrms.referrals
  DROP CONSTRAINT IF EXISTS referrals_paid_has_run;
ALTER TABLE hrms.referrals
  ADD CONSTRAINT referrals_paid_has_run
    CHECK (payout_status <> 'paid' OR payout_payroll_run_id IS NOT NULL);

-- ─── Benefits integrity ──────────────────────────────────────

-- An enrolment window that closes before it opens would accept elections
-- forever or never.
ALTER TABLE hrms.enrolment_windows
  DROP CONSTRAINT IF EXISTS enrolment_windows_date_order;
ALTER TABLE hrms.enrolment_windows
  ADD CONSTRAINT enrolment_windows_date_order CHECK (closes_on >= opens_on);

ALTER TABLE hrms.benefit_enrolments
  DROP CONSTRAINT IF EXISTS benefit_enrolments_coverage_order;
ALTER TABLE hrms.benefit_enrolments
  ADD CONSTRAINT benefit_enrolments_coverage_order
    CHECK (coverage_to IS NULL OR coverage_from IS NULL OR coverage_to >= coverage_from);

-- Nominee shares across an employee's dependants cannot exceed 100%. Checked
-- per row here; the repository validates the sum.
ALTER TABLE hrms.dependants
  DROP CONSTRAINT IF EXISTS dependants_nominee_share_range;
ALTER TABLE hrms.dependants
  ADD CONSTRAINT dependants_nominee_share_range
    CHECK (nominee_share_percent IS NULL OR nominee_share_percent BETWEEN 0 AND 100);

-- ─── Learning integrity ──────────────────────────────────────

ALTER TABLE hrms.course_enrolments
  DROP CONSTRAINT IF EXISTS course_enrolments_progress_range;
ALTER TABLE hrms.course_enrolments
  ADD CONSTRAINT course_enrolments_progress_range
    CHECK (progress_percent BETWEEN 0 AND 100);

ALTER TABLE hrms.course_enrolments
  DROP CONSTRAINT IF EXISTS course_enrolments_score_range;
ALTER TABLE hrms.course_enrolments
  ADD CONSTRAINT course_enrolments_score_range
    CHECK (score_percent IS NULL OR score_percent BETWEEN 0 AND 100);

-- A certification that expires before it was issued is a data-entry error that
-- would otherwise show as permanently lapsed on the compliance report.
ALTER TABLE hrms.certifications
  DROP CONSTRAINT IF EXISTS certifications_expiry_after_issue;
ALTER TABLE hrms.certifications
  ADD CONSTRAINT certifications_expiry_after_issue
    CHECK (expires_on IS NULL OR expires_on >= issued_on);

-- ─── Signature integrity ─────────────────────────────────────

-- A signature cannot be both signed and declined.
ALTER TABLE hrms.document_signatures
  DROP CONSTRAINT IF EXISTS document_signatures_single_outcome;
ALTER TABLE hrms.document_signatures
  ADD CONSTRAINT document_signatures_single_outcome
    CHECK (signed_at IS NULL OR declined_at IS NULL);

-- A signed row must carry the hash of what was signed, or the signature proves
-- nothing about the document's contents.
ALTER TABLE hrms.document_signatures
  DROP CONSTRAINT IF EXISTS document_signatures_signed_has_hash;
ALTER TABLE hrms.document_signatures
  ADD CONSTRAINT document_signatures_signed_has_hash
    CHECK (signed_at IS NULL OR signed_content_hash IS NOT NULL);