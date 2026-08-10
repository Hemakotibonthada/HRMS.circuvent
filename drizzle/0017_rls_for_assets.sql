-- ═══════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY AND INTEGRITY FOR ASSET TABLES
-- ═══════════════════════════════════════════════════════════════
-- The sweep from 0003. Every migration that adds an org-scoped table must call
-- it, or that table returns every tenant's rows to every caller.

SELECT apply_tenant_rls();

-- ─── Depreciation integrity ──────────────────────────────────

-- Salvage above cost produces a negative depreciable amount and an asset that
-- appreciates on the balance sheet.
ALTER TABLE hrms.assets
  DROP CONSTRAINT IF EXISTS assets_salvage_within_cost;
ALTER TABLE hrms.assets
  ADD CONSTRAINT assets_salvage_within_cost
    CHECK (
      salvage_value_minor >= 0
      AND (purchase_cost_minor IS NULL OR salvage_value_minor <= purchase_cost_minor)
    );

-- A zero useful life would divide by zero in every straight-line calculation.
ALTER TABLE hrms.assets
  DROP CONSTRAINT IF EXISTS assets_useful_life_positive;
ALTER TABLE hrms.assets
  ADD CONSTRAINT assets_useful_life_positive
    CHECK (depreciation_method = 'none' OR useful_life_months > 0);

ALTER TABLE hrms.assets
  DROP CONSTRAINT IF EXISTS assets_cost_non_negative;
ALTER TABLE hrms.assets
  ADD CONSTRAINT assets_cost_non_negative
    CHECK (purchase_cost_minor IS NULL OR purchase_cost_minor >= 0);

-- ─── Lifecycle integrity ─────────────────────────────────────

-- The invariant the whole register rests on: assigned means there is a holder,
-- and any other state means there is not. Without it an asset can be marked
-- lost while still counting against someone's exit clearance, or appear
-- unassigned while sitting on somebody's desk.
ALTER TABLE hrms.assets
  DROP CONSTRAINT IF EXISTS assets_assignment_matches_state;
ALTER TABLE hrms.assets
  ADD CONSTRAINT assets_assignment_matches_state
    CHECK ((state = 'assigned') = (assigned_to_id IS NOT NULL));

-- A disposed asset must record when it went.
ALTER TABLE hrms.assets
  DROP CONSTRAINT IF EXISTS assets_disposed_has_date;
ALTER TABLE hrms.assets
  ADD CONSTRAINT assets_disposed_has_date
    CHECK (state <> 'disposed' OR disposed_on IS NOT NULL);

-- ─── Custody integrity ───────────────────────────────────────

ALTER TABLE hrms.asset_assignments
  DROP CONSTRAINT IF EXISTS asset_assignments_time_order;
ALTER TABLE hrms.asset_assignments
  ADD CONSTRAINT asset_assignments_time_order
    CHECK (returned_at IS NULL OR returned_at >= issued_at);

-- One asset cannot be in two people's hands. This is what makes the register
-- true rather than merely plausible.
DROP INDEX IF EXISTS hrms.asset_assignments_one_open;
CREATE UNIQUE INDEX asset_assignments_one_open
  ON hrms.asset_assignments (asset_id)
  WHERE returned_at IS NULL;

-- ─── Category integrity ──────────────────────────────────────

ALTER TABLE hrms.asset_categories
  DROP CONSTRAINT IF EXISTS asset_categories_salvage_percent_range;
ALTER TABLE hrms.asset_categories
  ADD CONSTRAINT asset_categories_salvage_percent_range
    CHECK (default_salvage_percent BETWEEN 0 AND 100);

ALTER TABLE hrms.asset_categories
  DROP CONSTRAINT IF EXISTS asset_categories_limits_non_negative;
ALTER TABLE hrms.asset_categories
  ADD CONSTRAINT asset_categories_limits_non_negative
    CHECK (max_per_employee >= 0 AND service_interval_months >= 0);

-- ─── Event log immutability ──────────────────────────────────
--
-- An asset register is an inventory of things that walk out of buildings. The
-- history of who moved what is the only defence against a dispute about it,
-- and an editable history is no defence at all.

CREATE OR REPLACE FUNCTION hrms.asset_events_is_append_only()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'hrms.asset_events is append-only; % is not permitted', TG_OP;
END
$$;

DROP TRIGGER IF EXISTS asset_events_no_update ON hrms.asset_events;
CREATE TRIGGER asset_events_no_update
  BEFORE UPDATE OR DELETE ON hrms.asset_events
  FOR EACH ROW EXECUTE FUNCTION hrms.asset_events_is_append_only();
