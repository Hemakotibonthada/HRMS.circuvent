-- ═══════════════════════════════════════════════════════════════
-- Outbound integrations
-- ═══════════════════════════════════════════════════════════════
-- The settings screen listed Google Workspace, Slack, Razorpay, Jira and
-- GitHub as connected, with sync times, and none of it was real: there was no
-- table, no endpoint and no code. An administrator reading it would reasonably
-- have believed SSO was live and that payroll was wired to a payment provider.
--
-- This is the storage behind the honest version. It covers the one class of
-- integration that genuinely works without a registered OAuth application:
-- an outbound webhook to a URL the customer already owns. Slack, Teams and
-- most chat tools accept exactly this. Anything needing a client ID and secret
-- stays absent from the UI rather than being drawn as a button that cannot work.
--
-- The endpoint is attacker-influenced input in the SSRF sense even though only
-- an administrator can set it: the server is what makes the request, so it can
-- be aimed at the cloud metadata service or at something private that is only
-- reachable from inside. The check constraint here stops the obvious shapes at
-- the last possible moment; src/lib/integrations/endpoint.ts resolves and
-- rejects the rest before anything is sent.

CREATE TABLE IF NOT EXISTS "hrms"."integrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,

  -- What kind of endpoint this is. Deliberately narrow: every value here is
  -- something that can be delivered to with nothing but a URL.
  "kind" text NOT NULL,
  "display_name" text NOT NULL,
  "endpoint_url" text NOT NULL,

  -- Optional signing secret, encrypted at rest by src/lib/crypto/field-encryption.
  -- Never returned by the API.
  "secret_encrypted" text,

  -- Which events to deliver. Empty means every event this app emits.
  "events" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_enabled" boolean DEFAULT true NOT NULL,

  -- Delivery outcome, so the screen can report what actually happened instead
  -- of inventing "last sync: 2 min ago".
  "last_delivery_at" timestamp with time zone,
  "last_status" text,
  "last_error" text,

  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "integrations_org_idx"
  ON "hrms"."integrations" ("org_id", "is_enabled");
--> statement-breakpoint

-- Two integrations with the same name are indistinguishable in a list, and the
-- one an administrator disables is then a coin toss.
CREATE UNIQUE INDEX IF NOT EXISTS "integrations_org_name_key"
  ON "hrms"."integrations" ("org_id", lower("display_name"));
--> statement-breakpoint

ALTER TABLE "hrms"."integrations"
  DROP CONSTRAINT IF EXISTS "integrations_kind_known";
--> statement-breakpoint
ALTER TABLE "hrms"."integrations"
  ADD CONSTRAINT "integrations_kind_known"
  CHECK ("kind" IN ('slack_webhook', 'teams_webhook', 'generic_webhook'));
--> statement-breakpoint

ALTER TABLE "hrms"."integrations"
  DROP CONSTRAINT IF EXISTS "integrations_last_status_known";
--> statement-breakpoint
ALTER TABLE "hrms"."integrations"
  ADD CONSTRAINT "integrations_last_status_known"
  CHECK ("last_status" IS NULL OR "last_status" IN ('ok', 'failed'));
--> statement-breakpoint

-- https only, and never a bare host. A plain-http webhook carries the signing
-- secret and the payload across the network in clear, and both are worth
-- reading. The remaining SSRF shapes — private ranges, link-local, DNS names
-- that resolve to them — cannot be decided in SQL and are rejected in the
-- application before any request is made.
ALTER TABLE "hrms"."integrations"
  DROP CONSTRAINT IF EXISTS "integrations_endpoint_https";
--> statement-breakpoint
ALTER TABLE "hrms"."integrations"
  ADD CONSTRAINT "integrations_endpoint_https"
  CHECK (
    "endpoint_url" ~ '^https://[A-Za-z0-9]'
    AND "endpoint_url" !~* '^https://(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)'
    AND length("endpoint_url") BETWEEN 12 AND 2048
  );
--> statement-breakpoint

ALTER TABLE "hrms"."integrations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hrms"."integrations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "hrms"."integrations";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hrms"."integrations"
  USING (app_is_superuser() OR "org_id" = app_current_org())
  WITH CHECK (app_is_superuser() OR "org_id" = app_current_org());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hrms"."integrations" TO hrms_app;
