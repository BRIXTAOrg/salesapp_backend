import {
  bigserial,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import {
  mobileCapabilities,
  myCustomSchema,
  users,
} from "./schema";

export const workspaceSettings = myCustomSchema.table(
  "workspace_settings",
  {
    key: varchar("key", { length: 120 }).primaryKey(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedByUserId: integer("updated_by_user_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.updatedByUserId],
      foreignColumns: [users.id],
      name: "workspace_settings_updated_by_user_id_fkey",
    }).onDelete("set null"),
  ],
);

export const capabilityAssignmentRules = myCustomSchema.table(
  "capability_assignment_rules",
  {
    id: serial("id").primaryKey(),
    capabilityId: integer("capability_id").notNull(),
    subjectType: varchar("subject_type", { length: 40 }).notNull(),
    subjectValue: varchar("subject_value", { length: 180 }),
    effect: varchar("effect", { length: 16 }).notNull().default("allow"),
    priority: integer("priority").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdByUserId: integer("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_capability_assignment_rules_capability").on(table.capabilityId),
    index("idx_capability_assignment_rules_subject").on(table.subjectType, table.subjectValue),
    index("idx_capability_assignment_rules_enabled").on(table.enabled),
    foreignKey({
      columns: [table.capabilityId],
      foreignColumns: [mobileCapabilities.id],
      name: "capability_assignment_rules_capability_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
      name: "capability_assignment_rules_created_by_user_id_fkey",
    }).onDelete("set null"),
  ],
);

export const adminOwnershipRules = myCustomSchema.table(
  "admin_ownership_rules",
  {
    id: serial("id").primaryKey(),
    areaKey: varchar("area_key", { length: 120 }).notNull(),
    scopeType: varchar("scope_type", { length: 40 }).notNull().default("organization"),
    scopeValue: varchar("scope_value", { length: 180 }),
    primaryAdminUserId: integer("primary_admin_user_id"),
    fallbackAdminUserId: integer("fallback_admin_user_id"),
    priority: integer("priority").notNull().default(0),
    slaMinutes: integer("sla_minutes"),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdByUserId: integer("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_admin_ownership_rules_area").on(table.areaKey),
    index("idx_admin_ownership_rules_scope").on(table.scopeType, table.scopeValue),
    foreignKey({
      columns: [table.primaryAdminUserId],
      foreignColumns: [users.id],
      name: "admin_ownership_rules_primary_admin_user_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.fallbackAdminUserId],
      foreignColumns: [users.id],
      name: "admin_ownership_rules_fallback_admin_user_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
      name: "admin_ownership_rules_created_by_user_id_fkey",
    }).onDelete("set null"),
  ],
);

export const workItems = myCustomSchema.table(
  "work_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    capabilityId: integer("capability_id"),
    assigneeUserId: integer("assignee_user_id").notNull(),
    createdByUserId: integer("created_by_user_id"),
    title: varchar("title", { length: 220 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 40 }).notNull().default("assigned"),
    priority: varchar("priority", { length: 20 }).notNull().default("normal"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    approvalRequired: boolean("approval_required").notNull().default(false),
    approvalAreaKey: varchar("approval_area_key", { length: 120 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_work_items_assignee_status").on(table.assigneeUserId, table.status),
    index("idx_work_items_due_at").on(table.dueAt),
    index("idx_work_items_capability").on(table.capabilityId),
    foreignKey({
      columns: [table.capabilityId],
      foreignColumns: [mobileCapabilities.id],
      name: "work_items_capability_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.assigneeUserId],
      foreignColumns: [users.id],
      name: "work_items_assignee_user_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
      name: "work_items_created_by_user_id_fkey",
    }).onDelete("set null"),
  ],
);

export const dynamicSubmissions = myCustomSchema.table(
  "dynamic_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientMutationId: uuid("client_mutation_id").notNull(),
    userId: integer("user_id").notNull(),
    capabilityId: integer("capability_id").notNull(),
    workItemId: uuid("work_item_id"),
    status: varchar("status", { length: 40 }).notNull().default("submitted"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    clientCreatedAt: timestamp("client_created_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    serverVersion: integer("server_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("dynamic_submissions_client_mutation_id_key").on(table.clientMutationId),
    index("idx_dynamic_submissions_user").on(table.userId, table.submittedAt),
    index("idx_dynamic_submissions_capability").on(table.capabilityId),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "dynamic_submissions_user_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.capabilityId],
      foreignColumns: [mobileCapabilities.id],
      name: "dynamic_submissions_capability_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workItemId],
      foreignColumns: [workItems.id],
      name: "dynamic_submissions_work_item_id_fkey",
    }).onDelete("set null"),
  ],
);

export const approvalRequests = myCustomSchema.table(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceType: varchar("source_type", { length: 60 }).notNull(),
    sourceId: varchar("source_id", { length: 255 }).notNull(),
    areaKey: varchar("area_key", { length: 120 }).notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    requesterUserId: integer("requester_user_id"),
    assignedAdminUserId: integer("assigned_admin_user_id"),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByUserId: integer("decided_by_user_id"),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_approval_requests_status").on(table.status, table.assignedAdminUserId),
    index("idx_approval_requests_area").on(table.areaKey),
    foreignKey({
      columns: [table.requesterUserId],
      foreignColumns: [users.id],
      name: "approval_requests_requester_user_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.assignedAdminUserId],
      foreignColumns: [users.id],
      name: "approval_requests_assigned_admin_user_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.decidedByUserId],
      foreignColumns: [users.id],
      name: "approval_requests_decided_by_user_id_fkey",
    }).onDelete("set null"),
  ],
);

export const deviceRegistrations = myCustomSchema.table(
  "device_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: integer("user_id").notNull(),
    deviceId: varchar("device_id", { length: 255 }).notNull(),
    platform: varchar("platform", { length: 40 }).notNull(),
    appVersion: varchar("app_version", { length: 80 }),
    pushToken: varchar("push_token", { length: 700 }),
    isActive: boolean("is_active").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("device_registrations_user_device_key").on(table.userId, table.deviceId),
    index("idx_device_registrations_last_seen").on(table.lastSeenAt),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "device_registrations_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const usageEvents = myCustomSchema.table(
  "usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorUserId: integer("actor_user_id"),
    surface: varchar("surface", { length: 40 }).notNull(),
    actionKey: varchar("action_key", { length: 160 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }),
    entityId: varchar("entity_id", { length: 255 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_usage_events_actor_action").on(table.actorUserId, table.actionKey),
    index("idx_usage_events_occurred_at").on(table.occurredAt),
    foreignKey({
      columns: [table.actorUserId],
      foreignColumns: [users.id],
      name: "usage_events_actor_user_id_fkey",
    }).onDelete("set null"),
  ],
);

export const userPins = myCustomSchema.table(
  "user_pins",
  {
    userId: integer("user_id").notNull(),
    surface: varchar("surface", { length: 40 }).notNull(),
    itemKey: varchar("item_key", { length: 160 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.surface, table.itemKey] }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "user_pins_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const attentionItems = myCustomSchema.table(
  "attention_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    areaKey: varchar("area_key", { length: 120 }).notNull(),
    severity: varchar("severity", { length: 20 }).notNull().default("info"),
    title: varchar("title", { length: 220 }).notNull(),
    body: text("body"),
    entityType: varchar("entity_type", { length: 80 }),
    entityId: varchar("entity_id", { length: 255 }),
    assignedAdminUserId: integer("assigned_admin_user_id"),
    status: varchar("status", { length: 30 }).notNull().default("open"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: integer("resolved_by_user_id"),
  },
  (table) => [
    index("idx_attention_items_status").on(table.status, table.assignedAdminUserId),
    index("idx_attention_items_area").on(table.areaKey),
    foreignKey({
      columns: [table.assignedAdminUserId],
      foreignColumns: [users.id],
      name: "attention_items_assigned_admin_user_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.resolvedByUserId],
      foreignColumns: [users.id],
      name: "attention_items_resolved_by_user_id_fkey",
    }).onDelete("set null"),
  ],
);

export const applianceAuditLog = myCustomSchema.table(
  "appliance_audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorUserId: integer("actor_user_id"),
    actorType: varchar("actor_type", { length: 40 }).notNull().default("admin"),
    action: varchar("action", { length: 180 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: varchar("entity_id", { length: 255 }),
    beforeState: jsonb("before_state").$type<unknown>(),
    afterState: jsonb("after_state").$type<unknown>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_appliance_audit_log_entity").on(table.entityType, table.entityId),
    index("idx_appliance_audit_log_actor").on(table.actorUserId, table.createdAt),
    foreignKey({
      columns: [table.actorUserId],
      foreignColumns: [users.id],
      name: "appliance_audit_log_actor_user_id_fkey",
    }).onDelete("set null"),
  ],
);

export const employeeRuntimeState = myCustomSchema.table(
  "employee_runtime_state",
  {
    userId: integer("user_id").primaryKey(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    lastBootstrapAt: timestamp("last_bootstrap_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    currentDeviceId: varchar("current_device_id", { length: 255 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "employee_runtime_state_user_id_fkey",
    }).onDelete("cascade"),
    index("idx_employee_runtime_state_last_seen").on(table.lastSeenAt),
  ],
);
