-- ═══════════════════════════════════════════════════════════════
-- ATTENDANCE — location confidence and review flags
-- ═══════════════════════════════════════════════════════════════
-- `is_within_geofence` is a boolean, and a boolean cannot say "the fix was
-- too rough to know". Indoors, on a phone, that is the usual case, and it was
-- being recorded as a confident true or false. These columns keep the
-- judgement and the evidence for it.
--
-- Nothing here refuses a punch. A mock-provider flag or an implausible fix is
-- a reason for someone to ask a question, not to dock a day's pay on a
-- heuristic — every signal has an innocent explanation, and the person who
-- actually turned up for work should not have to prove it.

ALTER TABLE hrms.attendance_records
  ADD COLUMN IF NOT EXISTS geofence_confidence text,
  ADD COLUMN IF NOT EXISTS requires_location_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS location_signals jsonb;

-- Constrained to the vocabulary the geofence module produces. Without this a
-- typo in application code becomes a silently unreviewable row.
ALTER TABLE hrms.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_geofence_confidence_check;

ALTER TABLE hrms.attendance_records
  ADD CONSTRAINT attendance_geofence_confidence_check
  CHECK (
    geofence_confidence IS NULL
    OR geofence_confidence IN ('inside', 'probably_inside', 'uncertain', 'outside')
  );

-- Signals are an array of objects; an object or a bare string would break
-- every reader that iterates them.
ALTER TABLE hrms.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_location_signals_shape_check;

ALTER TABLE hrms.attendance_records
  ADD CONSTRAINT attendance_location_signals_shape_check
  CHECK (location_signals IS NULL OR jsonb_typeof(location_signals) = 'array');

-- A flagged row must carry its reason. "Requires review" with nothing to
-- review is an alert a human cannot action, which trains people to ignore
-- alerts. Confidence below "inside" is itself a sufficient reason.
--
-- The IS NOT NULL is load-bearing, not defensive noise. `NULL IN (...)` is
-- NULL, not false, and a CHECK constraint that evaluates to NULL *passes* —
-- so without it the whole constraint silently allowed exactly the row it
-- exists to reject whenever confidence was unset. The verifier caught this.
ALTER TABLE hrms.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_review_has_reason_check;

ALTER TABLE hrms.attendance_records
  ADD CONSTRAINT attendance_review_has_reason_check
  CHECK (
    requires_location_review = false
    OR location_signals IS NOT NULL
    OR (
      geofence_confidence IS NOT NULL
      AND geofence_confidence IN ('probably_inside', 'uncertain')
    )
  );

-- Partial: the review queue is a handful of rows in a table that grows by one
-- row per employee per day forever.
CREATE INDEX IF NOT EXISTS attendance_location_review_idx
  ON hrms.attendance_records (org_id, work_date)
  WHERE requires_location_review;
