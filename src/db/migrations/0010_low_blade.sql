CREATE SCHEMA "kamdhenu";
--> statement-breakpoint
CREATE TABLE "kamdhenu"."daily_visit_reports" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_date" date,
	"customer_type" varchar(50),
	"dealer_type" varchar(50),
	"institution_type" varchar(50),
	"influencer_type" varchar(50),
	"visit_type" varchar(50),
	"location" varchar(500),
	"latitude" numeric(20, 7),
	"longitude" numeric(20, 7),
	"brand_selling" text[],
	"name_of_party" varchar(255),
	"contact_no_of_party" varchar(20),
	"expected_activation_date" date,
	"current_dealer_outstanding_amt" numeric(18, 2),
	"today_order_qty" numeric(18, 2),
	"today_collection_rupees" numeric(18, 2),
	"overdue_amount" numeric(18, 2),
	"feedbacks" varchar(500),
	"check_in_time" timestamp (6) with time zone,
	"check_out_time" timestamp (6) with time zone,
	"time_spent_in_loc" varchar(255),
	"in_time_image_url" varchar(500),
	"out_time_image_url" varchar(500),
	"user_id" integer NOT NULL,
	"pjp_id" varchar(255),
	"dealer_id" integer,
	"idempotency_key" varchar(255),
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."dealers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"dealer_party_name" varchar(255) NOT NULL,
	"contact_person_name" varchar(255),
	"contact_person_number" varchar(20),
	"email" varchar(255),
	"gst_no" varchar(50),
	"pan_no" varchar(50),
	"zone" varchar(120),
	"district" varchar(120),
	"area" varchar(120),
	"state" varchar(100),
	"pin_code" varchar(20),
	"address" varchar(500),
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_verified" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."distributors" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"name" varchar(255) NOT NULL,
	"concerned_person_name" varchar(255) NOT NULL,
	"concerned_person_phone_num" varchar(50) NOT NULL,
	"area" varchar(120),
	"zone" varchar(120),
	"state" varchar(100),
	"district" varchar(120),
	"city" varchar(120),
	"address" varchar(500) NOT NULL,
	"pin_code" varchar(20),
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"gst_number" varchar(50),
	"store_image" varchar(500),
	"date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."geo_tracking" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"latitude" numeric(10, 7) NOT NULL,
	"longitude" numeric(10, 7) NOT NULL,
	"recorded_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"accuracy" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"total_distance_travelled" numeric(10, 3),
	"location_type" varchar(50),
	"check_in_time" timestamp(6) with time zone,
	"check_out_time" timestamp(6) with time zone,
	"dest_lat" numeric(10, 7),
	"dest_lng" numeric(10, 7),
	"journey_id" text,
	"dealer_id" integer,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."influencers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"contact_person_name" varchar(255),
	"contact_person_number" varchar(20),
	"email" varchar(255),
	"zone" varchar(120),
	"district" varchar(120),
	"area" varchar(120),
	"state" varchar(100),
	"pin_code" varchar(20),
	"address" varchar(500),
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_verified" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."instititions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"institution_name" varchar(255) NOT NULL,
	"contact_person_name" varchar(255),
	"contact_person_number" varchar(20),
	"email" varchar(255),
	"gst_no" varchar(50),
	"pan_no" varchar(50),
	"zone" varchar(120),
	"district" varchar(120),
	"area" varchar(120),
	"state" varchar(100),
	"pin_code" varchar(20),
	"address" varchar(500),
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_verified" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."journey_breadcrumbs" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"journey_id" varchar(255) NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"total_distance" double precision DEFAULT 0 NOT NULL,
	"h3_index" varchar(15),
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"is_synced" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."journey_ops" (
	"server_seq" bigserial PRIMARY KEY NOT NULL,
	"op_id" uuid NOT NULL,
	"journey_id" varchar(255) NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"app_role" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journey_ops_op_id_key" UNIQUE("op_id")
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."journeys" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"pjp_id" varchar(255),
	"dealer_id" integer,
	"dest_name" varchar(255),
	"dest_lat" numeric(10, 7),
	"dest_lng" numeric(10, 7),
	"status" varchar(50) DEFAULT 'ACTIVE' NOT NULL,
	"is_active" boolean DEFAULT true,
	"start_time" timestamp with time zone DEFAULT now() NOT NULL,
	"end_time" timestamp with time zone,
	"total_distance" numeric(10, 3) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_synced" boolean DEFAULT false,
	"app_role" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."outlets" (
	"id" serial PRIMARY KEY NOT NULL,
	"distributor_id" integer,
	"user_id" integer,
	"name" varchar(255) NOT NULL,
	"concerned_person_name" varchar(255) NOT NULL,
	"concerned_person_phone_num" varchar(50) NOT NULL,
	"area" varchar(120),
	"zone" varchar(120),
	"state" varchar(100),
	"district" varchar(120),
	"city" varchar(120),
	"address" varchar(500) NOT NULL,
	"pin_code" varchar(20),
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"gst_number" varchar(50),
	"store_image" varchar(500),
	"date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."permanent_journey_plans" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_by_id" integer NOT NULL,
	"plan_date" date NOT NULL,
	"area_to_be_visited" varchar(500) NOT NULL,
	"description" varchar(500),
	"status" varchar(50) NOT NULL,
	"verification_status" varchar(50),
	"additional_visit_remarks" varchar(500),
	"route" varchar(500),
	"diversion_reason" varchar(500),
	"no_of_dealer_visits" integer,
	"no_of_institution_visits" integer,
	"no_of_influencer_visits" integer,
	"dealer_id" integer,
	"bulk_op_id" varchar(50),
	"institution_id" integer,
	"influencer_id" integer,
	"idempotency_key" varchar(120),
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_role" varchar(100),
	"job_role" varchar(100),
	"granted_perms" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"perm_description" varchar(255),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."salesman_attendance" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"attendance_date" date NOT NULL,
	"location_name" varchar(500) NOT NULL,
	"in_time_timestamp" timestamp(6) with time zone NOT NULL,
	"out_time_timestamp" timestamp(6) with time zone,
	"in_time_image_captured" boolean NOT NULL,
	"out_time_image_captured" boolean NOT NULL,
	"in_time_image_url" varchar(500),
	"out_time_image_url" varchar(500),
	"in_time_latitude" numeric(10, 7) NOT NULL,
	"in_time_longitude" numeric(10, 7) NOT NULL,
	"out_time_latitude" numeric(10, 7),
	"out_time_longitude" numeric(10, 7),
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"role" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."salesman_leave_applications" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"leave_type" varchar(100) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" varchar(500) NOT NULL,
	"status" varchar(50) NOT NULL,
	"admin_remarks" varchar(500),
	"app_role" varchar(50),
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."sync_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_server_seq" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "one_row_only" CHECK (id = 1)
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."ta_da_bill_items" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" varchar(255) NOT NULL,
	"from_location" varchar(255),
	"to_location" varchar(255),
	"distance_travelled_km" numeric(18, 2),
	"transport_fare" numeric(18, 2) DEFAULT '0',
	"lodging_fare" numeric(18, 2) DEFAULT '0',
	"fooding_fare" numeric(18, 2) DEFAULT '0',
	"local_conveyance" numeric(18, 2) DEFAULT '0',
	"out_of_pocket_paid" numeric(18, 2) DEFAULT '0',
	"total_bills_added" integer DEFAULT 0,
	"bill_photo_urls" text[],
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."ta_da_bills" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"from_date" date,
	"to_date" date,
	"bill_date" date NOT NULL,
	"daily_allowance" numeric(18, 2) DEFAULT '0',
	"total_cost" numeric(18, 2) DEFAULT '0',
	"status" varchar(50) DEFAULT 'PENDING',
	"remarks" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."user_roles" (
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "kamdhenu"."users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"username" text,
	"phone_number" varchar(50),
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"area" varchar(100),
	"zone" varchar(100),
	"is_dashboard_user" boolean DEFAULT false NOT NULL,
	"dashboard_login_id" text,
	"dashboard_hashed_password" text,
	"is_sales_app_user" boolean DEFAULT false NOT NULL,
	"salesman_login_id" text,
	"sales_app_password" text,
	"reports_to_id" integer,
	"device_id" varchar(255),
	"fcm_token" varchar(500),
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
	"updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "uniq_user_device_id" UNIQUE("device_id")
);
--> statement-breakpoint
DROP TABLE "eurofoam"."daily_visit_reports" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."dealers" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."geo_tracking" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."influencers" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."instititions" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."journey_breadcrumbs" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."journey_ops" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."journeys" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."permanent_journey_plans" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."roles" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."salesman_attendance" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."salesman_leave_applications" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."sync_state" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."ta_da_bill_items" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."ta_da_bills" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."user_roles" CASCADE;--> statement-breakpoint
DROP TABLE "eurofoam"."users" CASCADE;--> statement-breakpoint
ALTER TABLE "kamdhenu"."daily_visit_reports" ADD CONSTRAINT "daily_visit_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "kamdhenu"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kamdhenu"."daily_visit_reports" ADD CONSTRAINT "daily_visit_reports_pjp_id_fkey" FOREIGN KEY ("pjp_id") REFERENCES "kamdhenu"."permanent_journey_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kamdhenu"."daily_visit_reports" ADD CONSTRAINT "daily_visit_reports_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "kamdhenu"."dealers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kamdhenu"."dealers" ADD CONSTRAINT "dealers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "kamdhenu"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kamdhenu"."distributors" ADD CONSTRAINT "distributors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "kamdhenu"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kamdhenu"."geo_tracking" ADD CONSTRAINT "geo_tracking_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "kamdhenu"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kamdhenu"."geo_tracking" ADD CONSTRAINT "geo_tracking_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "kamdhenu"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kamdhenu"."geo_tracking" ADD CONSTRAINT "geo_tracking_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "kamdhenu"."dealers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kamdhenu"."influencers" ADD CONSTRAINT "influencers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "kamdhenu"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kamdhenu"."instititions" ADD CONSTRAINT "institutions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "kamdhenu"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kamdhenu"."journey_breadcrumbs" ADD CONSTRAINT "journey_breadcrumbs_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "kamdhenu"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kamdhenu"."journey_ops" ADD CONSTRAINT "fk_journey_ops_user" FOREIGN KEY ("user_id") REFERENCES "kamdhenu"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kamdhenu"."journey_ops" ADD CONSTRAINT "fk_journey_ops_journey" FOREIGN KEY ("journey_id") REFERENCES "kamdhenu"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kamdhenu"."journeys" ADD CONSTRAINT "journeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "kamdhenu"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kamdhenu"."journeys" ADD CONSTRAINT "journeys_pjp_id_fkey" FOREIGN KEY ("pjp_id") REFERENCES "kamdhenu"."permanent_journey_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kamdhenu"."journeys" ADD CONSTRAINT "journeys_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "kamdhenu"."dealers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kamdhenu"."outlets" ADD CONSTRAINT "outlets_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "kamdhenu"."distributors"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kamdhenu"."outlets" ADD CONSTRAINT "outlets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "kamdhenu"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kamdhenu"."permanent_journey_plans" ADD CONSTRAINT "permanent_journey_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "kamdhenu"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kamdhenu"."permanent_journey_plans" ADD CONSTRAINT "permanent_journey_plans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "kamdhenu"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kamdhenu"."permanent_journey_plans" ADD CONSTRAINT "permanent_journey_plans_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "kamdhenu"."dealers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kamdhenu"."permanent_journey_plans" ADD CONSTRAINT "permanent_journey_plans_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "kamdhenu"."instititions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kamdhenu"."permanent_journey_plans" ADD CONSTRAINT "permanent_journey_plans_influencer_id_fkey" FOREIGN KEY ("influencer_id") REFERENCES "kamdhenu"."influencers"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kamdhenu"."salesman_attendance" ADD CONSTRAINT "salesman_attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "kamdhenu"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kamdhenu"."salesman_leave_applications" ADD CONSTRAINT "salesman_leave_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "kamdhenu"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kamdhenu"."ta_da_bill_items" ADD CONSTRAINT "ta_da_bill_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "kamdhenu"."ta_da_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kamdhenu"."ta_da_bills" ADD CONSTRAINT "ta_da_bills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "kamdhenu"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kamdhenu"."user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "kamdhenu"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kamdhenu"."user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "kamdhenu"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kamdhenu"."users" ADD CONSTRAINT "users_reports_to_id_fkey" FOREIGN KEY ("reports_to_id") REFERENCES "kamdhenu"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_daily_visit_reports_user_id" ON "kamdhenu"."daily_visit_reports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_daily_visit_reports_pjp_id" ON "kamdhenu"."daily_visit_reports" USING btree ("pjp_id");--> statement-breakpoint
CREATE INDEX "idx_verified_zone" ON "kamdhenu"."dealers" USING btree ("zone");--> statement-breakpoint
CREATE INDEX "idx_verified_district" ON "kamdhenu"."dealers" USING btree ("district");--> statement-breakpoint
CREATE INDEX "idx_verified_pincode" ON "kamdhenu"."dealers" USING btree ("pin_code");--> statement-breakpoint
CREATE INDEX "idx_verified_gst" ON "kamdhenu"."dealers" USING btree ("gst_no");--> statement-breakpoint
CREATE INDEX "idx_geo_active" ON "kamdhenu"."geo_tracking" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_geo_dealer_id" ON "kamdhenu"."geo_tracking" USING btree ("dealer_id");--> statement-breakpoint
CREATE INDEX "idx_geo_journey_time" ON "kamdhenu"."geo_tracking" USING btree ("journey_id","recorded_at");--> statement-breakpoint
CREATE INDEX "idx_geo_tracking_recorded_at" ON "kamdhenu"."geo_tracking" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "idx_geo_tracking_user_id" ON "kamdhenu"."geo_tracking" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_geo_user_time" ON "kamdhenu"."geo_tracking" USING btree ("user_id","recorded_at");--> statement-breakpoint
CREATE INDEX "idx_influencer_verified_zone" ON "kamdhenu"."influencers" USING btree ("zone");--> statement-breakpoint
CREATE INDEX "idx_influencer_verified_district" ON "kamdhenu"."influencers" USING btree ("district");--> statement-breakpoint
CREATE INDEX "idx_influencer_verified_pincode" ON "kamdhenu"."influencers" USING btree ("pin_code");--> statement-breakpoint
CREATE INDEX "idx_institute_verified_zone" ON "kamdhenu"."instititions" USING btree ("zone");--> statement-breakpoint
CREATE INDEX "idx_institute_verified_district" ON "kamdhenu"."instititions" USING btree ("district");--> statement-breakpoint
CREATE INDEX "idx_institute_verified_pincode" ON "kamdhenu"."instititions" USING btree ("pin_code");--> statement-breakpoint
CREATE INDEX "idx_institute_verified_gst" ON "kamdhenu"."instititions" USING btree ("gst_no");--> statement-breakpoint
CREATE INDEX "idx_breadcrumbs_h3" ON "kamdhenu"."journey_breadcrumbs" USING btree ("h3_index");--> statement-breakpoint
CREATE INDEX "idx_breadcrumbs_journey_time" ON "kamdhenu"."journey_breadcrumbs" USING btree ("journey_id","recorded_at");--> statement-breakpoint
CREATE INDEX "idx_journey_ops_created" ON "kamdhenu"."journey_ops" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_journey_ops_journey" ON "kamdhenu"."journey_ops" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "idx_journey_ops_server_seq" ON "kamdhenu"."journey_ops" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "idx_journey_ops_user" ON "kamdhenu"."journey_ops" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_journeys_user_status" ON "kamdhenu"."journeys" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_permanent_journey_plans_created_by_id" ON "kamdhenu"."permanent_journey_plans" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "idx_permanent_journey_plans_user_id" ON "kamdhenu"."permanent_journey_plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_pjp_bulk_op_id" ON "kamdhenu"."permanent_journey_plans" USING btree ("bulk_op_id");--> statement-breakpoint
CREATE INDEX "idx_pjp_dealer_id" ON "kamdhenu"."permanent_journey_plans" USING btree ("dealer_id");--> statement-breakpoint
CREATE INDEX "idx_pjp_institution_id" ON "kamdhenu"."permanent_journey_plans" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "idx_pjp_influencer_id" ON "kamdhenu"."permanent_journey_plans" USING btree ("influencer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_pjp_idempotency_key_not_null" ON "kamdhenu"."permanent_journey_plans" USING btree ("idempotency_key") WHERE (idempotency_key IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_pjp_user_dealer_plan_date" ON "kamdhenu"."permanent_journey_plans" USING btree ("user_id","dealer_id","plan_date");--> statement-breakpoint
CREATE INDEX "idx_salesman_attendance_user_id" ON "kamdhenu"."salesman_attendance" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_salesman_leave_applications_user_id" ON "kamdhenu"."salesman_leave_applications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ta_da_bill_items_bill_id" ON "kamdhenu"."ta_da_bill_items" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "idx_ta_da_bills_user_id" ON "kamdhenu"."ta_da_bills" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_device_id" ON "kamdhenu"."users" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_salesman_login_id_key" ON "kamdhenu"."users" USING btree ("salesman_login_id");--> statement-breakpoint
CREATE INDEX "idx_users_reports_to_id" ON "kamdhenu"."users" USING btree ("reports_to_id");--> statement-breakpoint
DROP SCHEMA "eurofoam";
