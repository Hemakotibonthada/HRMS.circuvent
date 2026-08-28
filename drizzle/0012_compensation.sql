-- ═══════════════════════════════════════════════════════════════
-- COMPENSATION — bands, cycles, budgets, recommendations, equity
-- ═══════════════════════════════════════════════════════════════
-- Hand-written, like 0005, 0007, 0009, 0010 and 0011. drizzle-kit cannot
-- diff against those without an interactive prompt it has no terminal for, and
-- a half-generated migration is worse than a written one.
--
-- The drift this risks — the TypeScript schema saying one thing and the
-- migrations another — is checked by scripts/verify-migrations.ts, which
-- compares every table and column Drizzle declares against what the migrations
-- actually create.

CREATE TYPE hrms.comp_cycle_status AS ENUM (
  'planning', 'manager_input', 'calibration', 'approval', 'approved', 'applied', 'cancelled'
);

CREATE TYPE hrms.comp_recommendation_status AS ENUM (
  'draft', 'submitted', 'calibrated', 'approved', 'rejected', 'applied'
);

-- ─── Bands ───────────────────────────────────────────────────

CREATE TABLE hrms.salary_bands (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  grade_code        text NOT NULL,
  name              text NOT NULL,
  location_id       uuid REFERENCES hrms.locations(id) ON DELETE CASCADE,
  job_family        text,
  min_minor         bigint NOT NULL,
  mid_minor         bigint NOT NULL,
  max_minor         bigint NOT NULL,
  currency          text NOT NULL DEFAULT 'INR',
  benchmark_source  text,
  effective_from    date NOT NULL,
  effective_until   date,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX salary_bands_org_grade_location_key
  ON hrms.salary_bands (org_id, grade_code, location_id);
CREATE INDEX salary_bands_org_active_idx ON hrms.salary_bands (org_id, is_active);

-- ─── Cycles ──────────────────────────────────────────────────

CREATE TABLE hrms.compensation_cycles (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  name                      text NOT NULL,
  status                    hrms.comp_cycle_status NOT NULL DEFAULT 'planning',
  period_start              date NOT NULL,
  period_end                date NOT NULL,
  effective_on              date NOT NULL,
  minimum_tenure_months     integer NOT NULL DEFAULT 0,
  prorate_new_joiners       boolean NOT NULL DEFAULT true,
  merit_matrix              jsonb NOT NULL DEFAULT '{}'::jsonb,
  manager_input_closes_on   date,
  approved_by_id            uuid,
  approved_at               timestamptz,
  applied_at                timestamptz,
  created_by_id             uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX compensation_cycles_org_status_idx ON hrms.compensation_cycles (org_id, status);

CREATE TABLE hrms.budget_pools (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  cycle_id         uuid NOT NULL REFERENCES hrms.compensation_cycles(id) ON DELETE CASCADE,
  name             text NOT NULL,
  department_id    uuid REFERENCES hrms.departments(id) ON DELETE CASCADE,
  purpose          text NOT NULL DEFAULT 'merit',
  allocated_minor  bigint NOT NULL,
  committed_minor  bigint NOT NULL DEFAULT 0,
  currency         text NOT NULL DEFAULT 'INR',
  owner_id         uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX budget_pools_cycle_idx ON hrms.budget_pools (cycle_id);
CREATE UNIQUE INDEX budget_pools_cycle_dept_purpose_key
  ON hrms.budget_pools (cycle_id, department_id, purpose);

CREATE TABLE hrms.compensation_recommendations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  cycle_id                  uuid NOT NULL REFERENCES hrms.compensation_cycles(id) ON DELETE CASCADE,
  employee_id               uuid NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
  pool_id                   uuid REFERENCES hrms.budget_pools(id) ON DELETE SET NULL,
  current_salary_minor      bigint NOT NULL,
  band_id                   uuid REFERENCES hrms.salary_bands(id) ON DELETE SET NULL,
  compa_ratio               numeric(6, 4),
  quartile                  integer,
  rating                    text,
  system_percent            numeric(6, 2),
  system_increase_minor     bigint,
  proposed_percent          numeric(6, 2),
  proposed_increase_minor   bigint,
  override_reason           text,
  final_percent             numeric(6, 2),
  final_increase_minor      bigint,
  new_salary_minor          bigint,
  promotion_to_grade_code   text,
  warnings                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  rationale                 text,
  status                    hrms.comp_recommendation_status NOT NULL DEFAULT 'draft',
  submitted_by_id           uuid,
  submitted_at              timestamptz,
  approved_by_id            uuid,
  approved_at               timestamptz,
  rejection_reason          text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX comp_recommendations_cycle_employee_key
  ON hrms.compensation_recommendations (cycle_id, employee_id);
CREATE INDEX comp_recommendations_cycle_status_idx
  ON hrms.compensation_recommendations (cycle_id, status);
CREATE INDEX comp_recommendations_pool_idx ON hrms.compensation_recommendations (pool_id);

-- ─── Equity ──────────────────────────────────────────────────

CREATE TABLE hrms.equity_grants (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  employee_id            uuid NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
  grant_number           text NOT NULL,
  instrument             text NOT NULL DEFAULT 'option',
  total_units            integer NOT NULL,
  strike_price_minor     bigint,
  currency               text NOT NULL DEFAULT 'INR',
  grant_date             date NOT NULL,
  cliff_months           integer NOT NULL DEFAULT 12,
  vesting_months         integer NOT NULL DEFAULT 48,
  cadence_months         integer NOT NULL DEFAULT 1,
  termination_date       date,
  exercised_units        integer NOT NULL DEFAULT 0,
  cancelled_units        integer NOT NULL DEFAULT 0,
  board_approval_date    date,
  agreement_document_id  uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX equity_grants_org_number_key ON hrms.equity_grants (org_id, grant_number);
CREATE INDEX equity_grants_employee_idx ON hrms.equity_grants (employee_id);

-- ─── Salary history ──────────────────────────────────────────

CREATE TABLE hrms.salary_history (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  employee_id             uuid NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
  previous_salary_minor   bigint,
  new_salary_minor        bigint NOT NULL,
  change_percent          numeric(6, 2),
  currency                text NOT NULL DEFAULT 'INR',
  reason                  text NOT NULL,
  cycle_id                uuid REFERENCES hrms.compensation_cycles(id) ON DELETE SET NULL,
  recommendation_id       uuid REFERENCES hrms.compensation_recommendations(id) ON DELETE SET NULL,
  effective_on            date NOT NULL,
  approved_by_id          uuid,
  recorded_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX salary_history_employee_effective_idx
  ON hrms.salary_history (employee_id, effective_on);
CREATE INDEX salary_history_org_cycle_idx ON hrms.salary_history (org_id, cycle_id);
