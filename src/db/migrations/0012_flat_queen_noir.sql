CREATE TABLE "salesapp"."companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"office_address" text NOT NULL,
	"contact_number" varchar(50) NOT NULL,
	"state" varchar(100),
	"district" varchar(100),
	"city" varchar(100),
	"is_head_office" boolean DEFAULT true NOT NULL,
	"admin_user_id" integer NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE "salesapp"."daily_visit_reports" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."dealers" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."distributors" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."geo_tracking" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."influencers" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."instititions" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."journey_breadcrumbs" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."journey_ops" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."journeys" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."mobile_capabilities" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."outlets" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."permanent_journey_plans" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."roles" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."salesman_attendance" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."salesman_leave_applications" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."sync_state" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."ta_da_bill_items" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."ta_da_bills" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."user_mobile_capabilities" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."user_roles" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."users" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."admin_ownership_rules" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."appliance_audit_log" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."approval_requests" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."attention_items" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."capability_assignment_rules" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."device_registrations" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."dynamic_submissions" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."employee_runtime_state" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."usage_events" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."user_pins" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."work_items" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "salesapp"."workspace_settings" ADD COLUMN "company_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_admin_user_id_key" ON "salesapp"."companies" USING btree ("admin_user_id");--> statement-breakpoint
ALTER TABLE "salesapp"."daily_visit_reports" ADD CONSTRAINT "daily_visit_reports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."dealers" ADD CONSTRAINT "dealers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."distributors" ADD CONSTRAINT "distributors_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."geo_tracking" ADD CONSTRAINT "geo_tracking_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."influencers" ADD CONSTRAINT "influencers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."instititions" ADD CONSTRAINT "instititions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."journey_breadcrumbs" ADD CONSTRAINT "journey_breadcrumbs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."journey_ops" ADD CONSTRAINT "journey_ops_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."journeys" ADD CONSTRAINT "journeys_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."mobile_capabilities" ADD CONSTRAINT "mobile_capabilities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."outlets" ADD CONSTRAINT "outlets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."permanent_journey_plans" ADD CONSTRAINT "permanent_journey_plans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."roles" ADD CONSTRAINT "roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."salesman_attendance" ADD CONSTRAINT "salesman_attendance_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."salesman_leave_applications" ADD CONSTRAINT "salesman_leave_applications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."sync_state" ADD CONSTRAINT "sync_state_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."ta_da_bill_items" ADD CONSTRAINT "ta_da_bill_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."ta_da_bills" ADD CONSTRAINT "ta_da_bills_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."user_mobile_capabilities" ADD CONSTRAINT "user_mobile_capabilities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."user_roles" ADD CONSTRAINT "user_roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."users" ADD CONSTRAINT "users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."admin_ownership_rules" ADD CONSTRAINT "admin_ownership_rules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."appliance_audit_log" ADD CONSTRAINT "appliance_audit_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."approval_requests" ADD CONSTRAINT "approval_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."attention_items" ADD CONSTRAINT "attention_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."capability_assignment_rules" ADD CONSTRAINT "capability_assignment_rules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."device_registrations" ADD CONSTRAINT "device_registrations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."dynamic_submissions" ADD CONSTRAINT "dynamic_submissions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."employee_runtime_state" ADD CONSTRAINT "employee_runtime_state_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."usage_events" ADD CONSTRAINT "usage_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."user_pins" ADD CONSTRAINT "user_pins_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."work_items" ADD CONSTRAINT "work_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesapp"."workspace_settings" ADD CONSTRAINT "workspace_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "salesapp"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_daily_visit_reports_company_id" ON "salesapp"."daily_visit_reports" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_dealers_company_id" ON "salesapp"."dealers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_distributors_company_id" ON "salesapp"."distributors" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_geo_tracking_company_id" ON "salesapp"."geo_tracking" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_influencers_company_id" ON "salesapp"."influencers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_instititions_company_id" ON "salesapp"."instititions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_journey_breadcrumbs_company_id" ON "salesapp"."journey_breadcrumbs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_journey_ops_company_id" ON "salesapp"."journey_ops" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_journeys_company_id" ON "salesapp"."journeys" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_mobile_capabilities_company_id" ON "salesapp"."mobile_capabilities" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_outlets_company_id" ON "salesapp"."outlets" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_permanent_journey_plans_company_id" ON "salesapp"."permanent_journey_plans" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_roles_company_id" ON "salesapp"."roles" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_salesman_attendance_company_id" ON "salesapp"."salesman_attendance" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_salesman_leave_applications_company_id" ON "salesapp"."salesman_leave_applications" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_sync_state_company_id" ON "salesapp"."sync_state" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_ta_da_bill_items_company_id" ON "salesapp"."ta_da_bill_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_ta_da_bills_company_id" ON "salesapp"."ta_da_bills" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_user_mobile_capabilities_company_id" ON "salesapp"."user_mobile_capabilities" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_user_roles_company_id" ON "salesapp"."user_roles" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_users_company_id" ON "salesapp"."users" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_admin_ownership_rules_company_id" ON "salesapp"."admin_ownership_rules" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_appliance_audit_log_company_id" ON "salesapp"."appliance_audit_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_company_id" ON "salesapp"."approval_requests" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_attention_items_company_id" ON "salesapp"."attention_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_capability_assignment_rules_company_id" ON "salesapp"."capability_assignment_rules" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_device_registrations_company_id" ON "salesapp"."device_registrations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_dynamic_submissions_company_id" ON "salesapp"."dynamic_submissions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_employee_runtime_state_company_id" ON "salesapp"."employee_runtime_state" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_usage_events_company_id" ON "salesapp"."usage_events" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_user_pins_company_id" ON "salesapp"."user_pins" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_work_items_company_id" ON "salesapp"."work_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_settings_company_id" ON "salesapp"."workspace_settings" USING btree ("company_id");