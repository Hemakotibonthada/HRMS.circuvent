-- ═══════════════════════════════════════════════════════════════
-- HELPDESK — tickets, SLA policies, escalation, knowledge base
-- ═══════════════════════════════════════════════════════════════
-- Hand-written for the same reason as 0012: drizzle-kit needs an interactive
-- terminal to resolve rename-versus-replace and has none here. Drift between
-- this and the TypeScript schema is caught by the check in
-- scripts/verify-migrations.ts.

-- The placeholder hrms.tickets from 0000 is replaced, not kept alongside. It
-- had no repository, no route reading it and no test — the fourth instance of
-- the same pattern in this codebase, after the custom_fields jsonb columns and
-- the placeholder SSO tables. A second home for one concept is how a row is
-- written to one and read from the other.
DROP TABLE IF EXISTS hrms.tickets CASCADE;

CREATE TYPE hrms.ticket_priority AS ENUM ('urgent', 'high', 'normal', 'low');

CREATE TYPE hrms.ticket_state AS ENUM (
  'new', 'open', 'pending_requester', 'pending_third_party', 'resolved', 'closed'
);

-- ─── SLA policies ────────────────────────────────────────────

CREATE TABLE hrms.sla_policies (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  name                        text NOT NULL,
  response_minutes            jsonb NOT NULL DEFAULT '{"urgent":60,"high":240,"normal":480,"low":1440}'::jsonb,
  resolution_minutes          jsonb NOT NULL DEFAULT '{"urgent":240,"high":1440,"normal":2880,"low":5760}'::jsonb,
  round_the_clock_priorities  jsonb NOT NULL DEFAULT '["urgent"]'::jsonb,
  business_hours              jsonb NOT NULL,
  escalations                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default                  boolean NOT NULL DEFAULT false,
  is_active                   boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sla_policies_org_active_idx ON hrms.sla_policies (org_id, is_active);

CREATE TABLE hrms.ticket_categories (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  name                    text NOT NULL,
  parent_id               uuid,
  sla_policy_id           uuid REFERENCES hrms.sla_policies(id) ON DELETE SET NULL,
  assigned_team_id        uuid REFERENCES hrms.departments(id) ON DELETE SET NULL,
  is_confidential         boolean NOT NULL DEFAULT false,
  confidential_to_roles   jsonb NOT NULL DEFAULT '["hr","owner"]'::jsonb,
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ticket_categories_org_name_key ON hrms.ticket_categories (org_id, name);
CREATE INDEX ticket_categories_org_active_idx ON hrms.ticket_categories (org_id, is_active);

ALTER TABLE hrms.ticket_categories
  ADD CONSTRAINT ticket_categories_parent_fk
  FOREIGN KEY (parent_id) REFERENCES hrms.ticket_categories(id) ON DELETE SET NULL;

-- ─── Tickets ─────────────────────────────────────────────────

CREATE TABLE hrms.tickets (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  reference              text NOT NULL,
  subject                text NOT NULL,
  body                   text NOT NULL,
  requester_id           uuid NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
  raised_by_id           uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  assignee_id            uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  team_id                uuid REFERENCES hrms.departments(id) ON DELETE SET NULL,
  category_id            uuid REFERENCES hrms.ticket_categories(id) ON DELETE SET NULL,
  sla_policy_id          uuid REFERENCES hrms.sla_policies(id) ON DELETE SET NULL,
  priority               hrms.ticket_priority NOT NULL DEFAULT 'normal',
  state                  hrms.ticket_state NOT NULL DEFAULT 'new',
  is_confidential        boolean NOT NULL DEFAULT false,
  tags                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_responded_at     timestamptz,
  resolved_at            timestamptz,
  closed_at              timestamptz,
  reopened_count         integer NOT NULL DEFAULT 0,
  response_due_at        timestamptz,
  resolution_due_at      timestamptz,
  response_breached      boolean NOT NULL DEFAULT false,
  resolution_breached    boolean NOT NULL DEFAULT false,
  fired_escalations      jsonb NOT NULL DEFAULT '[]'::jsonb,
  satisfaction_rating    integer,
  satisfaction_comment   text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tickets_org_reference_key ON hrms.tickets (org_id, reference);
CREATE INDEX tickets_org_state_idx ON hrms.tickets (org_id, state);
CREATE INDEX tickets_assignee_idx ON hrms.tickets (assignee_id, state);
CREATE INDEX tickets_requester_idx ON hrms.tickets (requester_id);
CREATE INDEX tickets_due_idx ON hrms.tickets (org_id, resolution_due_at);

CREATE TABLE hrms.ticket_pauses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  ticket_id    uuid NOT NULL REFERENCES hrms.tickets(id) ON DELETE CASCADE,
  paused_at    timestamptz NOT NULL,
  resumed_at   timestamptz,
  reason       text NOT NULL DEFAULT 'pending_requester'
);

CREATE INDEX ticket_pauses_ticket_idx ON hrms.ticket_pauses (ticket_id);

CREATE TABLE hrms.ticket_comments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  ticket_id     uuid NOT NULL REFERENCES hrms.tickets(id) ON DELETE CASCADE,
  author_id     uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  body          text NOT NULL,
  is_internal   boolean NOT NULL DEFAULT false,
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ticket_comments_ticket_idx ON hrms.ticket_comments (ticket_id, created_at);

CREATE TABLE hrms.ticket_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  ticket_id    uuid NOT NULL REFERENCES hrms.tickets(id) ON DELETE CASCADE,
  event_type   text NOT NULL,
  from_value   text,
  to_value     text,
  actor_id     uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  detail       text,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ticket_events_ticket_idx ON hrms.ticket_events (ticket_id, occurred_at);

-- ─── Knowledge base ──────────────────────────────────────────

CREATE TABLE hrms.knowledge_articles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  title             text NOT NULL,
  slug              text NOT NULL,
  body              text NOT NULL,
  summary           text,
  category_id       uuid REFERENCES hrms.ticket_categories(id) ON DELETE SET NULL,
  keywords          jsonb NOT NULL DEFAULT '[]'::jsonb,
  visible_to_roles  jsonb NOT NULL DEFAULT '[]'::jsonb,
  view_count        integer NOT NULL DEFAULT 0,
  deflection_count  integer NOT NULL DEFAULT 0,
  helpful_count     integer NOT NULL DEFAULT 0,
  unhelpful_count   integer NOT NULL DEFAULT 0,
  author_id         uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  is_published      boolean NOT NULL DEFAULT false,
  review_on         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX knowledge_articles_org_slug_key ON hrms.knowledge_articles (org_id, slug);
CREATE INDEX knowledge_articles_org_published_idx ON hrms.knowledge_articles (org_id, is_published);
