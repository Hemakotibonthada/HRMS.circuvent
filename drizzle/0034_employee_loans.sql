-- ═══════════════════════════════════════════════════════════════
-- Employee loans, their recovery, and the benchmark rate
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "hrms"."employee_loans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "hrms"."employees"("id") ON DELETE CASCADE,
  "loan_type" text NOT NULL,
  "principal_minor" bigint NOT NULL,
  "interest_rate_percent" numeric(6, 3) DEFAULT '0' NOT NULL,
  "tenure_months" integer NOT NULL,
  "first_recovery_month" integer NOT NULL,
  "first_recovery_year" integer NOT NULL,
  "purpose" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "approved_by_id" uuid REFERENCES "hrms"."employees"("id") ON DELETE SET NULL,
  "approved_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hrms"."loan_repayments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "loan_id" uuid NOT NULL REFERENCES "hrms"."employee_loans"("id") ON DELETE CASCADE,
  "period_month" integer NOT NULL,
  "period_year" integer NOT NULL,
  "amount_minor" bigint NOT NULL,
  "source" text DEFAULT 'payroll' NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hrms"."loan_benchmark_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "identity"."organizations"("id") ON DELETE CASCADE,
  "financial_year" integer NOT NULL,
  "loan_type" text NOT NULL,
  "rate_percent" numeric(6, 3) NOT NULL,
  "source" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "employee_loans_employee_idx"
  ON "hrms"."employee_loans" ("employee_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employee_loans_org_status_idx"
  ON "hrms"."employee_loans" ("org_id", "status");
--> statement-breakpoint

-- One recovery per loan per month. Payroll running twice for a month must not
-- take the instalment twice, and this is the last place that can be stopped.
CREATE UNIQUE INDEX IF NOT EXISTS "loan_repayments_loan_period_key"
  ON "hrms"."loan_repayments" ("loan_id", "period_year", "period_month");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loan_repayments_org_idx"
  ON "hrms"."loan_repayments" ("org_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loan_benchmark_rates_org_year_type_key"
  ON "hrms"."loan_benchmark_rates" ("org_id", "financial_year", "loan_type");
--> statement-breakpoint

ALTER TABLE "hrms"."employee_loans"
  DROP CONSTRAINT IF EXISTS "employee_loans_sane";
--> statement-breakpoint
ALTER TABLE "hrms"."employee_loans"
  ADD CONSTRAINT "employee_loans_sane"
  CHECK (
    "principal_minor" > 0
    AND "tenure_months" > 0
    AND "interest_rate_percent" >= 0
    AND "first_recovery_month" BETWEEN 1 AND 12
  );
--> statement-breakpoint

ALTER TABLE "hrms"."employee_loans"
  DROP CONSTRAINT IF EXISTS "employee_loans_status_known";
--> statement-breakpoint
ALTER TABLE "hrms"."employee_loans"
  ADD CONSTRAINT "employee_loans_status_known"
  CHECK ("status" IN ('pending', 'active', 'closed', 'rejected', 'written_off'));
--> statement-breakpoint

-- Approving your own advance is the same hole as approving your own overtime,
-- and it pays out immediately.
ALTER TABLE "hrms"."employee_loans"
  DROP CONSTRAINT IF EXISTS "employee_loans_no_self_approval";
--> statement-breakpoint
ALTER TABLE "hrms"."employee_loans"
  ADD CONSTRAINT "employee_loans_no_self_approval"
  CHECK ("approved_by_id" IS NULL OR "approved_by_id" <> "employee_id");
--> statement-breakpoint

-- A recovery is never negative. A refund is a separate act with its own record.
ALTER TABLE "hrms"."loan_repayments"
  DROP CONSTRAINT IF EXISTS "loan_repayments_positive";
--> statement-breakpoint
ALTER TABLE "hrms"."loan_repayments"
  ADD CONSTRAINT "loan_repayments_positive"
  CHECK ("amount_minor" > 0 AND "period_month" BETWEEN 1 AND 12);
--> statement-breakpoint

ALTER TABLE "hrms"."loan_benchmark_rates"
  DROP CONSTRAINT IF EXISTS "loan_benchmark_rates_positive";
--> statement-breakpoint
ALTER TABLE "hrms"."loan_benchmark_rates"
  ADD CONSTRAINT "loan_benchmark_rates_positive"
  CHECK ("rate_percent" >= 0);
--> statement-breakpoint

ALTER TABLE "hrms"."employee_loans" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hrms"."employee_loans" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "hrms"."employee_loans";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hrms"."employee_loans"
  USING (app_is_superuser() OR "org_id" = app_current_org())
  WITH CHECK (app_is_superuser() OR "org_id" = app_current_org());
--> statement-breakpoint

ALTER TABLE "hrms"."loan_repayments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hrms"."loan_repayments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "hrms"."loan_repayments";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hrms"."loan_repayments"
  USING (app_is_superuser() OR "org_id" = app_current_org())
  WITH CHECK (app_is_superuser() OR "org_id" = app_current_org());
--> statement-breakpoint

ALTER TABLE "hrms"."loan_benchmark_rates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hrms"."loan_benchmark_rates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "hrms"."loan_benchmark_rates";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hrms"."loan_benchmark_rates"
  USING (app_is_superuser() OR "org_id" = app_current_org())
  WITH CHECK (app_is_superuser() OR "org_id" = app_current_org());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "hrms"."employee_loans" TO hrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "hrms"."loan_repayments" TO hrms_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "hrms"."loan_benchmark_rates" TO hrms_app;
