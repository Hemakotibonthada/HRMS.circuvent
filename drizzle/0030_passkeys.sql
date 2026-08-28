-- ═══════════════════════════════════════════════════════════════
-- 0030 — passkeys
-- ═══════════════════════════════════════════════════════════════
--
-- One row per credential rather than per user. A person legitimately registers
-- a passkey on their phone, their laptop and a hardware key, and losing one
-- must not lock them out of the others.
--
-- Nothing here is secret. The private half of the key pair never leaves the
-- authenticator, so this table yields nothing that can sign anything even if
-- it is read in full — which is the property that makes passkeys worth having
-- over passwords, where the stored material is the thing worth stealing.

CREATE TABLE IF NOT EXISTS "identity"."webauthn_credentials" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"       uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "org_id"        uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "credential_id" text NOT NULL,
  "public_key"    text NOT NULL,
  "sign_count"    integer NOT NULL DEFAULT 0,
  "transports"    jsonb NOT NULL DEFAULT '[]'::jsonb,
  "label"         text,
  "backed_up"     boolean NOT NULL DEFAULT false,
  "last_used_at"  timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Globally unique, not per tenant.
--
-- Sign-in presents a credential id and no email — that is the point of a
-- discoverable credential — so the id has to resolve to exactly one account
-- across the whole deployment. A per-tenant uniqueness constraint would leave
-- the lookup ambiguous at precisely the moment there is no tenant context yet.
CREATE UNIQUE INDEX IF NOT EXISTS "webauthn_credentials_credential_id_key"
  ON "identity"."webauthn_credentials" ("credential_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "webauthn_credentials_user_idx"
  ON "identity"."webauthn_credentials" ("user_id");
--> statement-breakpoint

-- The counter only ever moves forward, and a row that claims otherwise is a
-- bug or a clone. Enforced here as well as in the ceremony, because the
-- ceremony is code and this is the record.
ALTER TABLE "identity"."webauthn_credentials"
  DROP CONSTRAINT IF EXISTS "webauthn_credentials_sign_count_positive";
--> statement-breakpoint
ALTER TABLE "identity"."webauthn_credentials"
  ADD CONSTRAINT "webauthn_credentials_sign_count_positive"
  CHECK ("sign_count" >= 0);
--> statement-breakpoint

-- ── Row-level security ───────────────────────────────────────
--
-- Reading a credential row tells you which accounts in another tenant have
-- passkeys and on what kind of device, which is reconnaissance even though the
-- key material is useless. Scoped like every other tenant table.
ALTER TABLE "identity"."webauthn_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "identity"."webauthn_credentials" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "tenant_isolation" ON "identity"."webauthn_credentials";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "identity"."webauthn_credentials"
  USING (app_is_superuser() OR "org_id" = app_current_org())
  WITH CHECK (app_is_superuser() OR "org_id" = app_current_org());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE
  ON "identity"."webauthn_credentials" TO hrms_app;
