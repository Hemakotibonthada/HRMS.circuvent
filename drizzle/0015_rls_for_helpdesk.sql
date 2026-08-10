-- ═══════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY AND INTEGRITY FOR HELPDESK TABLES
-- ═══════════════════════════════════════════════════════════════
-- The sweep from 0003. Every migration that adds an org-scoped table must call
-- it, or that table returns every tenant's rows to every caller.

SELECT apply_tenant_rls();

-- ─── SLA policy integrity ────────────────────────────────────

-- A policy with no business hours would make every clock run against nothing.
ALTER TABLE hrms.sla_policies
  DROP CONSTRAINT IF EXISTS sla_policies_hours_shape;
ALTER TABLE hrms.sla_policies
  ADD CONSTRAINT sla_policies_hours_shape
    CHECK (
      jsonb_typeof(business_hours) = 'object'
      AND business_hours ? 'timezone'
      AND business_hours ? 'days'
    );

-- Exactly one default, or ticket creation picks arbitrarily between them and
-- two identical tickets get different targets.
DROP INDEX IF EXISTS hrms.sla_policies_one_default;
CREATE UNIQUE INDEX sla_policies_one_default
  ON hrms.sla_policies (org_id)
  WHERE is_default AND is_active;

-- ─── Ticket integrity ────────────────────────────────────────

-- A resolution stamp without a resolved state, or the reverse, makes every
-- resolution-time report wrong.
ALTER TABLE hrms.tickets
  DROP CONSTRAINT IF EXISTS tickets_resolved_state_consistent;
ALTER TABLE hrms.tickets
  ADD CONSTRAINT tickets_resolved_state_consistent
    CHECK (
      (state IN ('resolved', 'closed')) = (resolved_at IS NOT NULL)
      OR state = 'closed'
    );

-- A closed ticket must record when it closed.
ALTER TABLE hrms.tickets
  DROP CONSTRAINT IF EXISTS tickets_closed_has_timestamp;
ALTER TABLE hrms.tickets
  ADD CONSTRAINT tickets_closed_has_timestamp
    CHECK (state <> 'closed' OR closed_at IS NOT NULL);

-- Satisfaction is a five-point scale. A zero or a six would break every
-- average silently.
ALTER TABLE hrms.tickets
  DROP CONSTRAINT IF EXISTS tickets_rating_range;
ALTER TABLE hrms.tickets
  ADD CONSTRAINT tickets_rating_range
    CHECK (satisfaction_rating IS NULL OR satisfaction_rating BETWEEN 1 AND 5);

-- Nobody is assigned their own grievance. The repository does not enforce this
-- because assignment is usually legitimate; the case it blocks is a
-- confidential ticket being routed back to the person who raised it.
ALTER TABLE hrms.tickets
  DROP CONSTRAINT IF EXISTS tickets_confidential_not_self_assigned;
ALTER TABLE hrms.tickets
  ADD CONSTRAINT tickets_confidential_not_self_assigned
    CHECK (
      is_confidential = false
      OR assignee_id IS NULL
      OR assignee_id IS DISTINCT FROM requester_id
    );

ALTER TABLE hrms.tickets
  DROP CONSTRAINT IF EXISTS tickets_reopened_non_negative;
ALTER TABLE hrms.tickets
  ADD CONSTRAINT tickets_reopened_non_negative CHECK (reopened_count >= 0);

-- ─── Pause integrity ─────────────────────────────────────────

ALTER TABLE hrms.ticket_pauses
  DROP CONSTRAINT IF EXISTS ticket_pauses_time_order;
ALTER TABLE hrms.ticket_pauses
  ADD CONSTRAINT ticket_pauses_time_order
    CHECK (resumed_at IS NULL OR resumed_at >= paused_at);

-- Two open pauses on one ticket would double-count the stopped time and make
-- the SLA clock run backwards relative to the calendar.
DROP INDEX IF EXISTS hrms.ticket_pauses_one_open;
CREATE UNIQUE INDEX ticket_pauses_one_open
  ON hrms.ticket_pauses (ticket_id)
  WHERE resumed_at IS NULL;

-- ─── Event log immutability ──────────────────────────────────
--
-- A grievance investigation reads this to establish who knew what and when. An
-- editable history is not evidence of anything.

CREATE OR REPLACE FUNCTION hrms.ticket_events_is_append_only()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'hrms.ticket_events is append-only; % is not permitted', TG_OP;
END
$$;

DROP TRIGGER IF EXISTS ticket_events_no_update ON hrms.ticket_events;
CREATE TRIGGER ticket_events_no_update
  BEFORE UPDATE OR DELETE ON hrms.ticket_events
  FOR EACH ROW EXECUTE FUNCTION hrms.ticket_events_is_append_only();
