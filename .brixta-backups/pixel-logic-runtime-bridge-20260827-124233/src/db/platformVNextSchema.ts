import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
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
  users,
} from "./schema";

/**
 * Backend-side typed view of the fixed BRIXTA tenant substrate provisioned
 * by salesman_cms. This file DOES NOT create tables at runtime; it lets the
 * backend read/write the exact tables the CMS already provisions.
 */

export type EntityFieldDefinition = {
  key: string;
  label: string;
  dataType: string;
  required?: boolean;
  config?: Record<string, unknown>;
};

export const entityTypes = pgTable(
  "entity_types",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 160 }).notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    description: text("description"),
    fieldDefinitions: jsonb("field_definitions")
      .$type<EntityFieldDefinition[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    displayTemplate: varchar("display_template", { length: 500 }),
    searchableFields: jsonb("searchable_fields")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("entity_types_key_key").on(table.key),
  ],
);

export const entityRecords = pgTable(
  "entity_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityTypeId: integer("entity_type_id").notNull(),
    externalKey: varchar("external_key", { length: 255 }),
    status: varchar("status", { length: 40 }).notNull().default("active"),
    data: jsonb("data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdByUserId: integer("created_by_user_id"),
    updatedByUserId: integer("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_entity_records_type_status").on(
      table.entityTypeId,
      table.status,
    ),
    foreignKey({
      columns: [table.entityTypeId],
      foreignColumns: [entityTypes.id],
      name: "entity_records_entity_type_id_fkey",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
      name: "entity_records_created_by_user_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.updatedByUserId],
      foreignColumns: [users.id],
      name: "entity_records_updated_by_user_id_fkey",
    }).onDelete("set null"),
  ],
);

export const dataSources = pgTable(
  "data_sources",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 160 }).notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    sourceType: varchar("source_type", { length: 50 }).notNull(),
    sourceRef: varchar("source_ref", { length: 255 }).notNull(),
    displayField: varchar("display_field", { length: 160 }),
    valueField: varchar("value_field", { length: 160 }),
    searchableFields: jsonb("searchable_fields")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    allowedFields: jsonb("allowed_fields")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    defaultFilters: jsonb("default_filters")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    offlinePolicy: jsonb("offline_policy")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("data_sources_key_key").on(table.key),
    index("idx_data_sources_type_active").on(table.sourceType, table.isActive),
  ],
);

export const responsibilityExtensions = pgTable(
  "responsibility_extensions",
  {
    responsibilityId: integer("responsibility_id").primaryKey(),
    draftConfig: jsonb("draft_config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    publishedConfig: jsonb("published_config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    publishedVersion: integer("published_version").notNull().default(0),
    compiledHash: text("compiled_hash"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.responsibilityId],
      foreignColumns: [mobileCapabilities.id],
      name: "responsibility_extensions_responsibility_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const responsibilityVersions = pgTable(
  "responsibility_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    responsibilityId: integer("responsibility_id").notNull(),
    version: integer("version").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("published"),
    baseDefinition: jsonb("base_definition")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    extensionDefinition: jsonb("extension_definition")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdByUserId: integer("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("responsibility_versions_responsibility_version_key").on(
      table.responsibilityId,
      table.version,
    ),
  ],
);

export const compiledResponsibilityManifests = pgTable(
  "compiled_responsibility_manifests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    responsibilityId: integer("responsibility_id").notNull(),
    version: integer("version").notNull(),
    manifest: jsonb("manifest")
      .$type<Record<string, unknown>>()
      .notNull(),
    manifestHash: text("manifest_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("compiled_responsibility_manifests_version_key").on(
      table.responsibilityId,
      table.version,
    ),
    foreignKey({
      columns: [table.responsibilityId],
      foreignColumns: [mobileCapabilities.id],
      name: "compiled_responsibility_manifests_responsibility_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const recordLinks = pgTable(
  "record_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromSourceKey: varchar("from_source_key", { length: 160 }).notNull(),
    fromRecordId: varchar("from_record_id", { length: 255 }).notNull(),
    relationKey: varchar("relation_key", { length: 160 }).notNull(),
    targetSourceKey: varchar("target_source_key", { length: 160 }).notNull(),
    targetRecordId: varchar("target_record_id", { length: 255 }).notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_record_links_from").on(table.fromSourceKey, table.fromRecordId),
    index("idx_record_links_target").on(table.targetSourceKey, table.targetRecordId),
  ],
);

export const entityFieldMemory = pgTable(
  "entity_field_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceKey: varchar("source_key", { length: 160 }).notNull(),
    entityId: varchar("entity_id", { length: 255 }).notNull(),
    fieldKey: varchar("field_key", { length: 160 }).notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    useCount: integer("use_count").notNull().default(0),
    lastConfirmedByUserId: integer("last_confirmed_by_user_id"),
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    uniqueIndex("entity_field_memory_scope_key").on(
      table.sourceKey,
      table.entityId,
      table.fieldKey,
    ),
    index("idx_entity_field_memory_validity").on(table.validUntil),
    foreignKey({
      columns: [table.lastConfirmedByUserId],
      foreignColumns: [users.id],
      name: "entity_field_memory_last_confirmed_by_user_id_fkey",
    }).onDelete("set null"),
  ],
);

export const platformAuditEvents = pgTable(
  "platform_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: integer("actor_user_id"),
    eventType: varchar("event_type", { length: 160 }).notNull(),
    subjectType: varchar("subject_type", { length: 120 }).notNull(),
    subjectId: varchar("subject_id", { length: 255 }),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_platform_audit_events_subject").on(table.subjectType, table.subjectId),
    index("idx_platform_audit_events_actor").on(table.actorUserId),
    foreignKey({
      columns: [table.actorUserId],
      foreignColumns: [users.id],
      name: "platform_audit_events_actor_user_id_fkey",
    }).onDelete("set null"),
  ],
);
