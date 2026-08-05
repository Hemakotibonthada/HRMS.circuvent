-- ═══════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY AND INTEGRITY FOR SCHEDULING TABLES
-- ═══════════════════════════════════════════════════════════════
-- The sweep from 0003. Every migration that adds an org-scoped table must call
-- it, or that table returns every tenant's rows to every caller.

SELECT apply_tenant_rls();

-- ─── Shift pattern integrity ─────────────────────────────────

-- A break longer than the shift would compute as negative worked time, which
-- flows into pay.
ALTER TABLE hrms.shift_patterns
  DROP CONSTRAINT IF EXISTS shift_patterns_break_non_negative;
ALTER TABLE hrms.shift_patterns
  ADD CONSTRAINT shift_patterns_break_non_negative CHECK (break_minutes >= 0);

-- Below 1.0 would cut pay for working an unsociable shift, which is the
-- opposite of what a shift premium is for.
ALTER TABLE hrms.shift_patterns
  DROP CONSTRAINT IF EXISTS shift_patterns_multiplier_range;
ALTER TABLE hrms.shift_patterns
  ADD CONSTRAINT shift_patterns_multiplier_range
    CHECK (pay_multiplier >= 1 AND pay_multiplier <= 5);

ALTER TABLE hrms.shift_patterns
  DROP CONSTRAINT IF EXISTS shift_patterns_allowance_non_negative;
ALTER TABLE hrms.shift_patterns
  ADD CONSTRAINT shift_patterns_allowance_non_negative CHECK (allowance_minor >= 0);

-- Weekdays must be a JSON array of ISO day numbers. A malformed value would
-- silently exclude the pattern from every generated roster.
--
-- Containment rather than a subquery: CHECK constraints cannot contain
-- subqueries, and `<@` asserts every element is one of 1-7 in one scalar
-- expression.
ALTER TABLE hrms.shift_patterns
  DROP CONSTRAINT IF EXISTS shift_patterns_weekdays_valid;
ALTER TABLE hrms.shift_patterns
  ADD CONSTRAINT shift_patterns_weekdays_valid
    CHECK (
      jsonb_typeof(weekdays) = 'array'
      AND jsonb_array_length(weekdays) > 0
      AND weekdays <@ '[1,2,3,4,5,6,7]'::jsonb
    );

-- ─── Eligibility integrity ───────────────────────────────────

ALTER TABLE hrms.shift_eligibility
  DROP CONSTRAINT IF EXISTS shift_eligibility_date_order;
ALTER TABLE hrms.shift_eligibility
  ADD CONSTRAINT shift_eligibility_date_order
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from);

-- ─── Availability integrity ──────────────────────────────────

ALTER TABLE hrms.availability
  DROP CONSTRAINT IF EXISTS availability_date_order;
ALTER TABLE hrms.availability
  ADD CONSTRAINT availability_date_order CHECK (end_date >= start_date);

-- Partial-day availability needs both ends or neither; one alone is
-- uninterpretable.
ALTER TABLE hrms.availability
  DROP CONSTRAINT IF EXISTS availability_times_paired;
ALTER TABLE hrms.availability
  ADD CONSTRAINT availability_times_paired
    CHECK ((start_time IS NULL) = (end_time IS NULL));

-- ─── Roster integrity ────────────────────────────────────────

ALTER TABLE hrms.rosters
  DROP CONSTRAINT IF EXISTS rosters_period_order;
ALTER TABLE hrms.rosters
  ADD CONSTRAINT rosters_period_order CHECK (period_end >= period_start);

-- A published roster must record who published it and when. Without that the
-- roster cannot be defended if it is ever questioned.
ALTER TABLE hrms.rosters
  DROP CONSTRAINT IF EXISTS rosters_published_has_publisher;
ALTER TABLE hrms.rosters
  ADD CONSTRAINT rosters_published_has_publisher
    CHECK (
      status <> 'published'
      OR (published_by_id IS NOT NULL AND published_at IS NOT NULL)
    );

-- ─── Assignment integrity ────────────────────────────────────

ALTER TABLE hrms.roster_assignments
  DROP CONSTRAINT IF EXISTS roster_assignments_time_order;
ALTER TABLE hrms.roster_assignments
  ADD CONSTRAINT roster_assignments_time_order CHECK (ends_at > starts_at);

-- A shift longer than 24 hours is a data error, not a roster. Catching it here
-- stops it reaching the weekly-hours calculation and payroll.
ALTER TABLE hrms.roster_assignments
  DROP CONSTRAINT IF EXISTS roster_assignments_duration_sane;
ALTER TABLE hrms.roster_assignments
  ADD CONSTRAINT roster_assignments_duration_sane
    CHECK (duration_minutes > 0 AND duration_minutes <= 1440);

-- One live shift per person per pattern per day. Cancelled and swapped-out
-- rows are excluded so the history of a swap is retained — the partial index
-- is what makes a swap possible at all.
DROP INDEX IF EXISTS hrms.roster_assignments_one_live_per_day;
CREATE UNIQUE INDEX roster_assignments_one_live_per_day
  ON hrms.roster_assignments (employee_id, shift_date, pattern_id)
  WHERE status NOT IN ('cancelled', 'swapped_out');

ALTER TABLE hrms.roster_assignments
  DROP CONSTRAINT IF EXISTS roster_assignments_replaces_fk;
ALTER TABLE hrms.roster_assignments
  ADD CONSTRAINT roster_assignments_replaces_fk
    FOREIGN KEY (replaces_assignment_id)
    REFERENCES hrms.roster_assignments(id) ON DELETE SET NULL;

-- ─── Swap integrity ──────────────────────────────────────────

-- Nobody hands a shift to themselves.
ALTER TABLE hrms.shift_swap_requests
  DROP CONSTRAINT IF EXISTS shift_swaps_not_self;
ALTER TABLE hrms.shift_swap_requests
  ADD CONSTRAINT shift_swaps_not_self
    CHECK (target_employee_id IS NULL OR target_employee_id IS DISTINCT FROM requested_by_id);

ALTER TABLE hrms.shift_swap_requests
  DROP CONSTRAINT IF EXISTS shift_swaps_accepter_not_self;
ALTER TABLE hrms.shift_swap_requests
  ADD CONSTRAINT shift_swaps_accepter_not_self
    CHECK (accepted_by_id IS NULL OR accepted_by_id IS DISTINCT FROM requested_by_id);

-- Approving your own swap defeats the point of approval.
ALTER TABLE hrms.shift_swap_requests
  DROP CONSTRAINT IF EXISTS shift_swaps_separate_approver;
ALTER TABLE hrms.shift_swap_requests
  ADD CONSTRAINT shift_swaps_separate_approver
    CHECK (
      approved_by_id IS NULL
      OR (
        approved_by_id IS DISTINCT FROM requested_by_id
        AND approved_by_id IS DISTINCT FROM accepted_by_id
      )
    );

-- An approved swap must name who took the shift, or the roster records an
-- approval that changed nothing.
ALTER TABLE hrms.shift_swap_requests
  DROP CONSTRAINT IF EXISTS shift_swaps_approved_has_accepter;
ALTER TABLE hrms.shift_swap_requests
  ADD CONSTRAINT shift_swaps_approved_has_accepter
    CHECK (status <> 'approved' OR accepted_by_id IS NOT NULL);

-- Only one live swap per shift. Two colleagues both being told the shift is
-- theirs is the failure this prevents.
DROP INDEX IF EXISTS hrms.shift_swaps_one_open_per_assignment;
CREATE UNIQUE INDEX shift_swaps_one_open_per_assignment
  ON hrms.shift_swap_requests (assignment_id)
  WHERE status IN ('open', 'accepted', 'pending_approval');

-- ─── Coverage integrity ──────────────────────────────────────

ALTER TABLE hrms.coverage_requirements
  DROP CONSTRAINT IF EXISTS coverage_requirements_headcount_positive;
ALTER TABLE hrms.coverage_requirements
  ADD CONSTRAINT coverage_requirements_headcount_positive CHECK (headcount > 0);

ALTER TABLE hrms.coverage_requirements
  DROP CONSTRAINT IF EXISTS coverage_requirements_weekday_range;
ALTER TABLE hrms.coverage_requirements
  ADD CONSTRAINT coverage_requirements_weekday_range
    CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7);

ALTER TABLE hrms.coverage_requirements
  DROP CONSTRAINT IF EXISTS coverage_requirements_date_order;
ALTER TABLE hrms.coverage_requirements
  ADD CONSTRAINT coverage_requirements_date_order
    CHECK (effective_until IS NULL OR effective_until >= effective_from);

ALTER TABLE hrms.open_shifts
  DROP CONSTRAINT IF EXISTS open_shifts_headcount_positive;
ALTER TABLE hrms.open_shifts
  ADD CONSTRAINT open_shifts_headcount_positive CHECK (headcount_needed > 0);

-- ─── Employment terms ────────────────────────────────────────

-- Zero contracted hours would divide by zero in the fairness sort; more than
-- 168 is more hours than a week contains.
ALTER TABLE hrms.employees
  DROP CONSTRAINT IF EXISTS employees_contracted_hours_range;
ALTER TABLE hrms.employees
  ADD CONSTRAINT employees_contracted_hours_range
    CHECK (contracted_hours_per_week > 0 AND contracted_hours_per_week <= 168);
