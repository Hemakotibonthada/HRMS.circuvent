-- ═══════════════════════════════════════════════════════════════
-- FEDERATION — SSO connections and SCIM provisioning
-- ═══════════════════════════════════════════════════════════════
-- Written by hand rather than generated: drizzle-kit cannot tell whether the
-- placeholder sso_connections and scim_tokens tables are being renamed or
-- replaced, and prompts for a decision. They are being replaced.
--
-- Both placeholders were created in 0000 and never read by anything — no
-- repository, no route, no test. Dropping them rather than leaving them beside
-- the real tables is the same call made for the custom_fields jsonb columns in
-- 0007: two homes for one concept is how a value ends up written to one and
-- read from the other.

DROP TABLE IF EXISTS identity.sso_connections CASCADE;
DROP TABLE IF EXISTS identity.scim_tokens CASCADE;

-- The enum is recreated because the new one orders its values differently and
-- nothing depends on the old ordering.
DROP TYPE IF EXISTS identity.sso_protocol CASCADE;
CREATE TYPE identity.sso_protocol AS ENUM ('oidc', 'saml');

-- ─── SSO ─────────────────────────────────────────────────────

CREATE TABLE identity.sso_connections (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  name                    text NOT NULL,
  protocol                identity.sso_protocol NOT NULL DEFAULT 'oidc',
  domains                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  issuer                  text NOT NULL,
  client_id               text NOT NULL,
  client_secret           text NOT NULL,
  authorization_endpoint  text NOT NULL,
  token_endpoint          text NOT NULL,
  jwks_uri                text NOT NULL,
  scopes                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  claim_mapping           jsonb NOT NULL DEFAULT '{}'::jsonb,
  group_role_map          jsonb NOT NULL DEFAULT '{}'::jsonb,
  allow_jit_provisioning  boolean NOT NULL DEFAULT false,
  default_role            text NOT NULL DEFAULT 'employee',
  enforce_for_domains     boolean NOT NULL DEFAULT false,
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sso_connections_org_active_idx ON identity.sso_connections (org_id, is_active);

CREATE TABLE identity.sso_auth_states (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  connection_id  uuid NOT NULL REFERENCES identity.sso_connections(id) ON DELETE CASCADE,
  state          text NOT NULL,
  nonce          text NOT NULL,
  code_verifier  text NOT NULL,
  redirect_uri   text NOT NULL,
  return_to      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz
);

CREATE UNIQUE INDEX sso_auth_states_state_key ON identity.sso_auth_states (state);
CREATE INDEX sso_auth_states_expiry_idx ON identity.sso_auth_states (expires_at);

CREATE TABLE identity.sso_identities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  connection_id   uuid NOT NULL REFERENCES identity.sso_connections(id) ON DELETE CASCADE,
  subject         text NOT NULL,
  email_at_link   text NOT NULL,
  last_sign_in_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The provider's subject is the stable identifier, so it is what must be
-- unique. Keying on email instead would break the moment a directory renames
-- someone, which is the ordinary case this exists to survive.
CREATE UNIQUE INDEX sso_identities_connection_subject_key
  ON identity.sso_identities (connection_id, subject);
CREATE INDEX sso_identities_user_idx ON identity.sso_identities (user_id);

-- ─── SCIM ────────────────────────────────────────────────────

CREATE TABLE identity.scim_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  name          text NOT NULL,
  token_hash    text NOT NULL,
  token_prefix  text NOT NULL,
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_by_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX scim_tokens_hash_key ON identity.scim_tokens (token_hash);
CREATE INDEX scim_tokens_org_idx ON identity.scim_tokens (org_id);

CREATE TABLE identity.scim_sync_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  token_id      uuid REFERENCES identity.scim_tokens(id) ON DELETE SET NULL,
  operation     text NOT NULL,
  resource_type text NOT NULL DEFAULT 'User',
  external_id   text,
  user_id       uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  payload       jsonb,
  status_code   integer NOT NULL,
  error_detail  text,
  received_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scim_sync_log_org_received_idx ON identity.scim_sync_log (org_id, received_at);
CREATE INDEX scim_sync_log_external_idx ON identity.scim_sync_log (org_id, external_id);

-- ─── Users ───────────────────────────────────────────────────

-- The directory's stable identifier. Kept separate from the email because a
-- directory can change someone's address, and matching on email would then
-- create a second account rather than updating the first.
ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS users_org_external_id_key
  ON identity.users (org_id, external_id)
  WHERE external_id IS NOT NULL;
