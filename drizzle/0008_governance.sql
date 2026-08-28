CREATE TYPE "hrms"."data_request_status" AS ENUM('received', 'identity_pending', 'in_progress', 'awaiting_approval', 'completed', 'partially_completed', 'refused');--> statement-breakpoint
CREATE TYPE "hrms"."data_request_type" AS ENUM('access', 'erasure', 'rectification', 'portability', 'restriction', 'objection');--> statement-breakpoint
CREATE TYPE "hrms"."erasure_method" AS ENUM('delete', 'anonymise', 'pseudonymise', 'retain');--> statement-breakpoint
CREATE TYPE "hrms"."retention_anchor" AS ENUM('created_at', 'exit_date', 'closed_at', 'period_end');--> statement-breakpoint
CREATE TABLE "hrms"."consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"subject_user_id" uuid,
	"subject_email" text NOT NULL,
	"purpose" text NOT NULL,
	"policy_version" integer NOT NULL,
	"granted_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"captured_via" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."data_subject_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"request_type" "hrms"."data_request_type" NOT NULL,
	"status" "hrms"."data_request_status" DEFAULT 'received' NOT NULL,
	"subject_employee_id" uuid,
	"subject_email" text NOT NULL,
	"subject_name" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_on" text NOT NULL,
	"identity_verified_at" timestamp with time zone,
	"identity_verified_by_id" uuid,
	"plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"outcome" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"refused_areas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"refusal_reason" text,
	"handled_by_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."erasure_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"request_id" uuid,
	"policy_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"area" text NOT NULL,
	"method" "hrms"."erasure_method" NOT NULL,
	"rows_affected" integer DEFAULT 0 NOT NULL,
	"pseudonym" text,
	"basis" text NOT NULL,
	"performed_by_id" uuid,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"reason" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"placed_by_id" uuid,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_on" text,
	"released_by_id" uuid,
	"released_at" timestamp with time zone,
	"release_reason" text
);
--> statement-breakpoint
CREATE TABLE "hrms"."processing_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"lawful_basis" text NOT NULL,
	"data_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_subjects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transfers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retention_policy_id" uuid,
	"security_measures" text,
	"owner_id" uuid,
	"last_reviewed_on" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"retain_for_months" integer NOT NULL,
	"anchor" "hrms"."retention_anchor" DEFAULT 'created_at' NOT NULL,
	"method" "hrms"."erasure_method" DEFAULT 'anonymise' NOT NULL,
	"basis" text NOT NULL,
	"overrides_erasure" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The is_unique column on custom_field_values was already created by
-- 0007_rls_for_custom_fields.sql, together with the triggers that maintain it
-- and the partial unique index that depends on it. Drizzle regenerates the
-- ALTER from the schema diff; applying it again fails, so it is removed here
-- rather than in the schema, where the column genuinely belongs.

ALTER TABLE "hrms"."consent_records" ADD CONSTRAINT "consent_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."consent_records" ADD CONSTRAINT "consent_records_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."data_subject_requests" ADD CONSTRAINT "data_subject_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."data_subject_requests" ADD CONSTRAINT "data_subject_requests_subject_employee_id_employees_id_fk" FOREIGN KEY ("subject_employee_id") REFERENCES "hrms"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."erasure_log" ADD CONSTRAINT "erasure_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."erasure_log" ADD CONSTRAINT "erasure_log_request_id_data_subject_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "hrms"."data_subject_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."erasure_log" ADD CONSTRAINT "erasure_log_policy_id_retention_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "hrms"."retention_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."legal_holds" ADD CONSTRAINT "legal_holds_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."processing_activities" ADD CONSTRAINT "processing_activities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."processing_activities" ADD CONSTRAINT "processing_activities_retention_policy_id_retention_policies_id_fk" FOREIGN KEY ("retention_policy_id") REFERENCES "hrms"."retention_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."retention_policies" ADD CONSTRAINT "retention_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_records_subject_purpose_idx" ON "hrms"."consent_records" USING btree ("org_id","subject_email","purpose");--> statement-breakpoint
CREATE INDEX "data_subject_requests_org_status_idx" ON "hrms"."data_subject_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "data_subject_requests_due_idx" ON "hrms"."data_subject_requests" USING btree ("org_id","due_on");--> statement-breakpoint
CREATE INDEX "data_subject_requests_subject_idx" ON "hrms"."data_subject_requests" USING btree ("org_id","subject_email");--> statement-breakpoint
CREATE INDEX "erasure_log_org_performed_idx" ON "hrms"."erasure_log" USING btree ("org_id","performed_at");--> statement-breakpoint
CREATE INDEX "erasure_log_entity_idx" ON "hrms"."erasure_log" USING btree ("org_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "legal_holds_org_entity_idx" ON "hrms"."legal_holds" USING btree ("org_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "legal_holds_reference_idx" ON "hrms"."legal_holds" USING btree ("org_id","reference");--> statement-breakpoint
CREATE INDEX "processing_activities_org_idx" ON "hrms"."processing_activities" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_policies_org_entity_key" ON "hrms"."retention_policies" USING btree ("org_id","entity_type");--> statement-breakpoint
CREATE INDEX "retention_policies_org_active_idx" ON "hrms"."retention_policies" USING btree ("org_id","is_active");