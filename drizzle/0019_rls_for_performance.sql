-- ═══════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY AND INTEGRITY FOR PERFORMANCE TABLES
-- ═══════════════════════════════════════════════════════════════
-- The sweep from 0003. Every migration that adds an org-scoped table must call
-- it, or that table returns every tenant's rows to every caller.

SELECT apply_tenant_rls();

-- ─── Rating integrity ────────────────────────────────────────

-- A rating outside the scale breaks every average and every distribution
-- silently, and the number it breaks decides someone's pay.
ALTER TABLE hrms.competency_ratings
  DROP CONSTRAINT IF EXISTS competency_ratings_scale;
ALTER TABLE hrms.competency_ratings
  ADD CONSTRAINT competency_ratings_scale CHECK (rating BETWEEN 1 AND 5);

ALTER TABLE hrms.competency_ratings
  DROP CONSTRAINT IF EXISTS competency_ratings_weight_positive;
ALTER TABLE hrms.competency_ratings
  ADD CONSTRAINT competency_ratings_weight_positive CHECK (weight > 0);

ALTER TABLE hrms.check_ins
  DROP CONSTRAINT IF EXISTS check_ins_mood_scale;
ALTER TABLE hrms.check_ins
  ADD CONSTRAINT check_ins_mood_scale
    CHECK (mood_rating IS NULL OR mood_rating BETWEEN 1 AND 5);

-- ─── 360° integrity ──────────────────────────────────────────

-- Nobody gives themselves peer feedback. Allowing it would let a subject pad
-- their own report from an account the anonymity rules then protect.
ALTER TABLE hrms.feedback_requests
  DROP CONSTRAINT IF EXISTS feedback_requests_not_self_as_peer;
ALTER TABLE hrms.feedback_requests
  ADD CONSTRAINT feedback_requests_not_self_as_peer
    CHECK (relationship = 'self' OR respondent_id IS DISTINCT FROM subject_id);

-- A declined request cannot also be completed.
ALTER TABLE hrms.feedback_requests
  DROP CONSTRAINT IF EXISTS feedback_requests_single_outcome;
ALTER TABLE hrms.feedback_requests
  ADD CONSTRAINT feedback_requests_single_outcome
    CHECK (completed_at IS NULL OR declined_at IS NULL);

-- Responses are written once. Allowing a rewrite would let someone be
-- persuaded to revise what they said, which is exactly the pressure anonymity
-- exists to remove.
CREATE OR REPLACE FUNCTION hrms.feedback_responses_are_final()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'hrms.feedback_responses is write-once; % is not permitted', TG_OP;
END
$$;

DROP TRIGGER IF EXISTS feedback_responses_no_update ON hrms.feedback_responses;
CREATE TRIGGER feedback_responses_no_update
  BEFORE UPDATE ON hrms.feedback_responses
  FOR EACH ROW EXECUTE FUNCTION hrms.feedback_responses_are_final();

-- ─── Calibration integrity ───────────────────────────────────

ALTER TABLE hrms.calibration_adjustments
  DROP CONSTRAINT IF EXISTS calibration_adjustments_rating_scale;
ALTER TABLE hrms.calibration_adjustments
  ADD CONSTRAINT calibration_adjustments_rating_scale
    CHECK (
      rating_after BETWEEN 1 AND 5
      AND (rating_before IS NULL OR rating_before BETWEEN 1 AND 5)
    );

-- An unexplained downgrade is indefensible at appeal, and an appeal is where
-- this row is read.
ALTER TABLE hrms.calibration_adjustments
  DROP CONSTRAINT IF EXISTS calibration_adjustments_has_justification;
ALTER TABLE hrms.calibration_adjustments
  ADD CONSTRAINT calibration_adjustments_has_justification
    CHECK (length(btrim(justification)) >= 10);

-- Insert-only. This is the record that answers "why was my rating lowered?",
-- and a row that can be edited afterwards answers nothing.
CREATE OR REPLACE FUNCTION hrms.calibration_adjustments_is_append_only()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'hrms.calibration_adjustments is append-only; % is not permitted', TG_OP;
END
$$;

DROP TRIGGER IF EXISTS calibration_adjustments_no_update ON hrms.calibration_adjustments;
CREATE TRIGGER calibration_adjustments_no_update
  BEFORE UPDATE OR DELETE ON hrms.calibration_adjustments
  FOR EACH ROW EXECUTE FUNCTION hrms.calibration_adjustments_is_append_only();

-- ─── Goal integrity ──────────────────────────────────────────

-- A goal that is its own parent makes the rollup recurse until the request
-- hangs. Deeper cycles are caught by canLink; this closes the trivial one.
ALTER TABLE hrms.performance_goals
  DROP CONSTRAINT IF EXISTS performance_goals_not_self_parent;
ALTER TABLE hrms.performance_goals
  ADD CONSTRAINT performance_goals_not_self_parent
    CHECK (parent_goal_id IS NULL OR parent_goal_id IS DISTINCT FROM id);

ALTER TABLE hrms.performance_goals
  DROP CONSTRAINT IF EXISTS performance_goals_progress_range;
ALTER TABLE hrms.performance_goals
  ADD CONSTRAINT performance_goals_progress_range
    CHECK (progress_percent BETWEEN 0 AND 100);
