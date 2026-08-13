-- ═══════════════════════════════════════════════════════════════
-- REFERRAL INVITES
-- ═══════════════════════════════════════════════════════════════
-- The emailed link that lets a referred candidate fill in their own details.
--
-- This is the only unauthenticated write path into a tenant's data in the
-- whole schema. The person holding the link has no account, has agreed to
-- nothing, and cannot be asked to prove who they are — the entire point is
-- that they are outside the company. So the token carries all of the
-- authority, and the constraints below carry all of the doubt.

CREATE TABLE IF NOT EXISTS hrms.referral_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES identity.organizations(id) ON DELETE CASCADE,
  referral_id   uuid NOT NULL REFERENCES hrms.referrals(id) ON DELETE CASCADE,

  -- The SHA-256 of the emailed token, never the token. A dump of this table
  -- is not a set of working links.
  token_hash    text NOT NULL,

  sent_to_email text NOT NULL,
  sent_at       timestamptz,
  delivery_error text,

  expires_at    timestamptz NOT NULL,
  submitted_at  timestamptz,
  revoked_at    timestamptz,
  revoked_reason text,

  submission    jsonb,
  consent_given_at timestamptz,
  submitted_from_ip text,

  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Every public request looks the row up by this. Unique because two
-- candidates sharing a link would let either overwrite the other.
CREATE UNIQUE INDEX IF NOT EXISTS referral_invites_token_key
  ON hrms.referral_invites (token_hash);

CREATE INDEX IF NOT EXISTS referral_invites_referral_idx
  ON hrms.referral_invites (referral_id);

CREATE INDEX IF NOT EXISTS referral_invites_org_expiry_idx
  ON hrms.referral_invites (org_id, expires_at);

-- ── What the token may not do ────────────────────────────────

-- Only ever a SHA-256 hex digest. If application code ever writes the raw
-- token here by mistake, this rejects it rather than quietly storing a live
-- credential in plaintext.
ALTER TABLE hrms.referral_invites
  DROP CONSTRAINT IF EXISTS referral_invites_token_is_hashed;
ALTER TABLE hrms.referral_invites
  ADD CONSTRAINT referral_invites_token_is_hashed
  CHECK (token_hash ~ '^[0-9a-f]{64}$');

-- An invite with no expiry is a permanent unauthenticated endpoint that
-- nobody remembers exists. The upper bound stops a caller passing a year that
-- amounts to the same thing.
ALTER TABLE hrms.referral_invites
  DROP CONSTRAINT IF EXISTS referral_invites_expiry_bounded;
ALTER TABLE hrms.referral_invites
  ADD CONSTRAINT referral_invites_expiry_bounded
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '90 days');

-- A submission is the record of what an outsider told us about themselves.
-- Storing it without the consent that made it lawful is the failure mode this
-- exists to prevent, and it is far easier to enforce here than to audit later.
ALTER TABLE hrms.referral_invites
  DROP CONSTRAINT IF EXISTS referral_invites_submission_needs_consent;
ALTER TABLE hrms.referral_invites
  ADD CONSTRAINT referral_invites_submission_needs_consent
  CHECK (
    submitted_at IS NULL
    OR (consent_given_at IS NOT NULL AND submission IS NOT NULL)
  );

-- Readers iterate the submission as an object.
ALTER TABLE hrms.referral_invites
  DROP CONSTRAINT IF EXISTS referral_invites_submission_shape;
ALTER TABLE hrms.referral_invites
  ADD CONSTRAINT referral_invites_submission_shape
  CHECK (submission IS NULL OR jsonb_typeof(submission) = 'object');

-- A revocation has to say why. "No longer active" with no reason recorded is
-- unanswerable when the candidate asks what happened.
ALTER TABLE hrms.referral_invites
  DROP CONSTRAINT IF EXISTS referral_invites_revocation_has_reason;
ALTER TABLE hrms.referral_invites
  ADD CONSTRAINT referral_invites_revocation_has_reason
  CHECK (revoked_at IS NULL OR length(coalesce(revoked_reason, '')) >= 3);

-- ── One live invite per referral ─────────────────────────────
-- Two usable links for the same referral means the second submission silently
-- replaces the first, and the candidate cannot tell which one the company
-- read. Resending revokes the old one first.
CREATE UNIQUE INDEX IF NOT EXISTS referral_invites_one_live_per_referral
  ON hrms.referral_invites (referral_id)
  WHERE submitted_at IS NULL AND revoked_at IS NULL;

-- ── Append-only after submission ─────────────────────────────
-- Once a candidate has sent their details, that record is evidence of what
-- they themselves asserted. A recruiter may edit the referral and the ATS
-- candidate freely; they may not rewrite this.
CREATE OR REPLACE FUNCTION hrms.referral_invite_submission_is_final()
RETURNS trigger AS $$
BEGIN
  IF OLD.submitted_at IS NOT NULL THEN
    IF NEW.submission IS DISTINCT FROM OLD.submission
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.consent_given_at IS DISTINCT FROM OLD.consent_given_at THEN
      RAISE EXCEPTION 'A submitted referral invite cannot be rewritten';
    END IF;
  END IF;

  -- The token cannot be swapped for another under an existing row, which
  -- would move a live link onto a different referral.
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash THEN
    RAISE EXCEPTION 'A referral invite token cannot be changed';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS referral_invite_submission_is_final ON hrms.referral_invites;
CREATE TRIGGER referral_invite_submission_is_final
  BEFORE UPDATE ON hrms.referral_invites
  FOR EACH ROW EXECUTE FUNCTION hrms.referral_invite_submission_is_final();

SELECT apply_tenant_rls();
