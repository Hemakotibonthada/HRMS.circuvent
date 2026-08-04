CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "hrms";
--> statement-breakpoint
CREATE TYPE "identity"."app" AS ENUM('hrms', 'cv365', 'ats', 'mail', 'office', 'website');--> statement-breakpoint
CREATE TYPE "identity"."role" AS ENUM('owner', 'admin', 'hr', 'manager', 'employee', 'viewer');--> statement-breakpoint
CREATE TYPE "identity"."sso_protocol" AS ENUM('saml', 'oidc');--> statement-breakpoint
CREATE TYPE "identity"."subscription_plan" AS ENUM('starter', 'professional', 'enterprise');--> statement-breakpoint
CREATE TYPE "identity"."subscription_status" AS ENUM('active', 'trial', 'past_due', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "identity"."token_purpose" AS ENUM('email_verification', 'password_reset', 'invitation', 'magic_link');--> statement-breakpoint
CREATE TYPE "identity"."user_status" AS ENUM('active', 'invited', 'suspended', 'deactivated');--> statement-breakpoint
CREATE TYPE "hrms"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "hrms"."attendance_status" AS ENUM('present', 'absent', 'late', 'half_day', 'on_leave', 'holiday', 'weekend', 'wfh');--> statement-breakpoint
CREATE TYPE "hrms"."clock_method" AS ENUM('biometric', 'web', 'mobile', 'manual', 'geo_fence');--> statement-breakpoint
CREATE TYPE "hrms"."employee_status" AS ENUM('active', 'on_leave', 'probation', 'notice_period', 'terminated', 'inactive');--> statement-breakpoint
CREATE TYPE "hrms"."employment_type" AS ENUM('full_time', 'part_time', 'contract', 'intern', 'freelance');--> statement-breakpoint
CREATE TYPE "hrms"."gender" AS ENUM('male', 'female', 'other', 'prefer_not_to_say');--> statement-breakpoint
CREATE TYPE "hrms"."leave_type" AS ENUM('casual', 'sick', 'earned', 'maternity', 'paternity', 'compensatory', 'unpaid', 'bereavement', 'wfh', 'marriage', 'study');--> statement-breakpoint
CREATE TYPE "hrms"."payroll_status" AS ENUM('draft', 'processing', 'processed', 'approved', 'paid', 'on_hold', 'error');--> statement-breakpoint
CREATE TYPE "hrms"."priority" AS ENUM('low', 'medium', 'high', 'critical', 'urgent');--> statement-breakpoint
CREATE TABLE "identity"."api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 600 NOT NULL,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_email" text,
	"app" "identity"."app" NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"request_id" text,
	"previous_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"org_id" uuid,
	"email" text NOT NULL,
	"purpose" "identity"."token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"industry" text,
	"size" text,
	"website" text,
	"address" text,
	"city" text,
	"country" text DEFAULT 'India',
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"locale" text DEFAULT 'en-IN' NOT NULL,
	"fiscal_year_start_month" integer DEFAULT 4 NOT NULL,
	"owner_id" uuid,
	"plan" "identity"."subscription_plan" DEFAULT 'starter' NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."scim_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"rotated_to_id" uuid,
	"app" "identity"."app",
	"ip_address" "inet",
	"user_agent" text,
	"device_name" text,
	"push_token" text,
	"mfa_verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."sso_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"protocol" "identity"."sso_protocol" NOT NULL,
	"display_name" text NOT NULL,
	"email_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata_url" text,
	"entity_id" text,
	"sso_url" text,
	"x509_certificate" text,
	"oidc_issuer" text,
	"oidc_client_id" text,
	"oidc_client_secret" text,
	"attribute_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"jit_provisioning" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan" "identity"."subscription_plan" DEFAULT 'starter' NOT NULL,
	"status" "identity"."subscription_status" DEFAULT 'trial' NOT NULL,
	"max_employees" integer DEFAULT 25 NOT NULL,
	"current_employees" integer DEFAULT 0 NOT NULL,
	"price_per_employee" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"billing_cycle" text DEFAULT 'monthly' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"external_customer_id" text,
	"external_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"app" "identity"."app" NOT NULL,
	"role" "identity"."role" NOT NULL,
	"extra_permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"legacy_firebase_uid" text,
	"must_reset_password" boolean DEFAULT false NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"phone" text,
	"status" "identity"."user_status" DEFAULT 'active' NOT NULL,
	"mfa_secret" text,
	"mfa_enabled_at" timestamp with time zone,
	"mfa_backup_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"locale" text,
	"timezone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hrms"."announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" text DEFAULT 'general',
	"priority" "hrms"."priority" DEFAULT 'medium' NOT NULL,
	"audience_department_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audience_location_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"stage" text DEFAULT 'applied' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"match_score" integer,
	"rating" integer,
	"rejection_reason" text,
	"tracking_token" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"asset_tag" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"serial_number" text,
	"manufacturer" text,
	"model" text,
	"purchase_date" date,
	"purchase_cost_minor" bigint,
	"warranty_expires_on" date,
	"condition" text DEFAULT 'good' NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"assigned_to_id" uuid,
	"assigned_at" timestamp with time zone,
	"location_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"clock_in_at" timestamp with time zone,
	"clock_out_at" timestamp with time zone,
	"status" "hrms"."attendance_status" NOT NULL,
	"shift_id" uuid,
	"worked_minutes" integer,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"late_by_minutes" integer DEFAULT 0 NOT NULL,
	"early_leave_by_minutes" integer DEFAULT 0 NOT NULL,
	"clock_in_method" "hrms"."clock_method",
	"clock_out_method" "hrms"."clock_method",
	"clock_in_latitude" numeric(10, 7),
	"clock_in_longitude" numeric(10, 7),
	"clock_in_photo_url" text,
	"is_within_geofence" boolean,
	"ip_address" text,
	"is_regularized" boolean DEFAULT false NOT NULL,
	"regularization_reason" text,
	"regularized_by_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"resume_url" text,
	"parsed_resume" jsonb,
	"current_company" text,
	"current_designation" text,
	"total_experience_years" numeric(4, 1),
	"expected_ctc_minor" bigint,
	"notice_period_days" integer,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text,
	"referred_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"head_id" uuid,
	"parent_id" uuid,
	"budget_minor" bigint,
	"cost_center" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."employee_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"name" text NOT NULL,
	"document_type" text NOT NULL,
	"blob_url" text NOT NULL,
	"size_bytes" bigint,
	"mime_type" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verified_by_id" uuid,
	"verified_at" timestamp with time zone,
	"expires_on" date,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"employee_code" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"work_email" text NOT NULL,
	"personal_email" text,
	"phone" text,
	"avatar_url" text,
	"gender" "hrms"."gender",
	"date_of_birth" date,
	"blood_group" text,
	"marital_status" text,
	"address_line1" text,
	"city" text,
	"state" text,
	"country" text DEFAULT 'India',
	"postal_code" text,
	"department_id" uuid,
	"location_id" uuid,
	"designation" text NOT NULL,
	"reporting_to_id" uuid,
	"employment_type" "hrms"."employment_type" DEFAULT 'full_time' NOT NULL,
	"status" "hrms"."employee_status" DEFAULT 'active' NOT NULL,
	"join_date" date NOT NULL,
	"confirmation_date" date,
	"exit_date" date,
	"exit_reason" text,
	"notice_period_days" integer DEFAULT 60,
	"ctc_minor" bigint,
	"currency" text DEFAULT 'INR' NOT NULL,
	"bank_details" jsonb,
	"emergency_contact" jsonb,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"qualifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pan_number" text,
	"aadhaar_number" text,
	"uan_number" text,
	"pf_number" text,
	"esi_number" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hrms"."expense_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"claim_number" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"total_amount_minor" bigint NOT NULL,
	"approved_amount_minor" bigint,
	"currency" text DEFAULT 'INR' NOT NULL,
	"expense_date" date NOT NULL,
	"description" text,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"receipts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "hrms"."approval_status" DEFAULT 'pending' NOT NULL,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"reimbursed_at" timestamp with time zone,
	"anomalies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"workflow_instance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"holiday_date" date NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"location_id" uuid,
	"year" integer NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"interview_type" text DEFAULT 'technical' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"meeting_url" text,
	"panelist_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"overall_rating" integer,
	"recommendation" text,
	"feedback" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."job_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"department_id" uuid,
	"location_id" uuid,
	"employment_type" "hrms"."employment_type" DEFAULT 'full_time' NOT NULL,
	"experience_min_years" integer,
	"experience_max_years" integer,
	"salary_min_minor" bigint,
	"salary_max_minor" bigint,
	"description" text,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"openings" integer DEFAULT 1 NOT NULL,
	"filled" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"hiring_manager_id" uuid,
	"recruiter_id" uuid,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"closes_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."leave_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"leave_type" "hrms"."leave_type" NOT NULL,
	"opening_days" numeric(6, 2) DEFAULT '0' NOT NULL,
	"accrued_days" numeric(6, 2) DEFAULT '0' NOT NULL,
	"used_days" numeric(6, 2) DEFAULT '0' NOT NULL,
	"pending_days" numeric(6, 2) DEFAULT '0' NOT NULL,
	"carry_forward_days" numeric(6, 2) DEFAULT '0' NOT NULL,
	"lapsed_days" numeric(6, 2) DEFAULT '0' NOT NULL,
	"encashed_days" numeric(6, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."leave_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"leave_type" "hrms"."leave_type" NOT NULL,
	"label" text NOT NULL,
	"annual_quota_days" numeric(5, 2) NOT NULL,
	"carry_forward_limit_days" numeric(5, 2) DEFAULT '0' NOT NULL,
	"max_consecutive_days" integer,
	"min_days_notice" integer DEFAULT 0 NOT NULL,
	"is_pro_rata" boolean DEFAULT true NOT NULL,
	"accrual_frequency" text DEFAULT 'monthly' NOT NULL,
	"is_encashable" boolean DEFAULT false NOT NULL,
	"requires_attachment_after_days" integer,
	"applicable_genders" jsonb,
	"is_paid" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type" "hrms"."leave_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"total_days" numeric(5, 2) NOT NULL,
	"is_half_day" boolean DEFAULT false NOT NULL,
	"half_day_period" text,
	"reason" text NOT NULL,
	"status" "hrms"."approval_status" DEFAULT 'pending' NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"cancellation_reason" text,
	"contact_during_leave" text,
	"handover_to_id" uuid,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"workflow_instance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address_line1" text,
	"city" text,
	"state" text,
	"country" text DEFAULT 'India' NOT NULL,
	"postal_code" text,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"geofence_radius_meters" integer DEFAULT 200,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"action_url" text,
	"channels" jsonb DEFAULT '["in_app"]'::jsonb NOT NULL,
	"priority" "hrms"."priority" DEFAULT 'medium' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."payroll_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"working_days" numeric(5, 2) NOT NULL,
	"present_days" numeric(5, 2) NOT NULL,
	"lop_days" numeric(5, 2) DEFAULT '0' NOT NULL,
	"basic_minor" bigint DEFAULT 0 NOT NULL,
	"hra_minor" bigint DEFAULT 0 NOT NULL,
	"conveyance_minor" bigint DEFAULT 0 NOT NULL,
	"medical_minor" bigint DEFAULT 0 NOT NULL,
	"lta_minor" bigint DEFAULT 0 NOT NULL,
	"special_allowance_minor" bigint DEFAULT 0 NOT NULL,
	"other_earnings_minor" bigint DEFAULT 0 NOT NULL,
	"overtime_minor" bigint DEFAULT 0 NOT NULL,
	"bonus_minor" bigint DEFAULT 0 NOT NULL,
	"arrears_minor" bigint DEFAULT 0 NOT NULL,
	"gross_minor" bigint DEFAULT 0 NOT NULL,
	"pf_employee_minor" bigint DEFAULT 0 NOT NULL,
	"esi_employee_minor" bigint DEFAULT 0 NOT NULL,
	"professional_tax_minor" bigint DEFAULT 0 NOT NULL,
	"income_tax_minor" bigint DEFAULT 0 NOT NULL,
	"loan_recovery_minor" bigint DEFAULT 0 NOT NULL,
	"lop_deduction_minor" bigint DEFAULT 0 NOT NULL,
	"other_deductions_minor" bigint DEFAULT 0 NOT NULL,
	"total_deductions_minor" bigint DEFAULT 0 NOT NULL,
	"net_pay_minor" bigint DEFAULT 0 NOT NULL,
	"pf_employer_minor" bigint DEFAULT 0 NOT NULL,
	"esi_employer_minor" bigint DEFAULT 0 NOT NULL,
	"status" "hrms"."payroll_status" DEFAULT 'draft' NOT NULL,
	"payment_mode" text DEFAULT 'bank_transfer',
	"transaction_ref" text,
	"paid_at" timestamp with time zone,
	"payslip_url" text,
	"anomalies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"period_month" integer NOT NULL,
	"period_year" integer NOT NULL,
	"run_type" text DEFAULT 'regular' NOT NULL,
	"status" "hrms"."payroll_status" DEFAULT 'draft' NOT NULL,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"total_gross_minor" bigint DEFAULT 0 NOT NULL,
	"total_deductions_minor" bigint DEFAULT 0 NOT NULL,
	"total_net_minor" bigint DEFAULT 0 NOT NULL,
	"processed_by_id" uuid,
	"processed_at" timestamp with time zone,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"bank_advice_url" text,
	"error_log" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."performance_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"cycle_id" uuid,
	"parent_goal_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"weight_percent" integer DEFAULT 0 NOT NULL,
	"target_value" numeric(14, 2),
	"current_value" numeric(14, 2),
	"unit" text,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"start_date" date,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."performance_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"review_type" text DEFAULT 'manager' NOT NULL,
	"self_rating" numeric(3, 1),
	"manager_rating" numeric(3, 1),
	"final_rating" numeric(3, 1),
	"potential_score" integer,
	"performance_score" integer,
	"strengths" text,
	"improvements" text,
	"comments" text,
	"ai_summary" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."review_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"self_review_due_on" date,
	"manager_review_due_on" date,
	"calibration_due_on" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"includes_self_review" boolean DEFAULT true NOT NULL,
	"includes_peer_review" boolean DEFAULT false NOT NULL,
	"includes_360" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."salary_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"ctc_minor" bigint NOT NULL,
	"basic_minor" bigint NOT NULL,
	"hra_minor" bigint DEFAULT 0 NOT NULL,
	"conveyance_minor" bigint DEFAULT 0 NOT NULL,
	"medical_minor" bigint DEFAULT 0 NOT NULL,
	"lta_minor" bigint DEFAULT 0 NOT NULL,
	"special_allowance_minor" bigint DEFAULT 0 NOT NULL,
	"other_allowances_minor" bigint DEFAULT 0 NOT NULL,
	"employer_pf_minor" bigint DEFAULT 0 NOT NULL,
	"employer_esi_minor" bigint DEFAULT 0 NOT NULL,
	"gratuity_minor" bigint DEFAULT 0 NOT NULL,
	"revision_reason" text,
	"approved_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"break_minutes" integer DEFAULT 60 NOT NULL,
	"grace_minutes" integer DEFAULT 15 NOT NULL,
	"half_day_threshold_minutes" integer DEFAULT 240 NOT NULL,
	"full_day_threshold_minutes" integer DEFAULT 480 NOT NULL,
	"weekly_off_days" jsonb DEFAULT '[6,7]'::jsonb NOT NULL,
	"is_night_shift" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"ticket_number" text NOT NULL,
	"raised_by_id" uuid NOT NULL,
	"assigned_to_id" uuid,
	"category" text NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"priority" "hrms"."priority" DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"sla_due_at" timestamp with time zone,
	"first_responded_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"satisfaction_rating" integer,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."workflow_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"entity_type" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trigger_conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."workflow_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"initiated_by_id" uuid,
	"current_step_index" integer DEFAULT 0 NOT NULL,
	"status" "hrms"."approval_status" DEFAULT 'pending' NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."audit_log" ADD CONSTRAINT "audit_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."auth_tokens" ADD CONSTRAINT "auth_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."scim_tokens" ADD CONSTRAINT "scim_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sso_connections" ADD CONSTRAINT "sso_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_roles" ADD CONSTRAINT "user_roles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."announcements" ADD CONSTRAINT "announcements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."applications" ADD CONSTRAINT "applications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."applications" ADD CONSTRAINT "applications_job_id_job_postings_id_fk" FOREIGN KEY ("job_id") REFERENCES "hrms"."job_postings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."applications" ADD CONSTRAINT "applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "hrms"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."assets" ADD CONSTRAINT "assets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."assets" ADD CONSTRAINT "assets_assigned_to_id_employees_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "hrms"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."assets" ADD CONSTRAINT "assets_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "hrms"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."attendance_records" ADD CONSTRAINT "attendance_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."attendance_records" ADD CONSTRAINT "attendance_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."attendance_records" ADD CONSTRAINT "attendance_records_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "hrms"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."candidates" ADD CONSTRAINT "candidates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."departments" ADD CONSTRAINT "departments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."employee_documents" ADD CONSTRAINT "employee_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."employee_documents" ADD CONSTRAINT "employee_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."employees" ADD CONSTRAINT "employees_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "hrms"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."employees" ADD CONSTRAINT "employees_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "hrms"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."expense_claims" ADD CONSTRAINT "expense_claims_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."expense_claims" ADD CONSTRAINT "expense_claims_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."holidays" ADD CONSTRAINT "holidays_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."holidays" ADD CONSTRAINT "holidays_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "hrms"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."interviews" ADD CONSTRAINT "interviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."interviews" ADD CONSTRAINT "interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "hrms"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."job_postings" ADD CONSTRAINT "job_postings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."job_postings" ADD CONSTRAINT "job_postings_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "hrms"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."job_postings" ADD CONSTRAINT "job_postings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "hrms"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."leave_balances" ADD CONSTRAINT "leave_balances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."leave_balances" ADD CONSTRAINT "leave_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."leave_policies" ADD CONSTRAINT "leave_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."leave_requests" ADD CONSTRAINT "leave_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."locations" ADD CONSTRAINT "locations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."payroll_records" ADD CONSTRAINT "payroll_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."payroll_records" ADD CONSTRAINT "payroll_records_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "hrms"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."payroll_records" ADD CONSTRAINT "payroll_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."payroll_runs" ADD CONSTRAINT "payroll_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."performance_goals" ADD CONSTRAINT "performance_goals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."performance_goals" ADD CONSTRAINT "performance_goals_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."performance_goals" ADD CONSTRAINT "performance_goals_cycle_id_review_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "hrms"."review_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."performance_reviews" ADD CONSTRAINT "performance_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."performance_reviews" ADD CONSTRAINT "performance_reviews_cycle_id_review_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "hrms"."review_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."performance_reviews" ADD CONSTRAINT "performance_reviews_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."review_cycles" ADD CONSTRAINT "review_cycles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."salary_structures" ADD CONSTRAINT "salary_structures_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."salary_structures" ADD CONSTRAINT "salary_structures_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."shifts" ADD CONSTRAINT "shifts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."tickets" ADD CONSTRAINT "tickets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."tickets" ADD CONSTRAINT "tickets_raised_by_id_employees_id_fk" FOREIGN KEY ("raised_by_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."tickets" ADD CONSTRAINT "tickets_assigned_to_id_employees_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "hrms"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."workflow_definitions" ADD CONSTRAINT "workflow_definitions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."workflow_instances" ADD CONSTRAINT "workflow_instances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."workflow_instances" ADD CONSTRAINT "workflow_instances_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "hrms"."workflow_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "identity"."api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "identity"."api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "identity"."audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "identity"."audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "identity"."audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "identity"."auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_email_purpose_idx" ON "identity"."auth_tokens" USING btree ("email","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_key" ON "identity"."organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_tokens_token_hash_key" ON "identity"."scim_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "identity"."sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "identity"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "identity"."sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sso_connections_org_idx" ON "identity"."sso_connections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_org_key" ON "identity"."subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_user_app_key" ON "identity"."user_roles" USING btree ("user_id","app");--> statement-breakpoint
CREATE INDEX "user_roles_org_app_idx" ON "identity"."user_roles" USING btree ("org_id","app");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "identity"."users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_legacy_firebase_uid_key" ON "identity"."users" USING btree ("legacy_firebase_uid");--> statement-breakpoint
CREATE INDEX "users_org_id_idx" ON "identity"."users" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "users_org_status_idx" ON "identity"."users" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "announcements_org_published_idx" ON "hrms"."announcements" USING btree ("org_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_job_candidate_key" ON "hrms"."applications" USING btree ("job_id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_tracking_token_key" ON "hrms"."applications" USING btree ("tracking_token");--> statement-breakpoint
CREATE INDEX "applications_org_stage_idx" ON "hrms"."applications" USING btree ("org_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_org_tag_key" ON "hrms"."assets" USING btree ("org_id","asset_tag");--> statement-breakpoint
CREATE INDEX "assets_org_status_idx" ON "hrms"."assets" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "assets_assigned_to_idx" ON "hrms"."assets" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_employee_date_key" ON "hrms"."attendance_records" USING btree ("employee_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_org_date_idx" ON "hrms"."attendance_records" USING btree ("org_id","work_date");--> statement-breakpoint
CREATE INDEX "attendance_org_status_date_idx" ON "hrms"."attendance_records" USING btree ("org_id","status","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_org_email_key" ON "hrms"."candidates" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "candidates_org_idx" ON "hrms"."candidates" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_org_code_key" ON "hrms"."departments" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "departments_org_idx" ON "hrms"."departments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "employee_documents_employee_idx" ON "hrms"."employee_documents" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_org_code_key" ON "hrms"."employees" USING btree ("org_id","employee_code");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_org_work_email_key" ON "hrms"."employees" USING btree ("org_id","work_email");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_user_id_key" ON "hrms"."employees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "employees_org_status_idx" ON "hrms"."employees" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "employees_org_department_idx" ON "hrms"."employees" USING btree ("org_id","department_id");--> statement-breakpoint
CREATE INDEX "employees_reporting_to_idx" ON "hrms"."employees" USING btree ("reporting_to_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_claims_org_number_key" ON "hrms"."expense_claims" USING btree ("org_id","claim_number");--> statement-breakpoint
CREATE INDEX "expense_claims_employee_idx" ON "hrms"."expense_claims" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "expense_claims_org_status_idx" ON "hrms"."expense_claims" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "holidays_org_year_idx" ON "hrms"."holidays" USING btree ("org_id","year");--> statement-breakpoint
CREATE INDEX "interviews_application_idx" ON "hrms"."interviews" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "interviews_org_scheduled_idx" ON "hrms"."interviews" USING btree ("org_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_postings_org_slug_key" ON "hrms"."job_postings" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "job_postings_org_status_idx" ON "hrms"."job_postings" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_balances_employee_year_type_key" ON "hrms"."leave_balances" USING btree ("employee_id","year","leave_type");--> statement-breakpoint
CREATE INDEX "leave_balances_org_year_idx" ON "hrms"."leave_balances" USING btree ("org_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_policies_org_type_key" ON "hrms"."leave_policies" USING btree ("org_id","leave_type");--> statement-breakpoint
CREATE INDEX "leave_requests_org_status_idx" ON "hrms"."leave_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "leave_requests_employee_idx" ON "hrms"."leave_requests" USING btree ("employee_id","start_date");--> statement-breakpoint
CREATE INDEX "leave_requests_org_dates_idx" ON "hrms"."leave_requests" USING btree ("org_id","start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_org_code_key" ON "hrms"."locations" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "hrms"."notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_records_run_employee_key" ON "hrms"."payroll_records" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_records_employee_idx" ON "hrms"."payroll_records" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "payroll_records_org_status_idx" ON "hrms"."payroll_records" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_org_period_type_key" ON "hrms"."payroll_runs" USING btree ("org_id","period_year","period_month","run_type");--> statement-breakpoint
CREATE INDEX "payroll_runs_org_status_idx" ON "hrms"."payroll_runs" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "performance_goals_employee_idx" ON "hrms"."performance_goals" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "performance_goals_org_cycle_idx" ON "hrms"."performance_goals" USING btree ("org_id","cycle_id");--> statement-breakpoint
CREATE INDEX "performance_reviews_cycle_employee_idx" ON "hrms"."performance_reviews" USING btree ("cycle_id","employee_id");--> statement-breakpoint
CREATE INDEX "performance_reviews_org_status_idx" ON "hrms"."performance_reviews" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "review_cycles_org_status_idx" ON "hrms"."review_cycles" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "salary_structures_employee_idx" ON "hrms"."salary_structures" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "salary_structures_org_idx" ON "hrms"."salary_structures" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_org_code_key" ON "hrms"."shifts" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_org_number_key" ON "hrms"."tickets" USING btree ("org_id","ticket_number");--> statement-breakpoint
CREATE INDEX "tickets_org_status_idx" ON "hrms"."tickets" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "tickets_assigned_to_idx" ON "hrms"."tickets" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX "workflow_definitions_org_entity_idx" ON "hrms"."workflow_definitions" USING btree ("org_id","entity_type");--> statement-breakpoint
CREATE INDEX "workflow_instances_entity_idx" ON "hrms"."workflow_instances" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "workflow_instances_org_status_idx" ON "hrms"."workflow_instances" USING btree ("org_id","status");