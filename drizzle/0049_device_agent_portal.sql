-- Device portal: one-time enroll tokens and per-device agent API keys.
-- Served at devices.circuvent.com; agents authenticate without browser sessions.

CREATE TABLE IF NOT EXISTS hrms.device_enroll_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL,
  employee_id     UUID,
  employee_email  TEXT NOT NULL,
  employee_code   TEXT,
  token_hash      TEXT NOT NULL UNIQUE,
  token_prefix    TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_enroll_tokens_prefix_idx
  ON hrms.device_enroll_tokens (token_prefix);

CREATE INDEX IF NOT EXISTS device_enroll_tokens_org_idx
  ON hrms.device_enroll_tokens (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hrms.device_agent_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL,
  device_id       UUID,
  device_hostname TEXT NOT NULL,
  key_hash        TEXT NOT NULL,
  key_prefix      TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS device_agent_keys_hostname_idx
  ON hrms.device_agent_keys (device_hostname);
