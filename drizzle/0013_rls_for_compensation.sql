-- ═══════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY AND INTEGRITY FOR COMPENSATION TABLES
-- ═══════════════════════════════════════════════════════════════
-- The sweep from 0003. Every migration that adds an org-scoped table must call
-- it, or that table returns every tenant's rows to every caller.
--
-- Salary data is the most sensitive this system holds after health records. A
-- missing policy here would expose one company's entire payroll to another.

SELECT apply_tenant_rls();

-- ─── Band integrity ──────────────────────────────────────────

-- Compa-ratio divides by the midpoint. A zero or negative one produces
-- Infinity on a screen someone is about to have a difficult conversation in
-- front of.
ALTER TABLE hrms.salary_bands
  DROP CONSTRAINT IF EXISTS salary_bands_ordered;
ALTER TABLE hrms.salary_bands
  ADD CONSTRAINT salary_bands_ordered
    CHECK (min_minor >= 0 AND min_minor <= mid_minor AND mid_minor <= max_minor AND mid_minor > 0);

ALTER TABLE hrms.salary_bands
  DROP CONSTRAINT IF EXISTS salary_bands_date_order;
ALTER TABLE hrms.salary_bands
  ADD CONSTRAINT salary_bands_date_order
    CHECK (effective_until IS NULL OR effective_until >= effective_from);

-- ─── Cycle integrity ─────────────────────────────────────────

ALTER TABLE hrms.compensation_cycles
  DROP CONSTRAINT IF EXISTS compensation_cycles_period_order;
ALTER TABLE hrms.compensation_cycles
  ADD CONSTRAINT compensation_cycles_period_order CHECK (period_end >= period_start);

-- An applied cycle must record who approved it and when. A pay rise nobody
-- signed off is indefensible at audit.
ALTER TABLE hrms.compensation_cycles
  DROP CONSTRAINT IF EXISTS compensation_cycles_applied_has_approver;
ALTER TABLE hrms.compensation_cycles
  ADD CONSTRAINT compensation_cycles_applied_has_approver
    CHECK (applied_at IS NULL OR approved_by_id IS NOT NULL);

-- ─── Budget integrity ────────────────────────────────────────

ALTER TABLE hrms.budget_pools
  DROP CONSTRAINT IF EXISTS budget_pools_allocation_non_negative;
ALTER TABLE hrms.budget_pools
  ADD CONSTRAINT budget_pools_allocation_non_negative CHECK (allocated_minor >= 0);

-- The hard stop. The repository checks the budget inside a locked
-- transaction, but this is what makes an overspend impossible rather than
-- merely unlikely — including through any future code path that forgets to
-- check.
ALTER TABLE hrms.budget_pools
  DROP CONSTRAINT IF EXISTS budget_pools_within_allocation;
ALTER TABLE hrms.budget_pools
  ADD CONSTRAINT budget_pools_within_allocation
    CHECK (committed_minor >= 0 AND committed_minor <= allocated_minor);

-- ─── Recommendation integrity ────────────────────────────────

ALTER TABLE hrms.compensation_recommendations
  DROP CONSTRAINT IF EXISTS comp_recommendations_salary_positive;
ALTER TABLE hrms.compensation_recommendations
  ADD CONSTRAINT comp_recommendations_salary_positive CHECK (current_salary_minor > 0);

-- A merit cycle does not cut pay. A reduction is a separate, consented
-- process, and allowing it here would let a mistyped percentage do it silently.
ALTER TABLE hrms.compensation_recommendations
  DROP CONSTRAINT IF EXISTS comp_recommendations_increase_non_negative;
ALTER TABLE hrms.compensation_recommendations
  ADD CONSTRAINT comp_recommendations_increase_non_negative
    CHECK (
      (proposed_increase_minor IS NULL OR proposed_increase_minor >= 0)
      AND (final_increase_minor IS NULL OR final_increase_minor >= 0)
    );

ALTER TABLE hrms.compensation_recommendations
  DROP CONSTRAINT IF EXISTS comp_recommendations_quartile_range;
ALTER TABLE hrms.compensation_recommendations
  ADD CONSTRAINT comp_recommendations_quartile_range
    CHECK (quartile IS NULL OR quartile BETWEEN 1 AND 4);

-- A departure from the guideline needs a reason. At calibration somebody has
-- to defend why two similar people got different numbers, and an unexplained
-- override is what an equal-pay claim is built from.
ALTER TABLE hrms.compensation_recommendations
  DROP CONSTRAINT IF EXISTS comp_recommendations_override_has_reason;
ALTER TABLE hrms.compensation_recommendations
  ADD CONSTRAINT comp_recommendations_override_has_reason
    CHECK (
      proposed_percent IS NULL
      OR system_percent IS NULL
      OR proposed_percent = system_percent
      OR length(btrim(coalesce(override_reason, ''))) >= 5
    );

-- The same separation payroll, erasure and shift swaps use. A manager
-- approving their own proposals has no check on them at all.
ALTER TABLE hrms.compensation_recommendations
  DROP CONSTRAINT IF EXISTS comp_recommendations_separate_approver;
ALTER TABLE hrms.compensation_recommendations
  ADD CONSTRAINT comp_recommendations_separate_approver
    CHECK (
      approved_by_id IS NULL
      OR submitted_by_id IS NULL
      OR approved_by_id IS DISTINCT FROM submitted_by_id
    );

-- ─── Equity integrity ────────────────────────────────────────

ALTER TABLE hrms.equity_grants
  DROP CONSTRAINT IF EXISTS equity_grants_units_positive;
ALTER TABLE hrms.equity_grants
  ADD CONSTRAINT equity_grants_units_positive CHECK (total_units > 0);

-- Exercising more than was granted would create shares out of nothing.
ALTER TABLE hrms.equity_grants
  DROP CONSTRAINT IF EXISTS equity_grants_exercised_within_grant;
ALTER TABLE hrms.equity_grants
  ADD CONSTRAINT equity_grants_exercised_within_grant
    CHECK (
      exercised_units >= 0
      AND cancelled_units >= 0
      AND exercised_units + cancelled_units <= total_units
    );

ALTER TABLE hrms.equity_grants
  DROP CONSTRAINT IF EXISTS equity_grants_vesting_sane;
ALTER TABLE hrms.equity_grants
  ADD CONSTRAINT equity_grants_vesting_sane
    CHECK (
      vesting_months > 0
      AND cadence_months > 0
      AND cliff_months >= 0
      AND cliff_months <= vesting_months
    );

-- ─── Salary history immutability ─────────────────────────────
--
-- "What was this person paid in March?" is asked by payroll reconciliation, by
-- equal-pay analysis and by litigation. A history that can be rewritten
-- answers none of them.

CREATE OR REPLACE FUNCTION hrms.salary_history_is_append_only()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'hrms.salary_history is append-only; % is not permitted', TG_OP;
END
$$;

DROP TRIGGER IF EXISTS salary_history_no_update ON hrms.salary_history;
CREATE TRIGGER salary_history_no_update
  BEFORE UPDATE OR DELETE ON hrms.salary_history
  FOR EACH ROW EXECUTE FUNCTION hrms.salary_history_is_append_only();
