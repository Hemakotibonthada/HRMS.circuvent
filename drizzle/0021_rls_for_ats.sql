-- ═══════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY AND INTEGRITY FOR ATS TABLES
-- ═══════════════════════════════════════════════════════════════
-- The sweep from 0003. Every migration that adds an org-scoped table must call
-- it, or that table returns every tenant's rows to every caller.

SELECT apply_tenant_rls();

-- ─── Pipeline integrity ──────────────────────────────────────

ALTER TABLE hrms.pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_sequence_positive;
ALTER TABLE hrms.pipeline_stages
  ADD CONSTRAINT pipeline_stages_sequence_positive CHECK (sequence > 0);

ALTER TABLE hrms.pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_scorecards_non_negative;
ALTER TABLE hrms.pipeline_stages
  ADD CONSTRAINT pipeline_stages_scorecards_non_negative
    CHECK (required_scorecards >= 0);

-- An auto-reject threshold outside the scale either rejects everyone or
-- nobody, and which one is not obvious from the configuration screen.
ALTER TABLE hrms.pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_threshold_range;
ALTER TABLE hrms.pipeline_stages
  ADD CONSTRAINT pipeline_stages_threshold_range
    CHECK (auto_reject_below IS NULL OR auto_reject_below BETWEEN 1 AND 5);

-- ─── Application history immutability ────────────────────────
--
-- An unsuccessful candidate's discrimination claim asks for the record of why
-- they were considered and rejected. A history that can be rewritten answers
-- nothing, and its having been rewritten is itself the finding.

CREATE OR REPLACE FUNCTION hrms.application_events_is_append_only()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'hrms.application_events is append-only; % is not permitted', TG_OP;
END
$$;

DROP TRIGGER IF EXISTS application_events_no_update ON hrms.application_events;
CREATE TRIGGER application_events_no_update
  BEFORE UPDATE OR DELETE ON hrms.application_events
  FOR EACH ROW EXECUTE FUNCTION hrms.application_events_is_append_only();

-- ─── Scorecard integrity ─────────────────────────────────────

-- A submitted scorecard must carry a recommendation. Scores alone leave the
-- panel summary guessing at what the interviewer concluded.
ALTER TABLE hrms.interview_scorecards
  DROP CONSTRAINT IF EXISTS interview_scorecards_submitted_has_recommendation;
ALTER TABLE hrms.interview_scorecards
  ADD CONSTRAINT interview_scorecards_submitted_has_recommendation
    CHECK (submitted_at IS NULL OR recommendation IS NOT NULL);

-- Ratings must be on the scale. A six in one card silently pulls a panel
-- average above what anyone actually gave.
--
-- A trigger rather than a CHECK: validating every value of a jsonb object
-- needs jsonb_each, and a CHECK constraint cannot contain a subquery. A
-- pattern match on the serialised text was the first attempt here and was
-- removed — it matched digits inside competency names as readily as inside
-- scores, so it would have rejected valid cards and passed invalid ones.
CREATE OR REPLACE FUNCTION hrms.interview_scorecards_validate_scores()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  value jsonb;
BEGIN
  IF jsonb_typeof(NEW.scores) <> 'object' THEN
    RAISE EXCEPTION 'Scorecard scores must be an object';
  END IF;

  FOR value IN SELECT v FROM jsonb_each(NEW.scores) AS e(k, v) LOOP
    IF jsonb_typeof(value) <> 'number' THEN
      RAISE EXCEPTION 'Scorecard scores must be numbers';
    END IF;
    IF (value)::text::numeric NOT BETWEEN 1 AND 5 THEN
      RAISE EXCEPTION 'Scorecard scores must be between 1 and 5, got %', value;
    END IF;
  END LOOP;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS interview_scorecards_check_scores ON hrms.interview_scorecards;
CREATE TRIGGER interview_scorecards_check_scores
  BEFORE INSERT OR UPDATE ON hrms.interview_scorecards
  FOR EACH ROW EXECUTE FUNCTION hrms.interview_scorecards_validate_scores();

-- Once submitted, a scorecard is final. A revision made after reading the
-- panel is exactly the convergence the visibility rule exists to prevent.
CREATE OR REPLACE FUNCTION hrms.interview_scorecards_are_final()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'A submitted scorecard cannot be changed';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS interview_scorecards_no_resubmit ON hrms.interview_scorecards;
CREATE TRIGGER interview_scorecards_no_resubmit
  BEFORE UPDATE ON hrms.interview_scorecards
  FOR EACH ROW EXECUTE FUNCTION hrms.interview_scorecards_are_final();

-- ─── Offer integrity ─────────────────────────────────────────

ALTER TABLE hrms.offers
  DROP CONSTRAINT IF EXISTS offers_ctc_positive;
ALTER TABLE hrms.offers
  ADD CONSTRAINT offers_ctc_positive
    CHECK (annual_ctc_minor > 0 AND (joining_bonus_minor IS NULL OR joining_bonus_minor >= 0));

-- The same separation payroll, erasure and compensation use. An offer commits
-- the company to a salary; one person drafting and approving it has no check
-- on it at all.
ALTER TABLE hrms.offers
  DROP CONSTRAINT IF EXISTS offers_separate_approver;
ALTER TABLE hrms.offers
  ADD CONSTRAINT offers_separate_approver
    CHECK (
      approved_by_id IS NULL
      OR created_by_id IS NULL
      OR approved_by_id IS DISTINCT FROM created_by_id
    );

-- An offer cannot be sent without approval.
ALTER TABLE hrms.offers
  DROP CONSTRAINT IF EXISTS offers_sent_needs_approval;
ALTER TABLE hrms.offers
  ADD CONSTRAINT offers_sent_needs_approval
    CHECK (sent_at IS NULL OR approved_at IS NOT NULL);

-- A candidate holding two live offers with different numbers is a dispute
-- waiting to happen.
DROP INDEX IF EXISTS hrms.offers_one_live_per_application;
CREATE UNIQUE INDEX offers_one_live_per_application
  ON hrms.offers (application_id)
  WHERE status IN ('sent', 'accepted');
