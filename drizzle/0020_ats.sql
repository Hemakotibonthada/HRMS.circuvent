-- ═══════════════════════════════════════════════════════════════
-- ATS — pipeline stages, scorecards, offers, source attribution
-- ═══════════════════════════════════════════════════════════════
-- Companions to hrms.job_postings, hrms.candidates, hrms.applications and
-- hrms.interviews, which already exist and are sound.

CREATE TYPE hrms.pipeline_stage_kind AS ENUM (
  'sourcing', 'screening', 'interview', 'assessment', 'offer', 'hired'
);

CREATE TYPE hrms.interview_recommendation AS ENUM (
  'strong_hire', 'hire', 'no_hire', 'strong_no_hire'
);

CREATE TYPE hrms.offer_status AS ENUM (
  'draft', 'pending_approval', 'approved', 'sent', 'accepted', 'declined', 'expired', 'withdrawn'
);

-- ─── Pipeline ────────────────────────────────────────────────

CREATE TABLE hrms.pipeline_stages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  job_id               uuid REFERENCES hrms.job_postings(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  sequence             integer NOT NULL,
  kind                 hrms.pipeline_stage_kind NOT NULL DEFAULT 'screening',
  required_scorecards  integer NOT NULL DEFAULT 0,
  auto_reject_below    integer,
  stale_after_days     integer,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- NULLS NOT DISTINCT so the org-wide default pipeline cannot have two stages
-- at the same position: without it, every job_id IS NULL row is treated as
-- unique and the ordering becomes arbitrary.
CREATE UNIQUE INDEX pipeline_stages_job_sequence_key
  ON hrms.pipeline_stages (org_id, job_id, sequence) NULLS NOT DISTINCT;
CREATE INDEX pipeline_stages_org_job_idx ON hrms.pipeline_stages (org_id, job_id);

CREATE TABLE hrms.application_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  application_id  uuid NOT NULL REFERENCES hrms.applications(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  from_stage_id   uuid,
  to_stage_id     uuid,
  actor_id        uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  reason          text,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX application_events_application_idx
  ON hrms.application_events (application_id, occurred_at);

-- ─── Scorecards ──────────────────────────────────────────────

CREATE TABLE hrms.interview_scorecards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  application_id  uuid NOT NULL REFERENCES hrms.applications(id) ON DELETE CASCADE,
  interview_id    uuid REFERENCES hrms.interviews(id) ON DELETE SET NULL,
  interviewer_id  uuid NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
  scores          jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation  hrms.interview_recommendation,
  strengths       text,
  concerns        text,
  notes           text,
  submitted_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX interview_scorecards_application_interviewer_key
  ON hrms.interview_scorecards (application_id, interviewer_id, interview_id)
  NULLS NOT DISTINCT;
CREATE INDEX interview_scorecards_application_idx
  ON hrms.interview_scorecards (application_id);

-- ─── Offers ──────────────────────────────────────────────────

CREATE TABLE hrms.offers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  application_id        uuid NOT NULL REFERENCES hrms.applications(id) ON DELETE CASCADE,
  candidate_id          uuid NOT NULL REFERENCES hrms.candidates(id) ON DELETE CASCADE,
  version               integer NOT NULL DEFAULT 1,
  supersedes_offer_id   uuid,
  designation           text NOT NULL,
  grade_code            text,
  annual_ctc_minor      bigint NOT NULL,
  joining_bonus_minor   bigint,
  equity_units          integer,
  currency              text NOT NULL DEFAULT 'INR',
  proposed_start_date   date,
  status                hrms.offer_status NOT NULL DEFAULT 'draft',
  expires_at            timestamptz,
  created_by_id         uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  approved_by_id        uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  approved_at           timestamptz,
  sent_at               timestamptz,
  responded_at          timestamptz,
  decline_reason        text,
  document_id           uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX offers_application_idx ON hrms.offers (application_id, version);
CREATE INDEX offers_org_status_idx ON hrms.offers (org_id, status);

ALTER TABLE hrms.offers
  ADD CONSTRAINT offers_supersedes_fk
  FOREIGN KEY (supersedes_offer_id) REFERENCES hrms.offers(id) ON DELETE SET NULL;

-- ─── Source attribution ──────────────────────────────────────

CREATE TABLE hrms.application_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  application_id  uuid NOT NULL REFERENCES hrms.applications(id) ON DELETE CASCADE,
  source          text NOT NULL,
  channel         text,
  campaign        text,
  referrer_id     uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  agency_name     text,
  is_primary      boolean NOT NULL DEFAULT true,
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX application_sources_application_idx
  ON hrms.application_sources (application_id);
CREATE INDEX application_sources_org_source_idx
  ON hrms.application_sources (org_id, source);
