-- ═══════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY AND INTEGRITY FOR FEDERATION TABLES
-- ═══════════════════════════════════════════════════════════════
-- The sweep from 0003. Every migration that adds an org-scoped table must call
-- it, or that table returns every tenant's rows to every caller.
--
-- It matters more than usual here: sso_connections holds client secrets and
-- scim_tokens holds credentials that can create and disable accounts. A
-- missing policy on either would let one tenant read another's ability to
-- authenticate.

SELECT apply_tenant_rls();

-- ─── SSO connection integrity ────────────────────────────────

-- An authorization code or token travelling over plaintext HTTP is readable
-- by anything on the path. localhost is exempted so a developer can run a
-- local provider.
ALTER TABLE identity.sso_connections
  DROP CONSTRAINT IF EXISTS sso_connections_https_endpoints;
ALTER TABLE identity.sso_connections
  ADD CONSTRAINT sso_connections_https_endpoints
    CHECK (
      (authorization_endpoint LIKE 'https://%' OR authorization_endpoint LIKE 'http://localhost%')
      AND (token_endpoint LIKE 'https://%' OR token_endpoint LIKE 'http://localhost%')
      AND (jwks_uri LIKE 'https://%' OR jwks_uri LIKE 'http://localhost%')
    );

-- A connection routing no domains can never be selected, so it is a
-- configuration someone believes is working and is not.
ALTER TABLE identity.sso_connections
  DROP CONSTRAINT IF EXISTS sso_connections_has_domains;
ALTER TABLE identity.sso_connections
  ADD CONSTRAINT sso_connections_has_domains
    CHECK (
      is_active = false
      OR (jsonb_typeof(domains) = 'array' AND jsonb_array_length(domains) > 0)
    );

-- ─── Auth state integrity ────────────────────────────────────

-- A sign-in attempt that never expires is a replayable credential. Ten
-- minutes is generous for a redirect the user is already in the middle of.
ALTER TABLE identity.sso_auth_states
  DROP CONSTRAINT IF EXISTS sso_auth_states_short_lived;
ALTER TABLE identity.sso_auth_states
  ADD CONSTRAINT sso_auth_states_short_lived
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes');

-- ─── SCIM token integrity ────────────────────────────────────

-- Only the hash is stored. A token long enough to be a plausible plaintext
-- secret in this column means something wrote the secret itself.
ALTER TABLE identity.scim_tokens
  DROP CONSTRAINT IF EXISTS scim_tokens_hash_shape;
ALTER TABLE identity.scim_tokens
  ADD CONSTRAINT scim_tokens_hash_shape CHECK (token_hash ~ '^[0-9a-f]{64}$');

-- ─── SCIM log immutability ───────────────────────────────────
--
-- The record of what the directory told us to do and when. After an incident
-- the question is always "when were we told to disable this account?", and a
-- log that can be edited does not answer it.

CREATE OR REPLACE FUNCTION identity.scim_sync_log_is_append_only()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'identity.scim_sync_log is append-only; % is not permitted', TG_OP;
END
$$;

DROP TRIGGER IF EXISTS scim_sync_log_no_update ON identity.scim_sync_log;
CREATE TRIGGER scim_sync_log_no_update
  BEFORE UPDATE OR DELETE ON identity.scim_sync_log
  FOR EACH ROW EXECUTE FUNCTION identity.scim_sync_log_is_append_only();
