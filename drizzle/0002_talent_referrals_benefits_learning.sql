CREATE TYPE "hrms"."benefit_type" AS ENUM('health_insurance', 'life_insurance', 'accident_insurance', 'retirement', 'wellness', 'meal', 'transport', 'education', 'childcare', 'other');--> statement-breakpoint
CREATE TYPE "hrms"."course_format" AS ENUM('self_paced', 'instructor_led', 'blended', 'external');--> statement-breakpoint
CREATE TYPE "hrms"."course_enrolment_state" AS ENUM('assigned', 'in_progress', 'completed', 'failed', 'expired', 'waived');--> statement-breakpoint
CREATE TYPE "hrms"."enrolment_status" AS ENUM('elected', 'active', 'waived', 'terminated');--> statement-breakpoint
CREATE TYPE "hrms"."referral_payout_status" AS ENUM('not_eligible', 'pending_milestone', 'approved', 'paid', 'forfeited');--> statement-breakpoint
CREATE TYPE "hrms"."referral_status" AS ENUM('submitted', 'screening', 'interviewing', 'offered', 'hired', 'rejected', 'withdrawn', 'duplicate');--> statement-breakpoint
CREATE TYPE "hrms"."signature_status" AS ENUM('draft', 'sent', 'viewed', 'partially_signed', 'completed', 'declined', 'expired', 'voided');--> statement-breakpoint
CREATE TABLE "hrms"."benefit_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"dependant_id" uuid,
	"claim_number" text NOT NULL,
	"claimed_amount_minor" bigint NOT NULL,
	"approved_amount_minor" bigint,
	"incident_date" date NOT NULL,
	"description" text,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"provider_reference" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."benefit_enrolments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"window_id" uuid,
	"status" "hrms"."enrolment_status" DEFAULT 'elected' NOT NULL,
	"plan_year" integer NOT NULL,
	"coverage_from" date,
	"coverage_to" date,
	"employee_cost_minor" bigint DEFAULT 0 NOT NULL,
	"employer_cost_minor" bigint DEFAULT 0 NOT NULL,
	"waiver_reason" text,
	"terminated_on" date,
	"termination_reason" text,
	"elected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."benefit_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"benefit_type" "hrms"."benefit_type" NOT NULL,
	"provider" text,
	"policy_number" text,
	"description" text,
	"employer_contribution_minor" bigint DEFAULT 0 NOT NULL,
	"employee_contribution_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"coverage_amount_minor" bigint,
	"allows_dependants" boolean DEFAULT false NOT NULL,
	"eligible_relations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_dependants" integer,
	"eligibility_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_auto_enrolled" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"document_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"name" text NOT NULL,
	"issuing_body" text,
	"credential_id" text,
	"credential_url" text,
	"course_enrolment_id" uuid,
	"issued_on" date NOT NULL,
	"expires_on" date,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verified_by_id" uuid,
	"document_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."course_enrolments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"state" "hrms"."course_enrolment_state" DEFAULT 'assigned' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"completed_module_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score_percent" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"time_spent_minutes" integer DEFAULT 0 NOT NULL,
	"assigned_by_id" uuid,
	"due_on" date,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_on" date,
	"certificate_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."course_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"sequence" integer NOT NULL,
	"content_type" text DEFAULT 'video' NOT NULL,
	"content_url" text,
	"content_body" text,
	"duration_minutes" integer,
	"is_optional" boolean DEFAULT false NOT NULL,
	"assessment" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"category" text,
	"format" "hrms"."course_format" DEFAULT 'self_paced' NOT NULL,
	"duration_minutes" integer,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prerequisite_course_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"mandatory_for_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recertify_after_days" integer,
	"passing_score_percent" integer DEFAULT 70,
	"max_attempts" integer,
	"provider_name" text,
	"external_url" text,
	"thumbnail_url" text,
	"cost_minor" bigint,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."dependants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"relation" text NOT NULL,
	"date_of_birth" date,
	"gender" text,
	"identifier" text,
	"is_nominee" boolean DEFAULT false NOT NULL,
	"nominee_share_percent" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."document_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"signatory_user_id" uuid,
	"signatory_email" text NOT NULL,
	"signatory_name" text,
	"signatory_role" text NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"access_token_hash" text,
	"viewed_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"signature_image_url" text,
	"signed_content_hash" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."document_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"body" text NOT NULL,
	"required_tokens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_signature" boolean DEFAULT false NOT NULL,
	"signatory_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."enrolment_dependants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"dependant_id" uuid NOT NULL,
	"added_cost_minor" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."enrolment_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"opens_on" date NOT NULL,
	"closes_on" date NOT NULL,
	"coverage_starts_on" date NOT NULL,
	"plan_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."generated_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"template_id" uuid,
	"template_version" integer,
	"employee_id" uuid,
	"candidate_id" uuid,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"rendered_body" text,
	"blob_url" text,
	"content_hash" text,
	"status" "hrms"."signature_status" DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"voided_reason" text,
	"generated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."referral_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"referral_id" uuid NOT NULL,
	"from_status" "hrms"."referral_status",
	"to_status" "hrms"."referral_status" NOT NULL,
	"actor_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."referral_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"department_id" uuid,
	"seniority" text,
	"bonus_amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"qualifying_period_days" integer DEFAULT 90 NOT NULL,
	"instalments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"referrer_id" uuid NOT NULL,
	"candidate_id" uuid,
	"job_id" uuid,
	"candidate_name" text NOT NULL,
	"candidate_email" text NOT NULL,
	"candidate_phone" text,
	"position_title" text NOT NULL,
	"department_id" uuid,
	"resume_url" text,
	"recommendation" text,
	"relationship" text,
	"status" "hrms"."referral_status" DEFAULT 'submitted' NOT NULL,
	"rejection_reason" text,
	"bonus_amount_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"payout_status" "hrms"."referral_payout_status" DEFAULT 'not_eligible' NOT NULL,
	"payout_eligible_on" date,
	"payout_approved_by_id" uuid,
	"payout_approved_at" timestamp with time zone,
	"payout_payroll_run_id" uuid,
	"paid_at" timestamp with time zone,
	"forfeited_reason" text,
	"hired_employee_id" uuid,
	"hired_on" date,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hrms"."benefit_claims" ADD CONSTRAINT "benefit_claims_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."benefit_claims" ADD CONSTRAINT "benefit_claims_enrolment_id_benefit_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "hrms"."benefit_enrolments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."benefit_claims" ADD CONSTRAINT "benefit_claims_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."benefit_claims" ADD CONSTRAINT "benefit_claims_dependant_id_dependants_id_fk" FOREIGN KEY ("dependant_id") REFERENCES "hrms"."dependants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."benefit_enrolments" ADD CONSTRAINT "benefit_enrolments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."benefit_enrolments" ADD CONSTRAINT "benefit_enrolments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."benefit_enrolments" ADD CONSTRAINT "benefit_enrolments_plan_id_benefit_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "hrms"."benefit_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."benefit_enrolments" ADD CONSTRAINT "benefit_enrolments_window_id_enrolment_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "hrms"."enrolment_windows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."benefit_plans" ADD CONSTRAINT "benefit_plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."certifications" ADD CONSTRAINT "certifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."certifications" ADD CONSTRAINT "certifications_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."certifications" ADD CONSTRAINT "certifications_course_enrolment_id_course_enrolments_id_fk" FOREIGN KEY ("course_enrolment_id") REFERENCES "hrms"."course_enrolments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."course_enrolments" ADD CONSTRAINT "course_enrolments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."course_enrolments" ADD CONSTRAINT "course_enrolments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "hrms"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."course_enrolments" ADD CONSTRAINT "course_enrolments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."course_modules" ADD CONSTRAINT "course_modules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."course_modules" ADD CONSTRAINT "course_modules_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "hrms"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."courses" ADD CONSTRAINT "courses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."dependants" ADD CONSTRAINT "dependants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."dependants" ADD CONSTRAINT "dependants_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."document_signatures" ADD CONSTRAINT "document_signatures_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."document_signatures" ADD CONSTRAINT "document_signatures_document_id_generated_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "hrms"."generated_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."document_signatures" ADD CONSTRAINT "document_signatures_signatory_user_id_users_id_fk" FOREIGN KEY ("signatory_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."document_templates" ADD CONSTRAINT "document_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."enrolment_dependants" ADD CONSTRAINT "enrolment_dependants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."enrolment_dependants" ADD CONSTRAINT "enrolment_dependants_enrolment_id_benefit_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "hrms"."benefit_enrolments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."enrolment_dependants" ADD CONSTRAINT "enrolment_dependants_dependant_id_dependants_id_fk" FOREIGN KEY ("dependant_id") REFERENCES "hrms"."dependants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."enrolment_windows" ADD CONSTRAINT "enrolment_windows_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."generated_documents" ADD CONSTRAINT "generated_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."generated_documents" ADD CONSTRAINT "generated_documents_template_id_document_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "hrms"."document_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."generated_documents" ADD CONSTRAINT "generated_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."generated_documents" ADD CONSTRAINT "generated_documents_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "hrms"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."referral_events" ADD CONSTRAINT "referral_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."referral_events" ADD CONSTRAINT "referral_events_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "hrms"."referrals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."referral_policies" ADD CONSTRAINT "referral_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."referral_policies" ADD CONSTRAINT "referral_policies_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "hrms"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."referrals" ADD CONSTRAINT "referrals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."referrals" ADD CONSTRAINT "referrals_referrer_id_employees_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."referrals" ADD CONSTRAINT "referrals_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "hrms"."candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."referrals" ADD CONSTRAINT "referrals_job_id_job_postings_id_fk" FOREIGN KEY ("job_id") REFERENCES "hrms"."job_postings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."referrals" ADD CONSTRAINT "referrals_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "hrms"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."referrals" ADD CONSTRAINT "referrals_hired_employee_id_employees_id_fk" FOREIGN KEY ("hired_employee_id") REFERENCES "hrms"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "benefit_claims_org_number_key" ON "hrms"."benefit_claims" USING btree ("org_id","claim_number");--> statement-breakpoint
CREATE INDEX "benefit_claims_employee_idx" ON "hrms"."benefit_claims" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "benefit_enrolments_employee_plan_year_key" ON "hrms"."benefit_enrolments" USING btree ("employee_id","plan_id","plan_year");--> statement-breakpoint
CREATE INDEX "benefit_enrolments_org_status_idx" ON "hrms"."benefit_enrolments" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "benefit_plans_org_active_idx" ON "hrms"."benefit_plans" USING btree ("org_id","is_active");--> statement-breakpoint
CREATE INDEX "certifications_employee_idx" ON "hrms"."certifications" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "certifications_org_expiry_idx" ON "hrms"."certifications" USING btree ("org_id","expires_on");--> statement-breakpoint
CREATE INDEX "course_enrolments_employee_idx" ON "hrms"."course_enrolments" USING btree ("employee_id","state");--> statement-breakpoint
CREATE INDEX "course_enrolments_org_course_idx" ON "hrms"."course_enrolments" USING btree ("org_id","course_id");--> statement-breakpoint
CREATE INDEX "course_enrolments_expiry_idx" ON "hrms"."course_enrolments" USING btree ("org_id","expires_on");--> statement-breakpoint
CREATE UNIQUE INDEX "course_modules_course_sequence_key" ON "hrms"."course_modules" USING btree ("course_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_org_code_key" ON "hrms"."courses" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "courses_org_published_idx" ON "hrms"."courses" USING btree ("org_id","is_published");--> statement-breakpoint
CREATE INDEX "dependants_employee_idx" ON "hrms"."dependants" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_signatures_doc_sequence_key" ON "hrms"."document_signatures" USING btree ("document_id","sequence");--> statement-breakpoint
CREATE INDEX "document_signatures_email_idx" ON "hrms"."document_signatures" USING btree ("signatory_email");--> statement-breakpoint
CREATE INDEX "document_templates_org_category_idx" ON "hrms"."document_templates" USING btree ("org_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "enrolment_dependants_key" ON "hrms"."enrolment_dependants" USING btree ("enrolment_id","dependant_id");--> statement-breakpoint
CREATE INDEX "enrolment_windows_org_dates_idx" ON "hrms"."enrolment_windows" USING btree ("org_id","opens_on","closes_on");--> statement-breakpoint
CREATE INDEX "generated_documents_employee_idx" ON "hrms"."generated_documents" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "generated_documents_org_status_idx" ON "hrms"."generated_documents" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "referral_events_referral_idx" ON "hrms"."referral_events" USING btree ("referral_id","created_at");--> statement-breakpoint
CREATE INDEX "referral_policies_org_idx" ON "hrms"."referral_policies" USING btree ("org_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_org_email_job_key" ON "hrms"."referrals" USING btree ("org_id","candidate_email","job_id");--> statement-breakpoint
CREATE INDEX "referrals_org_status_idx" ON "hrms"."referrals" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "hrms"."referrals" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "referrals_payout_idx" ON "hrms"."referrals" USING btree ("org_id","payout_status");