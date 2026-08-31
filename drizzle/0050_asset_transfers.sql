-- Employee-to-employee asset handover with recipient acknowledgment.
-- Consumed by assets.circuvent.com (POST /api/assets/[id]/transfer).

CREATE TABLE IF NOT EXISTS hrms.asset_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES hrms.assets(id) ON DELETE CASCADE,
  from_employee_id uuid NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
  to_employee_id uuid NOT NULL REFERENCES hrms.employees(id) ON DELETE CASCADE,
  initiated_by_id uuid REFERENCES hrms.employees(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending_acknowledgment',
  condition_on_transfer text NOT NULL DEFAULT 'good',
  notes text,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_id uuid REFERENCES hrms.employees(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS asset_transfers_org_status_idx
  ON hrms.asset_transfers (org_id, status);

CREATE INDEX IF NOT EXISTS asset_transfers_to_employee_idx
  ON hrms.asset_transfers (to_employee_id, status);

CREATE INDEX IF NOT EXISTS asset_transfers_from_employee_idx
  ON hrms.asset_transfers (from_employee_id, status);

CREATE INDEX IF NOT EXISTS asset_transfers_asset_idx
  ON hrms.asset_transfers (asset_id);

CREATE UNIQUE INDEX IF NOT EXISTS asset_transfers_pending_asset_key
  ON hrms.asset_transfers (asset_id)
  WHERE status = 'pending_acknowledgment';

SELECT apply_tenant_rls();
