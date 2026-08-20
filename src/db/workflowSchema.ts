import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import {
  mobileCapabilities,
  roles,
  users,
} from "./schema";

/**
 * Registry of executable business actions.
 *
 * The workflow engine references action keys instead of hardcoding routes
 * or UI components inside workflow definitions.
 */
export const actionDefinitions = pgTable(
  "action_definitions",
  {
    id: serial("id").primaryKey(),

    key: varchar("key", { length: 160 }).notNull(),
    title: varchar("title", { length: 220 }).notNull(),

    permissionKey: varchar("permission_key", { length: 160 }),
    entitlementKey: varchar("entitlement_key", { length: 160 }),
    handlerKey: varchar("handler_key", { length: 160 }).notNull(),

    capabilityId: integer("capability_id"),

    isActive: boolean("is_active").notNull().default(true),

    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("action_definitions_key_key").on(table.key),
    index("idx_action_definitions_capability").on(table.capabilityId),
    foreignKey({
      columns: [table.capabilityId],
      foreignColumns: [mobileCapabilities.id],
      name: "action_definitions_capability_id_fkey",
    }).onDelete("set null"),
  ],
);

export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 160 }).notNull(),
    name: varchar("name", { length: 220 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),

    createdByUserId: integer("created_by_user_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_definitions_key_key").on(table.key),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
      name: "workflow_definitions_created_by_user_id_fkey",
    }).onDelete("set null"),
  ],
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: serial("id").primaryKey(),

    workflowId: integer("workflow_id").notNull(),
    version: integer("version").notNull(),

    // draft | published | retired
    status: varchar("status", { length: 30 })
      .notNull()
      .default("draft"),

    createdByUserId: integer("created_by_user_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("workflow_versions_workflow_version_key").on(
      table.workflowId,
      table.version,
    ),
    index("idx_workflow_versions_status").on(table.status),
    foreignKey({
      columns: [table.workflowId],
      foreignColumns: [workflowDefinitions.id],
      name: "workflow_versions_workflow_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
      name: "workflow_versions_created_by_user_id_fkey",
    }).onDelete("set null"),
  ],
);

export const approvalPolicies = pgTable(
  "approval_policies",
  {
    id: serial("id").primaryKey(),

    key: varchar("key", { length: 160 }).notNull(),
    name: varchar("name", { length: 220 }).notNull(),

    // any | all | sequential
    mode: varchar("mode", { length: 30 }).notNull().default("any"),

    minimumApprovals: integer("minimum_approvals")
      .notNull()
      .default(1),

    enabled: boolean("enabled").notNull().default(true),

    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    createdByUserId: integer("created_by_user_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("approval_policies_key_key").on(table.key),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
      name: "approval_policies_created_by_user_id_fkey",
    }).onDelete("set null"),
  ],
);

export const approvalPolicyActors = pgTable(
  "approval_policy_actors",
  {
    id: serial("id").primaryKey(),

    policyId: integer("policy_id").notNull(),

    // role | user | reports_to | department_manager | designation
    subjectType: varchar("subject_type", { length: 50 }).notNull(),

    roleId: integer("role_id"),
    userId: integer("user_id"),

    scopeType: varchar("scope_type", { length: 60 }),

    scopeConfig: jsonb("scope_config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    sequence: integer("sequence").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
  },
  (table) => [
    index("idx_approval_policy_actors_policy").on(table.policyId),
    index("idx_approval_policy_actors_role").on(table.roleId),
    index("idx_approval_policy_actors_user").on(table.userId),

    foreignKey({
      columns: [table.policyId],
      foreignColumns: [approvalPolicies.id],
      name: "approval_policy_actors_policy_id_fkey",
    }).onDelete("cascade"),

    foreignKey({
      columns: [table.roleId],
      foreignColumns: [roles.id],
      name: "approval_policy_actors_role_id_fkey",
    }).onDelete("cascade"),

    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "approval_policy_actors_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: serial("id").primaryKey(),

    workflowVersionId: integer("workflow_version_id").notNull(),

    stepKey: varchar("step_key", { length: 160 }).notNull(),
    title: varchar("title", { length: 220 }).notNull(),

    // action | approval | wait | system
    stepType: varchar("step_type", { length: 40 }).notNull(),

    actionDefinitionId: integer("action_definition_id"),
    approvalPolicyId: integer("approval_policy_id"),

    sortOrder: integer("sort_order").notNull().default(0),

    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    uniqueIndex("workflow_steps_version_step_key").on(
      table.workflowVersionId,
      table.stepKey,
    ),

    index("idx_workflow_steps_version").on(table.workflowVersionId),

    foreignKey({
      columns: [table.workflowVersionId],
      foreignColumns: [workflowVersions.id],
      name: "workflow_steps_workflow_version_id_fkey",
    }).onDelete("cascade"),

    foreignKey({
      columns: [table.actionDefinitionId],
      foreignColumns: [actionDefinitions.id],
      name: "workflow_steps_action_definition_id_fkey",
    }).onDelete("set null"),

    foreignKey({
      columns: [table.approvalPolicyId],
      foreignColumns: [approvalPolicies.id],
      name: "workflow_steps_approval_policy_id_fkey",
    }).onDelete("set null"),
  ],
);

export const workflowStepDependencies = pgTable(
  "workflow_step_dependencies",
  {
    stepId: integer("step_id").notNull(),
    dependsOnStepId: integer("depends_on_step_id").notNull(),

    requiredStatus: varchar("required_status", { length: 40 })
      .notNull()
      .default("completed"),
  },
  (table) => [
    primaryKey({
      columns: [table.stepId, table.dependsOnStepId],
    }),

    foreignKey({
      columns: [table.stepId],
      foreignColumns: [workflowSteps.id],
      name: "workflow_step_dependencies_step_id_fkey",
    }).onDelete("cascade"),

    foreignKey({
      columns: [table.dependsOnStepId],
      foreignColumns: [workflowSteps.id],
      name: "workflow_step_dependencies_depends_on_step_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const workflowInstances = pgTable(
  "workflow_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    workflowVersionId: integer("workflow_version_id").notNull(),
    subjectUserId: integer("subject_user_id").notNull(),

    // active | completed | rejected | cancelled
    status: varchar("status", { length: 40 })
      .notNull()
      .default("active"),

    contextType: varchar("context_type", { length: 80 }),
    contextId: varchar("context_id", { length: 255 }),

    context: jsonb("context")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    completedAt: timestamp("completed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_workflow_instances_subject_status").on(
      table.subjectUserId,
      table.status,
    ),
    index("idx_workflow_instances_context").on(
      table.contextType,
      table.contextId,
    ),

    foreignKey({
      columns: [table.workflowVersionId],
      foreignColumns: [workflowVersions.id],
      name: "workflow_instances_workflow_version_id_fkey",
    }).onDelete("restrict"),

    foreignKey({
      columns: [table.subjectUserId],
      foreignColumns: [users.id],
      name: "workflow_instances_subject_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const workflowStepInstances = pgTable(
  "workflow_step_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    workflowInstanceId: uuid("workflow_instance_id").notNull(),
    workflowStepId: integer("workflow_step_id").notNull(),

    // blocked | ready | in_progress | pending_approval |
    // approved | rejected | completed | cancelled
    status: varchar("status", { length: 40 })
      .notNull()
      .default("blocked"),

    actorUserId: integer("actor_user_id"),

    sourceType: varchar("source_type", { length: 80 }),
    sourceId: varchar("source_id", { length: 255 }),

    blockedReason: varchar("blocked_reason", { length: 160 }),

    activatedAt: timestamp("activated_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_step_instances_instance_step_key").on(
      table.workflowInstanceId,
      table.workflowStepId,
    ),

    index("idx_workflow_step_instances_status").on(table.status),
    index("idx_workflow_step_instances_actor").on(table.actorUserId),

    foreignKey({
      columns: [table.workflowInstanceId],
      foreignColumns: [workflowInstances.id],
      name: "workflow_step_instances_workflow_instance_id_fkey",
    }).onDelete("cascade"),

    foreignKey({
      columns: [table.workflowStepId],
      foreignColumns: [workflowSteps.id],
      name: "workflow_step_instances_workflow_step_id_fkey",
    }).onDelete("restrict"),

    foreignKey({
      columns: [table.actorUserId],
      foreignColumns: [users.id],
      name: "workflow_step_instances_actor_user_id_fkey",
    }).onDelete("set null"),
  ],
);
