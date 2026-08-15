// drizzle/schema.ts
import {
	pgSchema, uniqueIndex, foreignKey, varchar, text, numeric, timestamp,
	index, integer, date, uuid, boolean, unique, serial, jsonb, doublePrecision,
	bigserial, check, bigint, primaryKey,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const myCustomSchema = pgSchema("kamdhenu");

export const users = myCustomSchema.table("users", {
	id: serial().primaryKey().notNull(),
	email: text().notNull(),
	username: text("username"),
	phoneNumber: varchar("phone_number", { length: 50 }),
	role: text().notNull(),
	status: text().default("active").notNull(),
	area: varchar("area", { length: 100 }),
	zone: varchar("zone", { length: 100 }),

	isDashboardUser: boolean("is_dashboard_user").default(false).notNull(),
	dashboardLoginId: text("dashboard_login_id"),
	dashboardHashedPassword: text("dashboard_hashed_password"),

	isSalesAppUser: boolean("is_sales_app_user").default(false).notNull(),
	salesmanLoginId: text("salesman_login_id"),
	salesAppPassword: text("sales_app_password"),
	displayName: varchar("display_name", { length: 160 }),
	department: varchar("department", { length: 160 }),
	designation: varchar("designation", { length: 160 }),
	salesAppPasswordHash: text("sales_app_password_hash"),

	reportsToId: integer("reports_to_id"),
	deviceId: varchar("device_id", { length: 255 }),
	fcmToken: varchar("fcm_token", { length: 500 }),
	createdAt: timestamp("created_at", { precision: 6, withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_user_device_id").using("btree", table.deviceId.asc().nullsLast()),
	uniqueIndex("users_salesman_login_id_key").using("btree", table.salesmanLoginId.asc().nullsLast()),
	foreignKey({
		columns: [table.reportsToId],
		foreignColumns: [table.id],
		name: "users_reports_to_id_fkey"
	}).onUpdate("cascade").onDelete("set null"),
	unique("uniq_user_device_id").on(table.deviceId),
	index("idx_users_reports_to_id").on(table.reportsToId),
]);

export const roles = myCustomSchema.table("roles", {
	id: serial("id").primaryKey(),
	orgRole: varchar("org_role", { length: 100 }), // e.g., 'President', 'General Manager', 'Executive'
	jobRole: varchar("job_role", { length: 100 }), // e.g., 'Sales', 'Technical Sales', 'IT', 'MIS'
	grantedPerms: text("granted_perms").array().notNull().default(sql`ARRAY[]::text[]`),
	permDescription: varchar("perm_description", { length: 255 }),
	createdAt: timestamp("created_at").defaultNow(),
	updatedAt: timestamp("updated_at").defaultNow(),
});

export const userRoles = myCustomSchema.table("user_roles", {
	userId: integer("user_id").notNull(),
	roleId: integer("role_id").notNull(),
}, (t) => [
	primaryKey({ columns: [t.userId, t.roleId] }),
	foreignKey({
		columns: [t.userId],
		foreignColumns: [users.id],
		name: "user_roles_user_id_fkey",
	}).onDelete("cascade"),

	foreignKey({
		columns: [t.roleId],
		foreignColumns: [roles.id],
		name: "user_roles_role_id_fkey",
	}).onDelete("cascade"),
]);

export const dealers = myCustomSchema.table("dealers", {
	id: serial("id").primaryKey(),
	userId: integer("user_id").notNull(),
	dealerPartyName: varchar("dealer_party_name", { length: 255 }).notNull(),
	contactPersonName: varchar("contact_person_name", { length: 255 }),
	contactPersonNumber: varchar("contact_person_number", { length: 20 }),
	email: varchar("email", { length: 255 }),
	gstNo: varchar("gst_no", { length: 50 }),
	panNo: varchar("pan_no", { length: 50 }),
	zone: varchar("zone", { length: 120 }),
	district: varchar("district", { length: 120 }),
	area: varchar("area", { length: 120 }),
	state: varchar("state", { length: 100 }),
	pinCode: varchar("pin_code", { length: 20 }),
	address: varchar("address", { length: 500 }),
	latitude: numeric("latitude", { precision: 10, scale: 7 }),
	longitude: numeric("longitude", { precision: 10, scale: 7 }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	isVerified: boolean("is_verified").default(false),
}, (t) => [
	index("idx_verified_zone").on(t.zone),
	index("idx_verified_district").on(t.district),
	index("idx_verified_pincode").on(t.pinCode),
	index("idx_verified_gst").on(t.gstNo),
	foreignKey({
		columns: [t.userId],
		foreignColumns: [users.id],
		name: "dealers_user_id_fkey",
	}).onDelete("restrict").onUpdate("cascade"),
]);

export const mobileCapabilities = myCustomSchema.table(
	"mobile_capabilities",
	{
		id: serial("id").primaryKey(),

		key: varchar("key", { length: 120 }).notNull(),

		title: varchar("title", { length: 160 }).notNull(),

		type: varchar("type", { length: 50 }).notNull(),

		description: text("description"),

		icon: varchar("icon", { length: 80 }),

		config: jsonb("config")
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),

		isActive: boolean("is_active")
			.notNull()
			.default(true),

		createdAt: timestamp("created_at", {
			withTimezone: true,
		})
			.notNull()
			.defaultNow(),

		updatedAt: timestamp("updated_at", {
			withTimezone: true,
		})
			.notNull()
			.defaultNow(),
	},
	(table) => [
		uniqueIndex("mobile_capabilities_key_key")
			.on(table.key),
	],
);

export const userMobileCapabilities = myCustomSchema.table(
	"user_mobile_capabilities",
	{
		userId: integer("user_id").notNull(),

		capabilityId: integer("capability_id").notNull(),

		sortOrder: integer("sort_order")
			.notNull()
			.default(0),
	},
	(table) => [
		primaryKey({
			columns: [
				table.userId,
				table.capabilityId,
			],
		}),

		foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_mobile_capabilities_user_id_fkey",
		}).onDelete("cascade"),

		foreignKey({
			columns: [table.capabilityId],
			foreignColumns: [mobileCapabilities.id],
			name: "user_mobile_capabilities_capability_id_fkey",
		}).onDelete("cascade"),
	],
);

export const distributors = myCustomSchema.table("distributors", {
	id: serial("id").primaryKey(),
	userId: integer("user_id"),
	name: varchar("name", { length: 255 }).notNull(),
	concernedPersonName: varchar("concerned_person_name", { length: 255 }).notNull(),
	concernedPersonPhoneNum: varchar("concerned_person_phone_num", { length: 50 }).notNull(),
	area: varchar("area", { length: 120 }),
	zone: varchar("zone", { length: 120 }),
	state: varchar("state", { length: 100 }),
	district: varchar("district", { length: 120 }),
	city: varchar("city", { length: 120 }),
	address: varchar("address", { length: 500 }).notNull(),
	pinCode: varchar("pin_code", { length: 20 }),
	latitude: numeric("latitude", { precision: 10, scale: 7 }),
	longitude: numeric("longitude", { precision: 10, scale: 7 }),
	gstNumber: varchar("gst_number", { length: 50 }),
	storeImage: varchar("store_image", { length: 500 }),
	date: date("date"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
	foreignKey({
		columns: [t.userId],
		foreignColumns: [users.id],
		name: "distributors_user_id_fkey",
	}).onDelete("restrict").onUpdate("cascade"),
]);

export const outlets = myCustomSchema.table("outlets", {
	id: serial("id").primaryKey(),
	distributorId: integer("distributor_id"),
	userId: integer("user_id"),
	name: varchar("name", { length: 255 }).notNull(),
	concernedPersonName: varchar("concerned_person_name", { length: 255 }).notNull(),
	concernedPersonPhoneNum: varchar("concerned_person_phone_num", { length: 50 }).notNull(),
	area: varchar("area", { length: 120 }),
	zone: varchar("zone", { length: 120 }),
	state: varchar("state", { length: 100 }),
	district: varchar("district", { length: 120 }),
	city: varchar("city", { length: 120 }),
	address: varchar("address", { length: 500 }).notNull(),
	pinCode: varchar("pin_code", { length: 20 }),
	latitude: numeric("latitude", { precision: 10, scale: 7 }),
	longitude: numeric("longitude", { precision: 10, scale: 7 }),
	gstNumber: varchar("gst_number", { length: 50 }),
	storeImage: varchar("store_image", { length: 500 }),
	date: date("date"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
	foreignKey({
		columns: [t.distributorId],
		foreignColumns: [distributors.id],
		name: "outlets_distributor_id_fkey",
	}).onDelete("set null").onUpdate("cascade"),
	foreignKey({
		columns: [t.userId],
		foreignColumns: [users.id],
		name: "outlets_user_id_fkey",
	}).onDelete("restrict").onUpdate("cascade"),
]);

export const institutions = myCustomSchema.table("instititions", {
	id: serial("id").primaryKey(),
	userId: integer("user_id").notNull(),
	institutionName: varchar("institution_name", { length: 255 }).notNull(),
	contactPersonName: varchar("contact_person_name", { length: 255 }),
	contactPersonNumber: varchar("contact_person_number", { length: 20 }),
	email: varchar("email", { length: 255 }),
	gstNo: varchar("gst_no", { length: 50 }),
	panNo: varchar("pan_no", { length: 50 }),
	zone: varchar("zone", { length: 120 }),
	district: varchar("district", { length: 120 }),
	area: varchar("area", { length: 120 }),
	state: varchar("state", { length: 100 }),
	pinCode: varchar("pin_code", { length: 20 }),
	address: varchar("address", { length: 500 }),
	latitude: numeric("latitude", { precision: 10, scale: 7 }),
	longitude: numeric("longitude", { precision: 10, scale: 7 }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	isVerified: boolean("is_verified").default(false),
}, (t) => [
	index("idx_institute_verified_zone").on(t.zone),
	index("idx_institute_verified_district").on(t.district),
	index("idx_institute_verified_pincode").on(t.pinCode),
	index("idx_institute_verified_gst").on(t.gstNo),
	foreignKey({
		columns: [t.userId],
		foreignColumns: [users.id],
		name: "institutions_user_id_fkey",
	}).onDelete("restrict").onUpdate("cascade"),
]);

export const influencers = myCustomSchema.table("influencers", {
	id: serial("id").primaryKey(),
	userId: integer("user_id").notNull(),
	contactPersonName: varchar("contact_person_name", { length: 255 }),
	contactPersonNumber: varchar("contact_person_number", { length: 20 }),
	email: varchar("email", { length: 255 }),
	zone: varchar("zone", { length: 120 }),
	district: varchar("district", { length: 120 }),
	area: varchar("area", { length: 120 }),
	state: varchar("state", { length: 100 }),
	pinCode: varchar("pin_code", { length: 20 }),
	address: varchar("address", { length: 500 }),
	latitude: numeric("latitude", { precision: 10, scale: 7 }),
	longitude: numeric("longitude", { precision: 10, scale: 7 }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	isVerified: boolean("is_verified").default(false),
}, (t) => [
	index("idx_influencer_verified_zone").on(t.zone),
	index("idx_influencer_verified_district").on(t.district),
	index("idx_influencer_verified_pincode").on(t.pinCode),
	foreignKey({
		columns: [t.userId],
		foreignColumns: [users.id],
		name: "influencers_user_id_fkey",
	}).onDelete("restrict").onUpdate("cascade"),
]);

export const permanentJourneyPlans = myCustomSchema.table("permanent_journey_plans", {
	id: varchar({ length: 255 }).primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	createdById: integer("created_by_id").notNull(),
	planDate: date("plan_date").notNull(),
	areaToBeVisited: varchar("area_to_be_visited", { length: 500 }).notNull(),
	description: varchar({ length: 500 }),
	status: varchar({ length: 50 }).notNull(),
	verificationStatus: varchar("verification_status", { length: 50 }),
	additionalVisitRemarks: varchar("additional_visit_remarks", { length: 500 }),
	route: varchar({ length: 500 }),
	diversionReason: varchar("diversion_reason", { length: 500 }),
	noOfDealerVisits: integer("no_of_dealer_visits"),
	noOfInstitutionVisits: integer("no_of_institution_visits"),
	noOfInfluencerVisits: integer("no_of_influencer_visits"),
	dealerId: integer("dealer_id"),
	bulkOpId: varchar("bulk_op_id", { length: 50 }),
	institutionId: integer("institution_id"),
	influencerId: integer("influencer_id"),
	idempotencyKey: varchar("idempotency_key", { length: 120 }),
	createdAt: timestamp("created_at", { precision: 6, withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_permanent_journey_plans_created_by_id").using("btree", table.createdById.asc().nullsLast()),
	index("idx_permanent_journey_plans_user_id").using("btree", table.userId.asc().nullsLast()),
	index("idx_pjp_bulk_op_id").using("btree", table.bulkOpId.asc().nullsLast()),
	index("idx_pjp_dealer_id").using("btree", table.dealerId.asc().nullsLast()),
	index("idx_pjp_institution_id").using("btree", table.institutionId.asc().nullsLast()),
	index("idx_pjp_influencer_id").using("btree", table.influencerId.asc().nullsLast()),
	uniqueIndex("uniq_pjp_idempotency_key_not_null").using("btree", table.idempotencyKey.asc().nullsLast()).where(sql`(idempotency_key IS NOT NULL)`),
	uniqueIndex("uniq_pjp_user_dealer_plan_date").using("btree", table.userId.asc().nullsLast(), table.dealerId.asc().nullsLast(), table.planDate.asc().nullsLast()),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "permanent_journey_plans_user_id_fkey"
	}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
		columns: [table.createdById],
		foreignColumns: [users.id],
		name: "permanent_journey_plans_created_by_id_fkey"
	}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
		columns: [table.dealerId],
		foreignColumns: [dealers.id],
		name: "permanent_journey_plans_dealer_id_fkey"
	}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
		columns: [table.institutionId],
		foreignColumns: [institutions.id],
		name: "permanent_journey_plans_institution_id_fkey"
	}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
		columns: [table.influencerId],
		foreignColumns: [influencers.id],
		name: "permanent_journey_plans_influencer_id_fkey"
	}).onUpdate("cascade").onDelete("set null"),
]);

export const dailyVisitReports = myCustomSchema.table("daily_visit_reports", {
	id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
	reportDate: date("report_date"),
	customerType: varchar("customer_type", { length: 50 }), //dealer or institution or influencer
	dealerType: varchar("dealer_type", { length: 50 }), // eurofoam or non-eurofoam
	institutionType: varchar("institution_type", { length: 50 }), // hotel/hospital/guest house...
	influencerType: varchar("influencer_type", { length: 50 }), // int decor people/carpenter....
	visitType: varchar("visit_type", { length: 50 }), // new or follow-up
	location: varchar("location", { length: 500 }),
	latitude: numeric("latitude", { precision: 20, scale: 7 }),
	longitude: numeric("longitude", { precision: 20, scale: 7 }),
	brandSelling: text("brand_selling").array(),

	nameOfParty: varchar("name_of_party", { length: 255 }),
	contactNoOfParty: varchar("contact_no_of_party", { length: 20 }),
	expectedActivationDate: date("expected_activation_date"),
	currentDealerOutstandingAmt: numeric("current_dealer_outstanding_amt", { precision: 18, scale: 2 }),

	todayOrderQty: numeric("today_order_qty", { precision: 18, scale: 2 }),
	todayCollectionRupees: numeric("today_collection_rupees", { precision: 18, scale: 2 }),
	overdueAmount: numeric("overdue_amount", { precision: 18, scale: 2 }),
	feedbacks: varchar("feedbacks", { length: 500 }),

	checkInTime: timestamp("check_in_time", { withTimezone: true, precision: 6 }),
	checkOutTime: timestamp("check_out_time", { withTimezone: true, precision: 6 }),
	timeSpentinLoc: varchar("time_spent_in_loc", { length: 255 }),
	inTimeImageUrl: varchar("in_time_image_url", { length: 500 }),
	outTimeImageUrl: varchar("out_time_image_url", { length: 500 }),
	userId: integer("user_id").notNull(),
	pjpId: varchar("pjp_id", { length: 255 }),
	dealerId: integer("dealer_id"),
	idempotencyKey: varchar("idempotency_key", { length: 255 }),
	createdAt: timestamp("created_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => [
	index("idx_daily_visit_reports_user_id").on(t.userId),
	index("idx_daily_visit_reports_pjp_id").on(t.pjpId),
	foreignKey({
		columns: [t.userId],
		foreignColumns: [users.id],
		name: "daily_visit_reports_user_id_fkey",
	}).onDelete("cascade"),
	foreignKey({
		columns: [t.pjpId],
		foreignColumns: [permanentJourneyPlans.id],
		name: "daily_visit_reports_pjp_id_fkey",
	}).onDelete("set null"),
	foreignKey({
		columns: [t.dealerId],
		foreignColumns: [dealers.id],
		name: "daily_visit_reports_dealer_id_fkey",
	}).onDelete("set null"),
]);

export const salesmanLeaveApplications = myCustomSchema.table("salesman_leave_applications", {
	id: varchar({ length: 255 }).primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	leaveType: varchar("leave_type", { length: 100 }).notNull(),
	startDate: date("start_date").notNull(),
	endDate: date("end_date").notNull(),
	reason: varchar({ length: 500 }).notNull(),
	status: varchar({ length: 50 }).notNull(),
	adminRemarks: varchar("admin_remarks", { length: 500 }),
	appRole: varchar("app_role", { length: 50 }),
	createdAt: timestamp("created_at", { precision: 6, withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("idx_salesman_leave_applications_user_id").using("btree", table.userId.asc().nullsLast()),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "salesman_leave_applications_user_id_fkey"
	}).onUpdate("cascade").onDelete("cascade"),
]);

export const salesmanAttendance = myCustomSchema.table("salesman_attendance", {
	id: varchar({ length: 255 }).primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	attendanceDate: date("attendance_date").notNull(),
	locationName: varchar("location_name", { length: 500 }).notNull(),
	inTimeTimestamp: timestamp("in_time_timestamp", { precision: 6, withTimezone: true, mode: 'string' }).notNull(),
	outTimeTimestamp: timestamp("out_time_timestamp", { precision: 6, withTimezone: true, mode: 'string' }),
	inTimeImageCaptured: boolean("in_time_image_captured").notNull(),
	outTimeImageCaptured: boolean("out_time_image_captured").notNull(),

	inTimeImageUrl: varchar("in_time_image_url", { length: 500 }),
	outTimeImageUrl: varchar("out_time_image_url", { length: 500 }),
	inTimeLatitude: numeric("in_time_latitude", { precision: 10, scale: 7 }).notNull(),
	inTimeLongitude: numeric("in_time_longitude", { precision: 10, scale: 7 }).notNull(),
	outTimeLatitude: numeric("out_time_latitude", { precision: 10, scale: 7 }),
	outTimeLongitude: numeric("out_time_longitude", { precision: 10, scale: 7 }),

	createdAt: timestamp("created_at", { precision: 6, withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	role: varchar({ length: 50 }),
}, (table) => [
	index("idx_salesman_attendance_user_id").using("btree", table.userId.asc().nullsLast()),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "salesman_attendance_user_id_fkey"
	}).onUpdate("cascade").onDelete("cascade"),
]);

// ------ Geotracking ------
export const geoTracking = myCustomSchema.table("geo_tracking", {
	id: text().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	latitude: numeric({ precision: 10, scale: 7 }).notNull(),
	longitude: numeric({ precision: 10, scale: 7 }).notNull(),
	recordedAt: timestamp("recorded_at", { precision: 6, withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	accuracy: numeric({ precision: 10, scale: 2 }),
	isActive: boolean("is_active").default(true).notNull(),
	totalDistanceTravelled: numeric("total_distance_travelled", { precision: 10, scale: 3 }),

	locationType: varchar("location_type", { length: 50 }),
	checkInTime: timestamp("check_in_time", { precision: 6, withTimezone: true, mode: 'string' }),
	checkOutTime: timestamp("check_out_time", { precision: 6, withTimezone: true, mode: 'string' }),
	destLat: numeric("dest_lat", { precision: 10, scale: 7 }),
	destLng: numeric("dest_lng", { precision: 10, scale: 7 }),
	journeyId: text("journey_id",),
	dealerId: integer("dealer_id"),
	createdAt: timestamp("created_at", { precision: 6, withTimezone: true, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("idx_geo_active").using("btree", table.isActive.asc().nullsLast()),
	index("idx_geo_dealer_id").using("btree", table.dealerId.asc().nullsLast()),
	index("idx_geo_journey_time").using("btree", table.journeyId.asc().nullsLast(), table.recordedAt.asc().nullsLast()),
	index("idx_geo_tracking_recorded_at").using("btree", table.recordedAt.asc().nullsLast()),
	index("idx_geo_tracking_user_id").using("btree", table.userId.asc().nullsLast()),
	index("idx_geo_user_time").using("btree", table.userId.asc().nullsLast(), table.recordedAt.asc().nullsLast()),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "geo_tracking_user_id_fkey"
	}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
		columns: [table.journeyId],
		foreignColumns: [journeys.id],
		name: "geo_tracking_journey_id_fkey",
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.dealerId],
		foreignColumns: [dealers.id],
		name: "geo_tracking_dealer_id_fkey",
	}).onDelete("set null"),
]);

export const journeys = myCustomSchema.table("journeys", {
	id: varchar({ length: 255 }).primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	pjpId: varchar("pjp_id", { length: 255 }),
	dealerId: integer("dealer_id"),
	destName: varchar("dest_name", { length: 255 }),
	destLat: numeric("dest_lat", { precision: 10, scale: 7 }),
	destLng: numeric("dest_lng", { precision: 10, scale: 7 }),
	status: varchar({ length: 50 }).default('ACTIVE').notNull(),
	isActive: boolean("is_active").default(true),
	startTime: timestamp("start_time", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	endTime: timestamp("end_time", { withTimezone: true, mode: 'string' }),
	totalDistance: numeric("total_distance", { precision: 10, scale: 3 }).default('0'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	isSynced: boolean("is_synced").default(false),
	appRole: varchar("app_role", { length: 50 }),
}, (table) => [
	index("idx_journeys_user_status").using("btree", table.userId.asc().nullsLast(), table.status.asc().nullsLast()),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "journeys_user_id_fkey"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.pjpId],
		foreignColumns: [permanentJourneyPlans.id],
		name: "journeys_pjp_id_fkey",
	}).onDelete("set null"),
	foreignKey({
		columns: [table.dealerId],
		foreignColumns: [dealers.id],
		name: "journeys_dealer_id_fkey",
	}).onDelete("set null"),
]);

export const journeyOps = myCustomSchema.table("journey_ops", {
	serverSeq: bigserial("server_seq", { mode: "bigint" }).primaryKey().notNull(),
	opId: uuid("op_id").notNull(),
	journeyId: varchar("journey_id", { length: 255 }).notNull(),
	userId: integer("user_id").notNull(),
	type: text().notNull(),
	payload: jsonb().notNull(),
	appRole: varchar("app_role", { length: 50 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_journey_ops_created").using("btree", table.createdAt.asc().nullsLast()),
	index("idx_journey_ops_journey").using("btree", table.journeyId.asc().nullsLast()),
	index("idx_journey_ops_server_seq").using("btree", table.serverSeq.asc().nullsLast()),
	index("idx_journey_ops_user").using("btree", table.userId.asc().nullsLast()),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "fk_journey_ops_user"
	}).onUpdate("cascade").onDelete("cascade"),
	unique("journey_ops_op_id_key").on(table.opId),
	foreignKey({
		columns: [table.journeyId],
		foreignColumns: [journeys.id],
		name: "fk_journey_ops_journey",
	}).onDelete("cascade"),
]);

export const journeyBreadcrumbs = myCustomSchema.table("journey_breadcrumbs", {
	id: varchar({ length: 255 }).primaryKey().notNull(),
	journeyId: varchar("journey_id", { length: 255 }).notNull(),
	latitude: doublePrecision().notNull(),
	longitude: doublePrecision().notNull(),
	totalDistance: doublePrecision("total_distance").default(0).notNull(),
	h3Index: varchar("h3_index", { length: 15 }),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	isSynced: boolean("is_synced").default(false),
}, (table) => [
	index("idx_breadcrumbs_h3").using("btree", table.h3Index.asc().nullsLast()),
	index("idx_breadcrumbs_journey_time").using("btree", table.journeyId.asc().nullsLast(), table.recordedAt.asc().nullsLast()),
	foreignKey({
		columns: [table.journeyId],
		foreignColumns: [journeys.id],
		name: "journey_breadcrumbs_journey_id_fkey"
	}).onDelete("cascade"),
]);

export const syncState = myCustomSchema.table("sync_state", {
	id: integer().default(1).primaryKey().notNull(),
	lastServerSeq: bigint("last_server_seq", { mode: "number" }).default(0).notNull(),
}, (table) => [
	check("one_row_only", sql`id = 1`),
]);

// ---- TA DA ----
export const tadaBills = myCustomSchema.table("ta_da_bills", {
	id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
	userId: integer("user_id").notNull(),
	fromDate: date("from_date"),
	toDate: date("to_date"),
	billDate: date("bill_date").notNull(),
	dailyAllowance: numeric("daily_allowance", { precision: 18, scale: 2 }).default('0'),
	totalCost: numeric("total_cost", { precision: 18, scale: 2 }).default('0'),
	status: varchar("status", { length: 50 }).default('PENDING'),
	remarks: text("remarks"),
	createdAt: timestamp("created_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => [
	index("idx_ta_da_bills_user_id").on(t.userId),
	foreignKey({
		columns: [t.userId],
		foreignColumns: [users.id],
		name: "ta_da_bills_user_id_fkey",
	}).onDelete("cascade"),
]);

export const tadaBillItems = myCustomSchema.table("ta_da_bill_items", {
	id: varchar("id", { length: 255 }).primaryKey().default(sql`gen_random_uuid()`),
	billId: varchar("bill_id", { length: 255 }).notNull(),

	fromLocation: varchar("from_location", { length: 255 }),
	toLocation: varchar("to_location", { length: 255 }),
	distanceTravelled: numeric("distance_travelled_km", { precision: 18, scale: 2 }),

	transportFare: numeric("transport_fare", { precision: 18, scale: 2 }).default('0'),
	lodgingFare: numeric("lodging_fare", { precision: 18, scale: 2 }).default('0'),
	foodingFare: numeric("fooding_fare", { precision: 18, scale: 2 }).default('0'),
	localConveyance: numeric("local_conveyance", { precision: 18, scale: 2 }).default('0'),
	outOfPocketPaid: numeric("out_of_pocket_paid", { precision: 18, scale: 2 }).default('0'),

	totalBillsAdded: integer("total_bills_added").default(0),
	billPhotoUrls: text("bill_photo_urls").array(),
	remarks: text("remarks"),
}, (t) => [
	index("idx_ta_da_bill_items_bill_id").on(t.billId),
	foreignKey({
		columns: [t.billId],
		foreignColumns: [tadaBills.id],
		name: "ta_da_bill_items_bill_id_fkey",
	}).onDelete("cascade"),
]);