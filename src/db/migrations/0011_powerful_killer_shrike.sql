ALTER SCHEMA "kamdhenu" RENAME TO "salesapp";
--> statement-breakpoint
CREATE TABLE "salesapp"."mobile_capabilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(120) NOT NULL,
	"title" varchar(160) NOT NULL,
	"type" varchar(50) NOT NULL,
	"description" text,
	"icon" varchar(80),
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salesapp"."user_mobile_capabilities" (
	"user_id" integer NOT NULL,
	"capability_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_mobile_capabilities_user_id_capability_id_pk" PRIMARY KEY("user_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "salesapp"."admin_ownership_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"area_key" varchar(120) NOT NULL,
	"scope_type" varchar(40) DEFAULT 'organization' NOT NULL,
	"scope_value" varchar(180),
	"primary_admin_user_id" integer,
	"fallback_admin_user_id" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"sla_minutes" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salesapp"."appliance_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" integer,
	"actor_type" varchar(40) DEFAULT 'admin' NOT NULL,
	"action" varchar(180) NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" varchar(255),
	"before_state" jsonb,
	"after_state" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salesapp"."approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" varchar(60) NOT NULL,
	"source_id" varchar(255) NOT NULL,
	"area_key" varchar(120) NOT NULL,
	"title" varchar(220) NOT NULL,
	"requester_user_id" integer,
	"assigned_admin_user_id" integer,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" integer,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salesapp"."attention_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_key" varchar(120) NOT NULL,
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"title" varchar(220) NOT NULL,
	"body" text,
	"entity_type" varchar(80),
	"entity_id" varchar(255),
	"assigned_admin_user_id" integer,
	"status" varchar(30) DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" integer
);
--> statement-breakpoint
CREATE TABLE "salesapp"."capability_assignment_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"capability_id" integer NOT NULL,
	"subject_type" varchar(40) NOT NULL,
	"subject_value" varchar(180),
	"effect" varchar(16) DEFAULT 'allow' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salesapp"."device_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"device_id" varchar(255) NOT NULL,
	"platform" varchar(40) NOT NULL,
	"app_version" varchar(80),
	"push_token" varchar(700),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salesapp"."dynamic_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_mutation_id" uuid NOT NULL,
	"user_id" integer NOT NULL,
	"capability_id" integer NOT NULL,
	"work_item_id" uuid,
	"status" varchar(40) DEFAULT 'submitted' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"client_created_at" timestamp with time zone,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"server_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_submissions_client_mutation_id_key" UNIQUE("client_mutation_id")
);
--> statement-breakpoint
CREATE TABLE "salesapp"."employee_runtime_state" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_bootstrap_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"current_device_id" varchar(255),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salesapp"."usage_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" integer,
	"surface" varchar(40) NOT NULL,
	"action_key" varchar(160) NOT NULL,
	"entity_type" varchar(80),
	"entity_id" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salesapp"."user_pins" (
	"user_id" integer NOT NULL,
	"surface" varchar(40) NOT NULL,
	"item_key" varchar(160) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_pins_user_id_surface_item_key_pk" PRIMARY KEY("user_id","surface","item_key")
);
--> statement-breakpoint
CREATE TABLE "salesapp"."work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capability_id" integer,
	"assignee_user_id" integer NOT NULL,
	"created_by_user_id" integer,
	"title" varchar(220) NOT NULL,
	"description" text,
	"status" varchar(40) DEFAULT 'assigned' NOT NULL,
	"priority" varchar(20) DEFAULT 'normal' NOT NULL,
	"due_at" timestamp with time zone,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approval_required" boolean DEFAULT false NOT NULL,
	"approval_area_key" varchar(120),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salesapp"."workspace_settings" (
	"key" varchar(120) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_user_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salesapp"."daily_visit_reports" DROP CONSTRAINT "daily_visit_reports_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."daily_visit_reports" DROP CONSTRAINT "daily_visit_reports_pjp_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."daily_visit_reports" DROP CONSTRAINT "daily_visit_reports_dealer_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."dealers" DROP CONSTRAINT "dealers_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."distributors" DROP CONSTRAINT "distributors_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."geo_tracking" DROP CONSTRAINT "geo_tracking_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."geo_tracking" DROP CONSTRAINT "geo_tracking_journey_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."geo_tracking" DROP CONSTRAINT "geo_tracking_dealer_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."influencers" DROP CONSTRAINT "influencers_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."instititions" DROP CONSTRAINT "institutions_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."journey_breadcrumbs" DROP CONSTRAINT "journey_breadcrumbs_journey_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."journey_ops" DROP CONSTRAINT "fk_journey_ops_user";
--> statement-breakpoint
ALTER TABLE "salesapp"."journey_ops" DROP CONSTRAINT "fk_journey_ops_journey";
--> statement-breakpoint
ALTER TABLE "salesapp"."journeys" DROP CONSTRAINT "journeys_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."journeys" DROP CONSTRAINT "journeys_pjp_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."journeys" DROP CONSTRAINT "journeys_dealer_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."outlets" DROP CONSTRAINT "outlets_distributor_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."outlets" DROP CONSTRAINT "outlets_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."permanent_journey_plans" DROP CONSTRAINT "permanent_journey_plans_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."permanent_journey_plans" DROP CONSTRAINT "permanent_journey_plans_created_by_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."permanent_journey_plans" DROP CONSTRAINT "permanent_journey_plans_dealer_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."permanent_journey_plans" DROP CONSTRAINT "permanent_journey_plans_institution_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."permanent_journey_plans" DROP CONSTRAINT "permanent_journey_plans_influencer_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."salesman_attendance" DROP CONSTRAINT "salesman_attendance_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."salesman_leave_applications" DROP CONSTRAINT "salesman_leave_applications_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."ta_da_bill_items" DROP CONSTRAINT "ta_da_bill_items_bill_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."ta_da_bills" DROP CONSTRAINT "ta_da_bills_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."user_roles" DROP CONSTRAINT "user_roles_user_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."user_roles" DROP CONSTRAINT "user_roles_role_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."users" DROP CONSTRAINT "users_reports_to_id_fkey";
--> statement-breakpoint
ALTER TABLE "salesapp"."users" ADD COLUMN "display_name" varchar(160);--> statement-breakpoint
ALTER TABLE "salesapp"."users" ADD COLUMN "department" varchar(160);--> statement-breakpoint
ALTER TABLE "salesapp"."users" ADD COLUMN "designation" varchar(160);--> statement-breakpoint
ALTER TABLE "salesapp"."users" ADD COLUMN "sales_app_password_hash" text;--> statement-breakpoint
ALTER TABLE "salesapp"."user_mobile_capabilities" ADD CONSTRAINT "user_mobile_capabilities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."user_mobile_capabilities" ADD CONSTRAINT "user_mobile_capabilities_capability_id_fkey" FOREIGN KEY ("capability_id") REFERENCES "salesapp"."mobile_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."admin_ownership_rules" ADD CONSTRAINT "admin_ownership_rules_primary_admin_user_id_fkey" FOREIGN KEY ("primary_admin_user_id") REFERENCES "salesapp"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."admin_ownership_rules" ADD CONSTRAINT "admin_ownership_rules_fallback_admin_user_id_fkey" FOREIGN KEY ("fallback_admin_user_id") REFERENCES "salesapp"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."admin_ownership_rules" ADD CONSTRAINT "admin_ownership_rules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "salesapp"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."appliance_audit_log" ADD CONSTRAINT "appliance_audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "salesapp"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."approval_requests" ADD CONSTRAINT "approval_requests_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "salesapp"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."approval_requests" ADD CONSTRAINT "approval_requests_assigned_admin_user_id_fkey" FOREIGN KEY ("assigned_admin_user_id") REFERENCES "salesapp"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."approval_requests" ADD CONSTRAINT "approval_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "salesapp"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."attention_items" ADD CONSTRAINT "attention_items_assigned_admin_user_id_fkey" FOREIGN KEY ("assigned_admin_user_id") REFERENCES "salesapp"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."attention_items" ADD CONSTRAINT "attention_items_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "salesapp"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."capability_assignment_rules" ADD CONSTRAINT "capability_assignment_rules_capability_id_fkey" FOREIGN KEY ("capability_id") REFERENCES "salesapp"."mobile_capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."capability_assignment_rules" ADD CONSTRAINT "capability_assignment_rules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "salesapp"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."device_registrations" ADD CONSTRAINT "device_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."dynamic_submissions" ADD CONSTRAINT "dynamic_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."dynamic_submissions" ADD CONSTRAINT "dynamic_submissions_capability_id_fkey" FOREIGN KEY ("capability_id") REFERENCES "salesapp"."mobile_capabilities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."dynamic_submissions" ADD CONSTRAINT "dynamic_submissions_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "salesapp"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."employee_runtime_state" ADD CONSTRAINT "employee_runtime_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."usage_events" ADD CONSTRAINT "usage_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "salesapp"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."user_pins" ADD CONSTRAINT "user_pins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."work_items" ADD CONSTRAINT "work_items_capability_id_fkey" FOREIGN KEY ("capability_id") REFERENCES "salesapp"."mobile_capabilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."work_items" ADD CONSTRAINT "work_items_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "salesapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."work_items" ADD CONSTRAINT "work_items_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "salesapp"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."workspace_settings" ADD CONSTRAINT "workspace_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "salesapp"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_capabilities_key_key" ON "salesapp"."mobile_capabilities" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idx_admin_ownership_rules_area" ON "salesapp"."admin_ownership_rules" USING btree ("area_key");--> statement-breakpoint
CREATE INDEX "idx_admin_ownership_rules_scope" ON "salesapp"."admin_ownership_rules" USING btree ("scope_type","scope_value");--> statement-breakpoint
CREATE INDEX "idx_appliance_audit_log_entity" ON "salesapp"."appliance_audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_appliance_audit_log_actor" ON "salesapp"."appliance_audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_status" ON "salesapp"."approval_requests" USING btree ("status","assigned_admin_user_id");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_area" ON "salesapp"."approval_requests" USING btree ("area_key");--> statement-breakpoint
CREATE INDEX "idx_attention_items_status" ON "salesapp"."attention_items" USING btree ("status","assigned_admin_user_id");--> statement-breakpoint
CREATE INDEX "idx_attention_items_area" ON "salesapp"."attention_items" USING btree ("area_key");--> statement-breakpoint
CREATE INDEX "idx_capability_assignment_rules_capability" ON "salesapp"."capability_assignment_rules" USING btree ("capability_id");--> statement-breakpoint
CREATE INDEX "idx_capability_assignment_rules_subject" ON "salesapp"."capability_assignment_rules" USING btree ("subject_type","subject_value");--> statement-breakpoint
CREATE INDEX "idx_capability_assignment_rules_enabled" ON "salesapp"."capability_assignment_rules" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "device_registrations_user_device_key" ON "salesapp"."device_registrations" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE INDEX "idx_device_registrations_last_seen" ON "salesapp"."device_registrations" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_dynamic_submissions_user" ON "salesapp"."dynamic_submissions" USING btree ("user_id","submitted_at");--> statement-breakpoint
CREATE INDEX "idx_dynamic_submissions_capability" ON "salesapp"."dynamic_submissions" USING btree ("capability_id");--> statement-breakpoint
CREATE INDEX "idx_employee_runtime_state_last_seen" ON "salesapp"."employee_runtime_state" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_usage_events_actor_action" ON "salesapp"."usage_events" USING btree ("actor_user_id","action_key");--> statement-breakpoint
CREATE INDEX "idx_usage_events_occurred_at" ON "salesapp"."usage_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_work_items_assignee_status" ON "salesapp"."work_items" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "idx_work_items_due_at" ON "salesapp"."work_items" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "idx_work_items_capability" ON "salesapp"."work_items" USING btree ("capability_id");--> statement-breakpoint
ALTER TABLE "salesapp"."daily_visit_reports" ADD CONSTRAINT "daily_visit_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."daily_visit_reports" ADD CONSTRAINT "daily_visit_reports_pjp_id_fkey" FOREIGN KEY ("pjp_id") REFERENCES "salesapp"."permanent_journey_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."daily_visit_reports" ADD CONSTRAINT "daily_visit_reports_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "salesapp"."dealers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."dealers" ADD CONSTRAINT "dealers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salesapp"."distributors" ADD CONSTRAINT "distributors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salesapp"."geo_tracking" ADD CONSTRAINT "geo_tracking_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salesapp"."geo_tracking" ADD CONSTRAINT "geo_tracking_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "salesapp"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."geo_tracking" ADD CONSTRAINT "geo_tracking_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "salesapp"."dealers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."influencers" ADD CONSTRAINT "influencers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salesapp"."instititions" ADD CONSTRAINT "institutions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salesapp"."journey_breadcrumbs" ADD CONSTRAINT "journey_breadcrumbs_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "salesapp"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."journey_ops" ADD CONSTRAINT "fk_journey_ops_user" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salesapp"."journey_ops" ADD CONSTRAINT "fk_journey_ops_journey" FOREIGN KEY ("journey_id") REFERENCES "salesapp"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."journeys" ADD CONSTRAINT "journeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."journeys" ADD CONSTRAINT "journeys_pjp_id_fkey" FOREIGN KEY ("pjp_id") REFERENCES "salesapp"."permanent_journey_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."journeys" ADD CONSTRAINT "journeys_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "salesapp"."dealers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."outlets" ADD CONSTRAINT "outlets_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "salesapp"."distributors"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salesapp"."outlets" ADD CONSTRAINT "outlets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salesapp"."permanent_journey_plans" ADD CONSTRAINT "permanent_journey_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salesapp"."permanent_journey_plans" ADD CONSTRAINT "permanent_journey_plans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "salesapp"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salesapp"."permanent_journey_plans" ADD CONSTRAINT "permanent_journey_plans_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "salesapp"."dealers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salesapp"."permanent_journey_plans" ADD CONSTRAINT "permanent_journey_plans_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "salesapp"."instititions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salesapp"."permanent_journey_plans" ADD CONSTRAINT "permanent_journey_plans_influencer_id_fkey" FOREIGN KEY ("influencer_id") REFERENCES "salesapp"."influencers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salesapp"."salesman_attendance" ADD CONSTRAINT "salesman_attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salesapp"."salesman_leave_applications" ADD CONSTRAINT "salesman_leave_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "salesapp"."ta_da_bill_items" ADD CONSTRAINT "ta_da_bill_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "salesapp"."ta_da_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."ta_da_bills" ADD CONSTRAINT "ta_da_bills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "salesapp"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "salesapp"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."users" ADD CONSTRAINT "users_reports_to_id_fkey" FOREIGN KEY ("reports_to_id") REFERENCES "salesapp"."users"("id") ON DELETE set null ON UPDATE cascade;