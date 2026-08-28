-- ═══════════════════════════════════════════════════════════════
-- ASSETS — depreciation, categories, custody history, maintenance
-- ═══════════════════════════════════════════════════════════════
-- The existing hrms.assets table is EXTENDED, not replaced. Unlike the
-- placeholder tickets and SSO tables dropped in 0010 and 0014, its columns
-- were sound and it may already hold rows. Only the TypeScript definition
-- moved, from hrms.ts to assets.ts; there is still exactly one.

CREATE TYPE hrms.asset_state AS ENUM (
  'in_stock', 'assigned', 'in_repair', 'lost', 'retired', 'disposed'
);

CREATE TYPE hrms.depreciation_method AS ENUM (
  'straight_line', 'declining_balance', 'double_declining', 'none'
);

-- ─── Categories ──────────────────────────────────────────────

CREATE TABLE hrms.asset_categories (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                     uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  name                       text NOT NULL,
  code                       text NOT NULL,
  default_useful_life_months integer NOT NULL DEFAULT 36,
  default_method             hrms.depreciation_method NOT NULL DEFAULT 'straight_line',
  default_salvage_percent    integer NOT NULL DEFAULT 0,
  max_per_employee           integer NOT NULL DEFAULT 0,
  service_interval_months    integer NOT NULL DEFAULT 0,
  requires_acceptance        boolean NOT NULL DEFAULT false,
  is_active                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX asset_categories_org_code_key ON hrms.asset_categories (org_id, code);
CREATE INDEX asset_categories_org_active_idx ON hrms.asset_categories (org_id, is_active);

-- ─── Assets ──────────────────────────────────────────────────

ALTER TABLE hrms.assets
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES hrms.asset_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS supplier text,
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS depreciation_method hrms.depreciation_method NOT NULL DEFAULT 'straight_line',
  ADD COLUMN IF NOT EXISTS useful_life_months integer NOT NULL DEFAULT 36,
  ADD COLUMN IF NOT EXISTS salvage_value_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS state hrms.asset_state NOT NULL DEFAULT 'in_stock',
  ADD COLUMN IF NOT EXISTS last_serviced_on date,
  ADD COLUMN IF NOT EXISTS disposed_on date,
  ADD COLUMN IF NOT EXISTS disposal_proceeds_minor bigint,
  ADD COLUMN IF NOT EXISTS disposal_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Existing rows carry a free-text `status`. Seeding `state` from it means the
-- new state machine starts from where the register actually is, rather than
-- resetting every assigned laptop to "in stock" and losing track of who has
-- what.
UPDATE hrms.assets
SET state = CASE
  WHEN assigned_to_id IS NOT NULL THEN 'assigned'::hrms.asset_state
  WHEN lower(status) IN ('repair', 'in_repair', 'maintenance') THEN 'in_repair'::hrms.asset_state
  WHEN lower(status) = 'lost' THEN 'lost'::hrms.asset_state
  WHEN lower(status) IN ('retired', 'written_off') THEN 'retired'::hrms.asset_state
  WHEN lower(status) = 'disposed' THEN 'disposed'::hrms.asset_state
  ELSE 'in_stock'::hrms.asset_state
END;

CREATE INDEX IF NOT EXISTS assets_org_state_idx ON hrms.assets (org_id, state);

-- ─── Custody history ─────────────────────────────────────────

CREATE TABLE hrms.asset_assignments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  asset_id                  uuid NOT NULL REFERENCES hrms.assets(id) ON DELETE CASCADE,
  employee_id               uuid NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
  issued_at                 timestamptz NOT NULL DEFAULT now(),
  issued_by_id              uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  returned_at               timestamptz,
  returned_to_id            uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  condition_on_issue        text NOT NULL DEFAULT 'good',
  condition_on_return       text,
  book_value_on_issue_minor bigint,
  accepted_at               timestamptz,
  acceptance_document_id    uuid,
  notes                     text
);

CREATE INDEX asset_assignments_asset_idx ON hrms.asset_assignments (asset_id, issued_at);
CREATE INDEX asset_assignments_employee_idx ON hrms.asset_assignments (employee_id);

-- Backfills a custody row for anything currently issued, so the history does
-- not begin with a gap for every laptop already in someone's hands.
INSERT INTO hrms.asset_assignments (org_id, asset_id, employee_id, issued_at)
SELECT org_id, id, assigned_to_id, COALESCE(assigned_at, now())
FROM hrms.assets
WHERE assigned_to_id IS NOT NULL;

-- ─── Maintenance ─────────────────────────────────────────────

CREATE TABLE hrms.asset_maintenance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  asset_id        uuid NOT NULL REFERENCES hrms.assets(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'repair',
  reported_at     timestamptz NOT NULL DEFAULT now(),
  reported_by_id  uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  description     text NOT NULL,
  vendor          text,
  under_warranty  boolean NOT NULL DEFAULT false,
  cost_minor      bigint,
  completed_at    timestamptz,
  outcome         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX asset_maintenance_asset_idx ON hrms.asset_maintenance (asset_id, reported_at);

-- ─── Event log ───────────────────────────────────────────────

CREATE TABLE hrms.asset_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  asset_id     uuid NOT NULL REFERENCES hrms.assets(id) ON DELETE CASCADE,
  action       text NOT NULL,
  from_state   text,
  to_state     text,
  employee_id  uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  actor_id     uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  detail       text,
  metadata     jsonb,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX asset_events_asset_idx ON hrms.asset_events (asset_id, occurred_at);
