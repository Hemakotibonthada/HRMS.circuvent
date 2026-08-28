-- ═══════════════════════════════════════════════════════════════
-- Template management: origin tracking + version history
-- ═══════════════════════════════════════════════════════════════
--
-- HR can now edit letter/document templates from a dashboard page instead of
-- asking a developer to change catalog.ts. Two problems come with that, and
-- this migration is entirely about them:
--
-- 1. A catalog template that gets edited into uselessness at 5pm on a Friday
--    must be recoverable. `origin` says whether a human has ever touched a
--    template ("seed" vs "custom"); it flips once and never flips back, even
--    on a revert, because a revert is itself a human decision, not a reason
--    to pretend the row was never opened.
--
-- 2. Offer letters and relieving letters are contracts. `document_template_
--    versions` keeps every saved body with who changed it and when, so
--    "who changed this legal document's wording, and what did it used to
--    say" always has an answer, and reverting is possible without reading it
--    off a screenshot someone happened to keep.
--
-- Both are additive: existing rows default to origin='seed' and gain no
-- version history until the first edit under the new UI creates one. Nothing
-- here touches `generated_documents.rendered_body`, which is what a signed
-- document is actually made of — that stays frozen at generation time
-- regardless of what happens to the template afterwards.
--
-- Comments stay outside the parenthesised column lists: the migration runner
-- (scripts/verify-migrations.ts) splits this file on statement-breakpoint,
-- and a comment inside a CREATE TABLE's column list would still parse fine
-- standalone, but keeping the convention from 0023/0038 avoids relearning
-- this the hard way a third time.

ALTER TABLE "hrms"."document_templates"
  ADD COLUMN IF NOT EXISTS "origin" text NOT NULL DEFAULT 'seed';
--> statement-breakpoint

ALTER TABLE "hrms"."document_templates"
  ADD COLUMN IF NOT EXISTS "updated_by_id" uuid REFERENCES "identity"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE "hrms"."document_templates"
  ADD COLUMN IF NOT EXISTS "updated_by_email" text;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hrms"."document_template_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "template_id" uuid NOT NULL REFERENCES "hrms"."document_templates"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "body" text NOT NULL,
  "required_tokens" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "requires_signature" boolean DEFAULT false NOT NULL,
  "signatory_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "change_note" text,
  "changed_by_id" uuid REFERENCES "identity"."users"("id") ON DELETE SET NULL,
  "changed_by_email" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- The invariant "restore version 3" depends on: one row per (template,
-- version), forever, so a version number is never ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS "document_template_versions_template_version_key"
  ON "hrms"."document_template_versions" ("template_id", "version");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "document_template_versions_org_idx"
  ON "hrms"."document_template_versions" ("org_id", "template_id");
--> statement-breakpoint

ALTER TABLE "hrms"."document_template_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hrms"."document_template_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "hrms"."document_template_versions";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hrms"."document_template_versions"
  USING (app_is_superuser() OR "org_id" = app_current_org())
  WITH CHECK (app_is_superuser() OR "org_id" = app_current_org());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE
  ON "hrms"."document_template_versions" TO hrms_app;
