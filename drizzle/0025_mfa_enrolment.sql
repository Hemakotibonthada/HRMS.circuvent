-- ═══════════════════════════════════════════════════════════════
-- MFA ENROLMENT
-- ═══════════════════════════════════════════════════════════════
-- MFA was unreachable. The sign-in path could verify a TOTP code, consume a
-- backup code and lock out on repeated failure, and the mobile clients already
-- sent `totpCode` — but nothing could ever set `identity.users.mfa_secret`,
-- because no enrolment route existed. A feature the code calls "a baseline
-- requirement" for enterprise buyers could not be turned on.
--
-- Enrolment needs two states, because a secret must be proved before it is
-- enforced. Handing someone a QR code and immediately demanding a code from it
-- locks out anyone whose camera failed, whose clock is skewed, or who simply
-- closed the tab — and the recovery path for "locked out of MFA" is an
-- administrator disabling it out of band, which is itself an attack path.
--
--   mfa_secret set, mfa_enabled_at NULL  → pending; not enforced at sign-in
--   mfa_secret set, mfa_enabled_at set   → active; enforced
--
-- Both columns already exist. What was missing is that the sign-in view did
-- not expose `mfa_enabled_at`, so the login path had no way to tell a pending
-- enrolment from an active one and keyed off `mfa_secret` alone — which would
-- have enforced MFA the instant enrolment began.
--
-- Appended last rather than placed next to `mfa_secret`, because
-- CREATE OR REPLACE VIEW may only add columns at the end — inserting one
-- renames the columns after it and Postgres rejects that. The sign-in query
-- selects by name, so position carries no meaning here.

CREATE OR REPLACE VIEW identity.login_lookup
WITH (security_barrier = true) AS
  SELECT id, org_id, email, password_hash, status, mfa_secret,
         failed_login_attempts, locked_until, must_reset_password, display_name,
         mfa_enabled_at
  FROM identity.users
  WHERE deleted_at IS NULL;

GRANT SELECT ON identity.login_lookup TO hrms_app;
