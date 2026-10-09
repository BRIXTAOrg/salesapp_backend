// BRIXTA_FIELD_PIXEL_WORK_TRIGGER_V1
// Invoked ONLY after fieldUser/auth + server-side Field rule validation.
// All DB operations run in the caller's existing withTenantDb transaction.
import crypto from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/db";
import { mobileCapabilities, users } from "../db/schema";
import { dynamicSubmissions, workItems } from "../db/applianceSchema";
import { dataSources, entityRecords, platformAuditEvents, recordLinks } from "../db/platformVNextSchema";
import { getPublishedRuntimeManifest } from "./vnext/runtimeManifest";

type StartInput = {
  entityTypeId: number;
  entityTypeKey: string;
  recordId: string;
  recordData: Record<string, unknown>;
  label: string;
  employeeId: number;
  nodeId: string;
  responsibilityKey: string;
  sectionKey: string;
  appVersion: number;
  clientMutationId: string | null;
};

export async function startFieldResponsibilityWork(db: AppDatabase, input: StartInput) {
  if (!/^[a-z][a-z0-9_-]{0,119}$/.test(input.responsibilityKey)) {
    throw new Error("Invalid automated Responsibility key.");
  }
  // Lock per canonical record + Responsibility, across processes and retries.
  // hash collisions can only over-serialize, not cause a wrong assignment.
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.recordId}), hashtext(${input.responsibilityKey}))`);

  const [responsibility] = await db.select({
    id: mobileCapabilities.id,
    key: mobileCapabilities.key,
    title: mobileCapabilities.title,
  }).from(mobileCapabilities).where(and(
    eq(mobileCapabilities.key, input.responsibilityKey),
    eq(mobileCapabilities.isActive, true),
  )).limit(1);
  if (!responsibility) throw new Error(`Published Responsibility not found: ${input.responsibilityKey}`);

  // Once per source + Responsibility, regardless of employee or offline retry.
  // Only explicitly cancelled previous work is eligible for a fresh start.
  const [existing] = await db.select({ id: workItems.id }).from(workItems).where(and(
    eq(workItems.capabilityId, responsibility.id),
    sql`${workItems.payload}->>'sourceRecordId' = ${input.recordId}`,
    ne(workItems.status, "cancelled"),
  )).limit(1);
  if (existing) return { created: false as const, workItemId: existing.id };

  const published = await getPublishedRuntimeManifest(db, responsibility.id);
  if (!published) throw new Error(`Responsibility ${input.responsibilityKey} must be published before automation can create work.`);

  const [employee] = await db.select({
    id: users.id, displayName: users.displayName, username: users.username,
    status: users.status, mobileAccess: users.isSalesAppUser,
  }).from(users).where(eq(users.id, input.employeeId)).limit(1);
  if (!employee || employee.status !== "active" || !employee.mobileAccess) {
    throw new Error("The intended employee is not active or lacks mobile access.");
  }

  const [source] = await db.select({ key: dataSources.key }).from(dataSources).where(and(
    eq(dataSources.sourceType, "entity_store"),
    eq(dataSources.sourceRef, input.entityTypeKey),
    eq(dataSources.isActive, true),
  )).limit(1);
  if (!source) throw new Error(`Register the CRM list ${input.entityTypeKey} as a Data Source before enabling automated work.`);

  const [canonical] = await db.select({ id: entityRecords.id }).from(entityRecords).where(and(
    eq(entityRecords.id, input.recordId),
    eq(entityRecords.entityTypeId, input.entityTypeId),
    ne(entityRecords.status, "deleted"),
  )).limit(1);
  if (!canonical) throw new Error("Source CRM record is unavailable.");

  const initialState = published.kernel?.runtimeWorld.states.find((s) => s.initial === true)?.id
    ?? published.kernel?.runtimeWorld.states[0]?.id ?? "draft";
  const time = new Date();
  const at = time.toISOString();
  const label = input.label.slice(0, 160) || input.recordId;
  const workPayload = {
    kind: "record_assignment",
    autoStarted: true,
    pixelNodeId: input.nodeId,
    appVersion: input.appVersion,
    responsibilityKey: responsibility.key,
    sourceKey: source.key,
    sourceEntityTypeKey: input.entityTypeKey,
    sourceRecordId: input.recordId,
    sourceRecordLabel: label,
  };
  const [work] = await db.insert(workItems).values({
    capabilityId: responsibility.id,
    assigneeUserId: employee.id,
    createdByUserId: employee.id,
    title: `${responsibility.title}: ${label}`.slice(0, 220),
    description: `Field App v${input.appVersion} automatic assignment from ${input.entityTypeKey}.`,
    status: "assigned",
    priority: "normal",
    payload: workPayload,
  }).returning();
  if (!work) throw new Error("Could not create Responsibility work item.");

  const [submission] = await db.insert(dynamicSubmissions).values({
    clientMutationId: crypto.randomUUID(),
    userId: employee.id,
    capabilityId: responsibility.id,
    workItemId: work.id,
    status: initialState,
    payload: {
      __state: { process: initialState },
      __source: {
        sourceKey: source.key, sourceType: "entity_store",
        entityTypeKey: input.entityTypeKey,
        recordId: input.recordId, label, data: input.recordData,
      },
      __assignment: {
        workItemId: work.id, assigneeUserId: employee.id,
        assignedByUserId: employee.id, assignedAt: at, autoStarted: true,
      },
    },
  }).returning();
  if (!submission) throw new Error("Could not create linked Responsibility record.");

  await db.update(workItems).set({
    payload: { ...workPayload, recordId: submission.id }, updatedAt: time,
  }).where(eq(workItems.id, work.id));
  await db.insert(recordLinks).values({
    fromSourceKey: source.key,
    fromRecordId: input.recordId,
    relationKey: "responsibility_record",
    targetSourceKey: `responsibility:${responsibility.key}`,
    targetRecordId: submission.id,
    metadata: {
      workItemId: work.id, assigneeUserId: employee.id,
      assignedByUserId: employee.id, assignedAt: at,
      autoStarted: true, pixelNodeId: input.nodeId, appVersion: input.appVersion,
    },
  });
  await db.insert(platformAuditEvents).values({
    actorUserId: employee.id,
    eventType: "field.responsibility_started",
    subjectType: "entity_record",
    subjectId: input.recordId,
    payload: {
      title: `Responsibility automatically started: ${responsibility.title}`,
      responsibilityKey: responsibility.key,
      responsibilityTitle: responsibility.title,
      responsibilityRecordId: submission.id,
      workItemId: work.id,
      assigneeUserId: employee.id,
      assigneeName: employee.displayName ?? employee.username ?? `Employee ${employee.id}`,
      sourceEntityTypeKey: input.entityTypeKey,
      autoStarted: true,
      pixelNodeId: input.nodeId,
      appVersion: input.appVersion,
      section: input.sectionKey,
      clientMutationId: input.clientMutationId,
      byName: "Published Field App automation",
    },
  });
  return { created: true as const, workItemId: work.id, recordId: submission.id };
}
