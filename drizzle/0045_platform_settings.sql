-- ═══════════════════════════════════════════════════════════════
-- 0045  Platform settings
-- ═══════════════════════════════════════════════════════════════
--
-- Configuration that belongs to the deployment rather than to a tenant.
--
-- Razorpay credentials are the first occupant and they explain the shape.
-- They are *Circuvent's* merchant keys, used to charge every customer — not
-- something each tenant supplies — so they cannot live on `organizations`
-- alongside per-company settings like letter defaults. Putting them there
-- would mean either duplicating one secret across every tenant row or picking
-- an arbitrary tenant to be the real one.
--
-- Deliberately not row-level-security'd by org, because it has no org. Access
-- is controlled in the repository: only an owner or administrator of the
-- platform organisation may read or write it, and secret values are encrypted
-- with the same field encryption the rest of the schema uses, so a database
-- dump does not hand over the ability to take payments.

CREATE TABLE IF NOT EXISTS identity.platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid NULL REFERENCES identity.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE identity.platform_settings IS
  'Deployment-wide configuration. Not tenant data: one row per setting key for the whole installation. Secret fields inside `value` are encrypted at the application layer.';

COMMENT ON COLUMN identity.platform_settings.value IS
  'The setting document. Any field holding a secret is stored as an `enc.v1.` envelope, never as plaintext.';

-- The application connects as `hrms_app`, which owns nothing and cannot create
-- anything. Without these grants the table exists and is unreachable, which is
-- a worse failure than not creating it — the code would compile, deploy, and
-- 500 on first read.
--
-- No DELETE: a setting is cleared by writing an empty document, and a
-- deployment that can drop its own payment configuration by accident is one
-- support call away from taking no money and nobody knowing why.
GRANT SELECT, INSERT, UPDATE ON identity.platform_settings TO hrms_app;
