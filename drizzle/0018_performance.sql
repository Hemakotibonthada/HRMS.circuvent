-- ═══════════════════════════════════════════════════════════════
-- PERFORMANCE — competencies, 360°, calibration, check-ins
-- ═══════════════════════════════════════════════════════════════
-- Companions to hrms.review_cycles, hrms.performance_goals and
-- hrms.performance_reviews, which already carry cascading parent goals and the
-- nine-box axes. Those are extended here, not replaced.

CREATE TYPE hrms.feedback_relationship AS ENUM (
  'peer', 'direct_report', 'manager', 'self', 'external'
);

CREATE TYPE hrms.calibration_status AS ENUM (
  'scheduled', 'in_progress', 'completed', 'cancelled'
);

-- ─── Competencies ────────────────────────────────────────────

CREATE TABLE hrms.competencies (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                     uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  name                       text NOT NULL,
  description                text,
  category                   text,
  behavioural_anchors        jsonb NOT NULL DEFAULT '{}'::jsonb,
  applies_to_department_ids  jsonb NOT NULL DEFAULT '[]'::jsonb,
  applies_from_grade         text,
  weight                     integer NOT NULL DEFAULT 1,
  is_active                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX competencies_org_name_key ON hrms.competencies (org_id, name);
CREATE INDEX competencies_org_active_idx ON hrms.competencies (org_id, is_active);

CREATE TABLE hrms.competency_ratings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  review_id      uuid NOT NULL REFERENCES hrms.performance_reviews(id) ON DELETE CASCADE,
  competency_id  uuid NOT NULL REFERENCES hrms.competencies(id) ON DELETE CASCADE,
  rating         integer NOT NULL,
  weight         integer NOT NULL DEFAULT 1,
  comments       text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX competency_ratings_review_competency_key
  ON hrms.competency_ratings (review_id, competency_id);
CREATE INDEX competency_ratings_org_idx ON hrms.competency_ratings (org_id);

-- ─── 360° feedback ───────────────────────────────────────────
--
-- Requests and responses are separate tables on purpose. The request holds who
-- was asked, which the cycle needs in order to chase people. The response
-- holds what was said. Keeping them apart means the aggregation query never
-- touches a table containing a respondent's identity, so an accidental
-- SELECT * cannot leak it.

CREATE TABLE hrms.feedback_requests (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  cycle_id                 uuid NOT NULL REFERENCES hrms.review_cycles(id) ON DELETE CASCADE,
  subject_id               uuid NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
  respondent_id            uuid NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
  relationship             hrms.feedback_relationship NOT NULL,
  is_nominated_by_subject  boolean NOT NULL DEFAULT false,
  approved_by_id           uuid,
  due_on                   date,
  sent_at                  timestamptz,
  completed_at             timestamptz,
  declined_at              timestamptz,
  decline_reason           text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX feedback_requests_cycle_subject_respondent_key
  ON hrms.feedback_requests (cycle_id, subject_id, respondent_id);
CREATE INDEX feedback_requests_subject_idx ON hrms.feedback_requests (subject_id);
CREATE INDEX feedback_requests_respondent_idx
  ON hrms.feedback_requests (respondent_id, completed_at);

CREATE TABLE hrms.feedback_responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  request_id    uuid NOT NULL REFERENCES hrms.feedback_requests(id) ON DELETE CASCADE,
  subject_id    uuid NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
  relationship  hrms.feedback_relationship NOT NULL,
  ratings       jsonb NOT NULL DEFAULT '{}'::jsonb,
  strengths     text,
  improvements  text,
  comments      text,
  submitted_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX feedback_responses_request_key ON hrms.feedback_responses (request_id);
CREATE INDEX feedback_responses_subject_idx
  ON hrms.feedback_responses (subject_id, relationship);

-- ─── Calibration ─────────────────────────────────────────────

CREATE TABLE hrms.calibration_sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  cycle_id             uuid NOT NULL REFERENCES hrms.review_cycles(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  department_id        uuid REFERENCES hrms.departments(id) ON DELETE SET NULL,
  facilitator_id       uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  participant_ids      jsonb NOT NULL DEFAULT '[]'::jsonb,
  distribution_target  jsonb NOT NULL DEFAULT '[]'::jsonb,
  status               hrms.calibration_status NOT NULL DEFAULT 'scheduled',
  scheduled_for        timestamptz,
  completed_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX calibration_sessions_cycle_idx ON hrms.calibration_sessions (cycle_id, status);

CREATE TABLE hrms.calibration_adjustments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  session_id      uuid NOT NULL REFERENCES hrms.calibration_sessions(id) ON DELETE CASCADE,
  review_id       uuid NOT NULL REFERENCES hrms.performance_reviews(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
  rating_before   numeric(3, 1),
  rating_after    numeric(3, 1) NOT NULL,
  justification   text NOT NULL,
  adjusted_by_id  uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  adjusted_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX calibration_adjustments_session_idx ON hrms.calibration_adjustments (session_id);
CREATE INDEX calibration_adjustments_employee_idx ON hrms.calibration_adjustments (employee_id);

-- ─── Check-ins ───────────────────────────────────────────────

CREATE TABLE hrms.check_ins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
  manager_id      uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  held_on         date NOT NULL,
  employee_notes  text,
  manager_notes   text,
  private_notes   text,
  agreed_actions  jsonb NOT NULL DEFAULT '[]'::jsonb,
  mood_rating     integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX check_ins_employee_held_idx ON hrms.check_ins (employee_id, held_on);
