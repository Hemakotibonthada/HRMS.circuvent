CREATE TYPE "hrms"."custom_field_type" AS ENUM('text', 'textarea', 'number', 'currency', 'date', 'boolean', 'select', 'multiselect', 'email', 'phone', 'url');--> statement-breakpoint
CREATE TABLE "hrms"."custom_field_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"changed_by_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"help_text" text,
	"data_type" "hrms"."custom_field_type" NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"required_when" jsonb,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_unique" boolean DEFAULT false NOT NULL,
	"is_pii" boolean DEFAULT false NOT NULL,
	"visible_to_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"editable_by_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"section" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrms"."custom_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"value" jsonb,
	"value_text" text,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hrms"."custom_field_audit" ADD CONSTRAINT "custom_field_audit_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."custom_field_audit" ADD CONSTRAINT "custom_field_audit_definition_id_custom_field_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "hrms"."custom_field_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."custom_field_values" ADD CONSTRAINT "custom_field_values_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identity"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrms"."custom_field_values" ADD CONSTRAINT "custom_field_values_definition_id_custom_field_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "hrms"."custom_field_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_field_audit_definition_idx" ON "hrms"."custom_field_audit" USING btree ("definition_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_definitions_org_entity_key" ON "hrms"."custom_field_definitions" USING btree ("org_id","entity_type","key");--> statement-breakpoint
CREATE INDEX "custom_field_definitions_entity_idx" ON "hrms"."custom_field_definitions" USING btree ("org_id","entity_type","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_values_entity_definition_key" ON "hrms"."custom_field_values" USING btree ("entity_id","definition_id");--> statement-breakpoint
CREATE INDEX "custom_field_values_lookup_idx" ON "hrms"."custom_field_values" USING btree ("org_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "custom_field_values_search_idx" ON "hrms"."custom_field_values" USING btree ("org_id","definition_id","value_text");--> statement-breakpoint
ALTER TABLE "identity"."organizations" DROP COLUMN "custom_fields";--> statement-breakpoint
ALTER TABLE "hrms"."employees" DROP COLUMN "custom_fields";