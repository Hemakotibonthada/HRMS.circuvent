CREATE TYPE "hrms"."roster_assignment_status" AS ENUM('scheduled', 'confirmed', 'swapped_out', 'cancelled', 'completed', 'no_show');--> statement-breakpoint
CREATE TYPE "hrms"."availability_kind" AS ENUM('unavailable', 'preferred', 'leave', 'training', 'holiday');--> statement-breakpoint
CREATE TYPE "hrms"."roster_status" AS ENUM('draft', 'pending_approval', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "hrms"."shift_swap_status" AS ENUM('open', 'accepted', 'pending_approval', 'approved', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "hrms"."availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "hrms"."availability_kind" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"reason" text,
	"source_leave_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."coverage_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"pattern_id" uuid NOT NULL,
	"department_id" uuid,
	"location_id" uuid,
	"weekday" integer,
	"headcount" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."open_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"roster_id" uuid NOT NULL,
	"pattern_id" uuid NOT NULL,
	"shift_date" date NOT NULL,
	"headcount_needed" integer DEFAULT 1 NOT NULL,
	"reason" text,
	"claimed_by_id" uuid,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."roster_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"roster_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"pattern_id" uuid NOT NULL,
	"shift_date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"status" "hrms"."roster_assignment_status" DEFAULT 'scheduled' NOT NULL,
	"replaces_assignment_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."rosters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"department_id" uuid,
	"location_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "hrms"."roster_status" DEFAULT 'draft' NOT NULL,
	"constraints_snapshot" jsonb,
	"accepted_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_by_id" uuid,
	"published_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."shift_eligibility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"pattern_id" uuid NOT NULL,
	"valid_from" date,
	"valid_until" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."shift_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"colour" text DEFAULT '#64748b' NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"weekdays" jsonb DEFAULT '[1,2,3,4,5]'::jsonb NOT NULL,
	"pay_multiplier" numeric(5, 3) DEFAULT '1.000' NOT NULL,
	"allowance_minor" integer DEFAULT 0 NOT NULL,
	"department_id" uuid,
	"location_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."shift_swap_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"target_employee_id" uuid,
	"accepted_by_id" uuid,
	"status" "hrms"."shift_swap_status" DEFAULT 'open' NOT NULL,
	"reason" text,
	"rejection_reason" text,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hrms"."employees" ADD COLUMN "contracted_hours_per_week" numeric(5, 2) DEFAULT '40.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "hrms"."availability" ADD CONSTRAINT "availability_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."availability" ADD CONSTRAINT "availability_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."coverage_requirements" ADD CONSTRAINT "coverage_requirements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."coverage_requirements" ADD CONSTRAINT "coverage_requirements_pattern_id_shift_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "hrms"."shift_patterns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."coverage_requirements" ADD CONSTRAINT "coverage_requirements_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "hrms"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."coverage_requirements" ADD CONSTRAINT "coverage_requirements_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "hrms"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."open_shifts" ADD CONSTRAINT "open_shifts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."open_shifts" ADD CONSTRAINT "open_shifts_roster_id_rosters_id_fk" FOREIGN KEY ("roster_id") REFERENCES "hrms"."rosters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."open_shifts" ADD CONSTRAINT "open_shifts_pattern_id_shift_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "hrms"."shift_patterns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."open_shifts" ADD CONSTRAINT "open_shifts_claimed_by_id_employees_id_fk" FOREIGN KEY ("claimed_by_id") REFERENCES "hrms"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."roster_assignments" ADD CONSTRAINT "roster_assignments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."roster_assignments" ADD CONSTRAINT "roster_assignments_roster_id_rosters_id_fk" FOREIGN KEY ("roster_id") REFERENCES "hrms"."rosters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."roster_assignments" ADD CONSTRAINT "roster_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."roster_assignments" ADD CONSTRAINT "roster_assignments_pattern_id_shift_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "hrms"."shift_patterns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."rosters" ADD CONSTRAINT "rosters_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."rosters" ADD CONSTRAINT "rosters_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "hrms"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."rosters" ADD CONSTRAINT "rosters_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "hrms"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."rosters" ADD CONSTRAINT "rosters_published_by_id_employees_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "hrms"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."rosters" ADD CONSTRAINT "rosters_created_by_id_employees_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "hrms"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."shift_eligibility" ADD CONSTRAINT "shift_eligibility_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."shift_eligibility" ADD CONSTRAINT "shift_eligibility_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."shift_eligibility" ADD CONSTRAINT "shift_eligibility_pattern_id_shift_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "hrms"."shift_patterns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."shift_patterns" ADD CONSTRAINT "shift_patterns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."shift_patterns" ADD CONSTRAINT "shift_patterns_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "hrms"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."shift_patterns" ADD CONSTRAINT "shift_patterns_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "hrms"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_assignment_id_roster_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "hrms"."roster_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requested_by_id_employees_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "hrms"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_target_employee_id_employees_id_fk" FOREIGN KEY ("target_employee_id") REFERENCES "hrms"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_accepted_by_id_employees_id_fk" FOREIGN KEY ("accepted_by_id") REFERENCES "hrms"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_approved_by_id_employees_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "hrms"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_org_employee_idx" ON "hrms"."availability" USING btree ("org_id","employee_id");--> statement-breakpoint
CREATE INDEX "availability_range_idx" ON "hrms"."availability" USING btree ("org_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "coverage_requirements_org_pattern_idx" ON "hrms"."coverage_requirements" USING btree ("org_id","pattern_id");--> statement-breakpoint
CREATE INDEX "open_shifts_roster_idx" ON "hrms"."open_shifts" USING btree ("roster_id");--> statement-breakpoint
CREATE INDEX "open_shifts_org_date_idx" ON "hrms"."open_shifts" USING btree ("org_id","shift_date");--> statement-breakpoint
CREATE INDEX "roster_assignments_roster_idx" ON "hrms"."roster_assignments" USING btree ("roster_id");--> statement-breakpoint
CREATE INDEX "roster_assignments_employee_date_idx" ON "hrms"."roster_assignments" USING btree ("employee_id","shift_date");--> statement-breakpoint
CREATE INDEX "roster_assignments_org_date_idx" ON "hrms"."roster_assignments" USING btree ("org_id","shift_date");--> statement-breakpoint
CREATE INDEX "rosters_org_period_idx" ON "hrms"."rosters" USING btree ("org_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "rosters_org_status_idx" ON "hrms"."rosters" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_eligibility_employee_pattern_key" ON "hrms"."shift_eligibility" USING btree ("employee_id","pattern_id");--> statement-breakpoint
CREATE INDEX "shift_eligibility_org_idx" ON "hrms"."shift_eligibility" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_patterns_org_code_key" ON "hrms"."shift_patterns" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "shift_patterns_org_active_idx" ON "hrms"."shift_patterns" USING btree ("org_id","is_active");--> statement-breakpoint
CREATE INDEX "shift_swaps_org_status_idx" ON "hrms"."shift_swap_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "shift_swaps_assignment_idx" ON "hrms"."shift_swap_requests" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "shift_swaps_target_idx" ON "hrms"."shift_swap_requests" USING btree ("target_employee_id");