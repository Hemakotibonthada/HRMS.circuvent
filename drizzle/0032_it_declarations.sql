-- ═══════════════════════════════════════════════════════════════
-- IT declarations — Chapter VI-A claims and their evidence
-- ═══════════════════════════════════════════════════════════════
--
-- What an employee declares they will invest, so that TDS is deducted against
-- their likely liability rather than their gross pay. The tax screen held this
-- in browser state until now, which meant a declaration vanished on reload and
-- payroll never saw it at all.

CREATE TABLE IF NOT EXISTS "hrms"."it_declarations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "hrms"."employees"("id") ON DELETE CASCADE,
  "financial_year" integer NOT NULL,
  "regime" text DEFAULT 'new' NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "self_or_family_is_senior" boolean DEFAULT false NOT NULL,
  "parents_are_senior" boolean DEFAULT false NOT NULL,
  "rent_paid_minor" bigint DEFAULT 0 NOT NULL,
  "metro_city" boolean DEFAULT false NOT NULL,
  "landlord_pan" text,
  "submitted_at" timestamp with time zone,
  "proof_window_closed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hrms"."it_declaration_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "declaration_id" uuid NOT NULL REFERENCES "hrms"."it_declarations"("id") ON DELETE CASCADE,
  "section" text NOT NULL,
  "declared_minor" bigint DEFAULT 0 NOT NULL,
  "verified_minor" bigint,
  "proof_status" text DEFAULT 'awaiting' NOT NULL,
  "proof_document_id" uuid,
  "reviewed_by_id" uuid REFERENCES "hrms"."employees"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp with time zone,
  "review_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- One declaration per employee per year, and one claim per section within it.
-- Without these an employee who double-clicks Save claims 80C twice and the
-- shared ceiling is silently applied to a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS "it_declarations_employee_year_key"
  ON "hrms"."it_declarations" ("employee_id", "financial_year");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "it_declarations_org_year_idx"
  ON "hrms"."it_declarations" ("org_id", "financial_year");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "it_declaration_items_declaration_section_key"
  ON "hrms"."it_declaration_items" ("declaration_id", "section");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "it_declaration_items_org_idx"
  ON "hrms"."it_declaration_items" ("org_id");
--> statement-breakpoint

-- A declared amount is never negative. Postgres is the last place this can be
-- enforced for every writer, including a future import script.
ALTER TABLE "hrms"."it_declaration_items"
  DROP CONSTRAINT IF EXISTS "it_declaration_items_declared_non_negative";
--> statement-breakpoint
ALTER TABLE "hrms"."it_declaration_items"
  ADD CONSTRAINT "it_declaration_items_declared_non_negative"
  CHECK ("declared_minor" >= 0 AND ("verified_minor" IS NULL OR "verified_minor" >= 0));
--> statement-breakpoint

ALTER TABLE "hrms"."it_declarations"
  DROP CONSTRAINT IF EXISTS "it_declarations_regime_known";
--> statement-breakpoint
ALTER TABLE "hrms"."it_declarations"
  ADD CONSTRAINT "it_declarations_regime_known"
  CHECK ("regime" IN ('old', 'new'));
--> statement-breakpoint

-- ── Row-level security ───────────────────────────────────────
--
-- A declaration is the most sensitive thing in this schema after salary: it
-- lists what somebody owns, insures, borrows and donates to. Scoped like every
-- other tenant table, and forced so that even the table owner is subject to it.
ALTER TABLE "hrms"."it_declarations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hrms"."it_declarations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "hrms"."it_declarations";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hrms"."it_declarations"
  USING (app_is_superuser() OR "org_id" = app_current_org())
  WITH CHECK (app_is_superuser() OR "org_id" = app_current_org());
--> statement-breakpoint

ALTER TABLE "hrms"."it_declaration_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hrms"."it_declaration_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "hrms"."it_declaration_items";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hrms"."it_declaration_items"
  USING (app_is_superuser() OR "org_id" = app_current_org())
  WITH CHECK (app_is_superuser() OR "org_id" = app_current_org());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hrms"."it_declarations" TO hrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "hrms"."it_declaration_items" TO hrms_app;
