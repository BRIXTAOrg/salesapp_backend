import crypto from "node:crypto";
import { previewFieldPixelLogic } from "../platform/fieldPixelPreview";

import type {
  Router,
} from "express";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  mobileCapabilities,
  users,
} from "../db/schema";

import {
  applianceAuditLog,
  approvalRequests,
  dynamicSubmissions,
  workItems,
} from "../db/applianceSchema";

import {
  dataSources,
  entityRecords,
  entityTypes,
  recordLinks,
  platformAuditEvents,
} from "../db/platformVNextSchema";

import {
  actionDefinitions,
  workflowDefinitions,
  workflowInstances,
  workflowStepInstances,
  workflowSteps,
  workflowVersions,
} from "../db/workflowSchema";

import {
  withAdminTenantDb,
  type AdminRequest,
} from "../middleware/adminService";

import {
  decideWorkflowApproval,
} from "../services/workflowEngine";

import {
  userCanApprovePolicy,
} from "../services/approvalPolicyResolver";

import {
  decideKernelDecision,
  listKernelDecisions,
} from "../services/kernelDecisionInbox";

import {
  executeKernelAction,
  getKernelRuntime,
} from "../platform/kernel/runtimeEngine";

import {
  sendResult,
} from "../mobile/http";

import {
  getPublishedRuntimeManifest,
} from "../platform/vnext/runtimeManifest";

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function registerRuntimeAdminRoutes(
  router: Router,
) {
  // BRIXTA_FIELD_PIXEL_PREVIEW_V1: synthetic dry-run. Authenticated via
  // requireAdminService, and CMS appliance proxy enforces dashboard WRITE.
  // Never writes through the tenant DB or invokes a Field effect host.
  router.post("/field-pixel-preview", (req: AdminRequest, res) => {
    if (!req.adminActor?.userId) {
      return res.status(403).json({ success: false, error: "Dashboard administrator required." });
    }
    const body = req.body ?? {};
    if (JSON.stringify(body).length > 64000) {
      return res.status(413).json({ success: false, error: "Preview request is too large." });
    }
    const asObject = (value: unknown): Record<string, unknown> =>
      value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const rawSample = asObject(body.sample);
    const rawCapture = asObject(rawSample.capture);
    if (Object.keys(rawCapture).length > 100) {
      return res.status(400).json({ success: false, error: "Too many sample fields." });
    }
    const stages = Array.isArray(body.stages) ? body.stages.slice(0, 40).map((item: unknown) => ({
      key: String(asObject(item).key ?? "").slice(0, 120),
    })) : [];
    const preview = previewFieldPixelLogic({
      rawProgram: body.program,
      stages,
      capture: rawCapture,
      sectionKey: String(rawSample.sectionKey ?? "visit").slice(0, 120),
      currentStage: String(rawSample.stage ?? stages[0]?.key ?? "new").slice(0, 120),
    });
    return res.status(preview.ok ? 200 : 422).json({ success: preview.ok, ...preview });
  });

  /*
   * BRIXTA_RECORD_ASSIGNMENT_V1
   *
   * Turn canonical business records (Dealer / Site / Shop / Machine / etc.)
   * into concrete employee work WITHOUT copying/importing them into another
   * disconnected system.
   *
   * Source Entity Record
   *      ↓
   * Work Item
   *      ↓
   * concrete Responsibility record
   *      ↓
   * record_links traceability
   *      ↓
   * existing mobile Work inbox
   */
  router.post(
    "/work-items",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const actorUserId =
          req.adminActor?.userId ??
          null;

        const responsibilityKey =
          String(
            req.body?.responsibilityKey ??
            "",
          )
            .trim()
            .toLowerCase();

        const sourceEntityTypeKey =
          String(
            req.body?.sourceEntityTypeKey ??
            "",
          )
            .trim()
            .toLowerCase();

        const assigneeUserId =
          Number(
            req.body?.assigneeUserId,
          );

        const sourceRecordIds: string[] =
          Array.isArray(
            req.body?.sourceRecordIds,
          )
            ? [
                ...new Set<string>(
                  (req.body.sourceRecordIds as unknown[])
                    .map(
                      (value: unknown) =>
                        String(value).trim(),
                    )
                    .filter(
                      (value): value is string =>
                        value.length > 0,
                    ),
                ),
              ].slice(0, 200)
            : [];

        const priority =
          [
            "low",
            "normal",
            "high",
            "urgent",
          ].includes(
            String(
              req.body?.priority ??
              "normal",
            ),
          )
            ? String(
                req.body?.priority ??
                "normal",
              )
            : "normal";

        const dueAtRaw =
          String(
            req.body?.dueAt ??
            "",
          ).trim();

        const dueAt =
          dueAtRaw
            ? new Date(
                dueAtRaw,
              )
            : null;

        if (
          !responsibilityKey
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "responsibilityKey is required.",
            });
        }

        if (
          !sourceEntityTypeKey
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "sourceEntityTypeKey is required.",
            });
        }

        if (
          !Number.isInteger(
            assigneeUserId,
          ) ||
          assigneeUserId <= 0
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "A valid employee is required.",
            });
        }

        if (
          sourceRecordIds.length === 0
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "Choose at least one business record.",
            });
        }

        if (
          dueAt &&
          Number.isNaN(
            dueAt.getTime(),
          )
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "dueAt is invalid.",
            });
        }

        const [
          responsibility,
        ] =
          await db
            .select({
              id:
                mobileCapabilities.id,

              key:
                mobileCapabilities.key,

              title:
                mobileCapabilities.title,

              isActive:
                mobileCapabilities.isActive,
            })
            .from(
              mobileCapabilities,
            )
            .where(
              and(
                eq(
                  mobileCapabilities.key,
                  responsibilityKey,
                ),

                eq(
                  mobileCapabilities.isActive,
                  true,
                ),
              ),
            )
            .limit(1);

        if (
          !responsibility
        ) {
          return res
            .status(404)
            .json({
              success: false,
              error:
                "Published Responsibility not found.",
            });
        }

        const published =
          await getPublishedRuntimeManifest(
            db,
            responsibility.id,
          );

        if (
          !published
        ) {
          return res
            .status(409)
            .json({
              success: false,
              error:
                "Publish this Responsibility before assigning records.",
            });
        }

        const [
          assignee,
        ] =
          await db
            .select({
              id:
                users.id,

              name:
                users.displayName,

              username:
                users.username,

              status:
                users.status,

              mobileAccess:
                users.isSalesAppUser,
            })
            .from(users)
            .where(
              eq(
                users.id,
                assigneeUserId,
              ),
            )
            .limit(1);

        if (
          !assignee ||
          assignee.status !==
            "active" ||
          assignee.mobileAccess !==
            true
        ) {
          return res
            .status(404)
            .json({
              success: false,
              error:
                "Active mobile employee not found.",
            });
        }

        const [
          entityType,
        ] =
          await db
            .select()
            .from(
              entityTypes,
            )
            .where(
              and(
                eq(
                  entityTypes.key,
                  sourceEntityTypeKey,
                ),

                eq(
                  entityTypes.isActive,
                  true,
                ),
              ),
            )
            .limit(1);

        if (
          !entityType
        ) {
          return res
            .status(404)
            .json({
              success: false,
              error:
                "Business list not found.",
            });
        }

        const [
          source,
        ] =
          await db
            .select()
            .from(
              dataSources,
            )
            .where(
              and(
                eq(
                  dataSources.sourceType,
                  "entity_store",
                ),

                eq(
                  dataSources.sourceRef,
                  entityType.key,
                ),

                eq(
                  dataSources.isActive,
                  true,
                ),
              ),
            )
            .limit(1);

        if (
          !source
        ) {
          return res
            .status(409)
            .json({
              success: false,
              error:
                "This list is not available as business data yet. Open Connections/Data once so BRIXTA can register the list as a Data Source.",
            });
        }

        const records =
          await db
            .select({
              id:
                entityRecords.id,

              externalKey:
                entityRecords.externalKey,

              status:
                entityRecords.status,

              data:
                entityRecords.data,
            })
            .from(
              entityRecords,
            )
            .where(
              and(
                eq(
                  entityRecords.entityTypeId,
                  entityType.id,
                ),

                inArray(
                  entityRecords.id,
                  sourceRecordIds,
                ),

                ne(
                  entityRecords.status,
                  "deleted",
                ),
              ),
            );

        if (
          records.length === 0
        ) {
          return res
            .status(404)
            .json({
              success: false,
              error:
                "None of the selected business records exist.",
            });
        }

        const initialState =
          published.kernel
            ?.runtimeWorld
            .states
            .find(
              (state) =>
                state.initial === true,
            )
            ?.id ??
          published.kernel
            ?.runtimeWorld
            .states[0]
            ?.id ??
          "draft";

        const created: Array<{
          workItemId: string;
          recordId: string;
          sourceRecordId: string;
          label: string;
        }> = [];

        const skipped: Array<{
          sourceRecordId: string;
          reason: string;
        }> = [];

        for (
          const sourceRecord
          of records
        ) {
          const sourceRecordId =
            String(
              sourceRecord.id,
            );

          const [
            duplicate,
          ] =
            await db
              .select({
                id:
                  workItems.id,
              })
              .from(
                workItems,
              )
              .where(
                and(
                  eq(
                    workItems.capabilityId,
                    responsibility.id,
                  ),

                  eq(
                    workItems.assigneeUserId,
                    assigneeUserId,
                  ),

                  inArray(
                    workItems.status,
                    [
                      "assigned",
                      "in_progress",
                    ],
                  ),

                  sql`${workItems.payload}->>'sourceRecordId' = ${sourceRecordId}`,
                ),
              )
              .limit(1);

          if (
            duplicate
          ) {
            skipped.push({
              sourceRecordId,
              reason:
                "Already assigned to this employee.",
            });

            continue;
          }

          const recordData =
            objectValue(
              sourceRecord.data,
            );

          const displayField =
            source.displayField ??
            "name";

          const label =
            String(
              recordData[
                displayField
              ] ??
              recordData.name ??
              recordData.title ??
              recordData.label ??
              sourceRecord.externalKey ??
              sourceRecordId,
            ).trim() ||
            sourceRecordId;

          const [
            workItem,
          ] =
            await db
              .insert(
                workItems,
              )
              .values({
                capabilityId:
                  responsibility.id,

                assigneeUserId,

                createdByUserId:
                  actorUserId,

                title:
                  `${responsibility.title}: ${label}`,

                description:
                  String(
                    req.body
                      ?.description ??
                    "",
                  ).trim() ||
                  `Assigned from ${entityType.title}.`,

                status:
                  "assigned",

                priority,

                dueAt,

                payload: {
                  kind:
                    "record_assignment",

                  responsibilityKey:
                    responsibility.key,

                  sourceKey:
                    source.key,

                  sourceEntityTypeKey:
                    entityType.key,

                  sourceRecordId,

                  sourceRecordLabel:
                    label,
                },
              })
              .returning();

          const [
            responsibilityRecord,
          ] =
            await db
              .insert(
                dynamicSubmissions,
              )
              .values({
                clientMutationId:
                  crypto.randomUUID(),

                userId:
                  assigneeUserId,

                capabilityId:
                  responsibility.id,

                workItemId:
                  workItem.id,

                status:
                  initialState,

                payload: {
                  __state: {
                    process:
                      initialState,
                  },

                  __source: {
                    sourceKey:
                      source.key,

                    sourceType:
                      "entity_store",

                    entityTypeKey:
                      entityType.key,

                    recordId:
                      sourceRecordId,

                    label,

                    data:
                      recordData,
                  },

                  __assignment: {
                    workItemId:
                      workItem.id,

                    assigneeUserId,

                    assignedByUserId:
                      actorUserId,

                    assignedAt:
                      new Date()
                        .toISOString(),
                  },
                },
              })
              .returning();

          await db
            .update(
              workItems,
            )
            .set({
              payload: {
                ...objectValue(
                  workItem.payload,
                ),

                kind:
                  "record_assignment",

                responsibilityKey:
                  responsibility.key,

                recordId:
                  responsibilityRecord.id,

                sourceKey:
                  source.key,

                sourceEntityTypeKey:
                  entityType.key,

                sourceRecordId,

                sourceRecordLabel:
                  label,
              },

              updatedAt:
                new Date(),
            })
            .where(
              eq(
                workItems.id,
                workItem.id,
              ),
            );

          await db
            .insert(
              recordLinks,
            )
            .values({
              fromSourceKey:
                source.key,

              fromRecordId:
                sourceRecordId,

              relationKey:
                "responsibility_record",

              targetSourceKey:
                `responsibility:${responsibility.key}`,

              targetRecordId:
                responsibilityRecord.id,

              metadata: {
                workItemId:
                  workItem.id,

                assigneeUserId,

                assignedByUserId:
                  actorUserId,

                assignedAt:
                  new Date()
                    .toISOString(),
              },
            });

          created.push({
            workItemId:
              workItem.id,

            recordId:
              responsibilityRecord.id,

            sourceRecordId,

            label,
          });
        }

        // BRIXTA_LINKED_RESPONSIBILITY_AUDIT_V1
        // The canonical CRM record is unchanged. Work items, Responsibility
        // records and record_links were created above; this creates a
        // traceable event in the SAME tenant DB transaction.
        if (created.length > 0) {
          await db.insert(platformAuditEvents).values(
            created.map((item) => ({
              actorUserId,
              eventType: "field.responsibility_started",
              subjectType: "entity_record",
              subjectId: item.sourceRecordId,
              payload: {
                title: `Responsibility started: ${responsibility.title}`,
                responsibilityKey: responsibility.key,
                responsibilityTitle: responsibility.title,
                responsibilityRecordId: item.recordId,
                workItemId: item.workItemId,
                assigneeUserId: assignee.id,
                assigneeName: assignee.name ?? assignee.username ?? `Employee ${assignee.id}`,
                byName: String(req.adminActor?.username ?? "Dashboard administrator"),
                sourceEntityTypeKey: entityType.key,
              },
            })),
          );
        }

        return res
          .status(201)
          .json({
            success: true,

            responsibility: {
              id:
                responsibility.id,

              key:
                responsibility.key,

              title:
                responsibility.title,
            },

            employee: {
              id:
                assignee.id,

              name:
                assignee.name ??
                assignee.username ??
                `Employee ${assignee.id}`,
            },

            created,

            skipped,
          });
      },
    ),
  );

  // BRIXTA_LINKED_RESPONSIBILITY_HANDOVER_V1
  // Reassign ownership of an EXISTING linked Responsibility. All writes occur
  // under withAdminTenantDb's single tenant transaction, no cloned records.
  router.post(
    "/work-items/:workItemId/handover",
    withAdminTenantDb<AdminRequest>(async (req, res, db) => {
      const actorUserId = req.adminActor?.userId ?? null;
      if (!actorUserId) {
        return res.status(403).json({ success: false, error: "An identified administrator is required." });
      }

      const workItemId = String(req.params.workItemId ?? "").trim();
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const nextUserId = Number(req.body?.newAssigneeUserId);
      const expectedUserId = Number(req.body?.expectedAssigneeUserId);
      const reason = String(req.body?.reason ?? "").trim();
      if (!uuidPattern.test(workItemId) || !Number.isSafeInteger(nextUserId) || nextUserId <= 0 ||
          !Number.isSafeInteger(expectedUserId) || expectedUserId <= 0 ||
          reason.length < 5 || reason.length > 300) {
        return res.status(400).json({
          success: false,
          error: "Valid work item, current/new assignees and a 5–300 character handover reason are required.",
        });
      }
      if (nextUserId === expectedUserId) {
        return res.status(409).json({ success: false, error: "Select a different employee." });
      }

      // Serialize concurrent handovers of the same work item.
      await db.execute(sql`SELECT id FROM work_items WHERE id = ${workItemId}::uuid FOR UPDATE`);
      const [work] = await db.select().from(workItems)
        .where(eq(workItems.id, workItemId)).limit(1);
      if (!work) return res.status(404).json({ success: false, error: "Work item not found." });
      const workPayload = objectValue(work.payload);
      const sourceRecordId = String(workPayload.sourceRecordId ?? "");
      const submissionRecordId = String(workPayload.recordId ?? "");
      if (workPayload.kind !== "record_assignment" || !uuidPattern.test(sourceRecordId) ||
          !uuidPattern.test(submissionRecordId)) {
        return res.status(409).json({ success: false, error: "Only linked CRM Responsibilities support handover." });
      }
      if (work.assigneeUserId !== expectedUserId) {
        return res.status(409).json({
          success: false, code: "ASSIGNEE_CHANGED",
          error: "The assignee changed since this page was opened. Refresh before handing over.",
        });
      }
      if (!(["assigned", "in_progress"] as string[]).includes(work.status) ||
          work.completedAt || work.cancelledAt) {
        return res.status(409).json({ success: false, error: "Completed or cancelled work cannot be transferred." });
      }

      const [newOwner] = await db.select({
        id: users.id, name: users.displayName, username: users.username,
        status: users.status, mobileAccess: users.isSalesAppUser,
      }).from(users).where(eq(users.id, nextUserId)).limit(1);
      if (!newOwner || newOwner.status !== "active" || newOwner.mobileAccess !== true) {
        return res.status(404).json({ success: false, error: "Select an active employee with mobile access." });
      }

      // A handover is not another work assignment; never create duplicate
      // active work for the same Responsibility, employee and source record.
      if (work.capabilityId !== null) {
        const [collision] = await db.select({ id: workItems.id }).from(workItems).where(and(
          eq(workItems.capabilityId, work.capabilityId),
          eq(workItems.assigneeUserId, nextUserId),
          inArray(workItems.status, ["assigned", "in_progress"]),
          sql`${workItems.payload}->>'sourceRecordId' = ${sourceRecordId}`,
          ne(workItems.id, workItemId),
        )).limit(1);
        if (collision) {
          return res.status(409).json({ success: false, error: "This employee already has active work for the same Responsibility and CRM record." });
        }
      }

      const [submission] = await db.select().from(dynamicSubmissions).where(and(
        eq(dynamicSubmissions.id, submissionRecordId),
        eq(dynamicSubmissions.workItemId, workItemId),
      )).limit(1);
      if (!submission || submission.status === "deleted" || submission.userId !== expectedUserId) {
        return res.status(409).json({ success: false, error: "The linked Responsibility record changed or is unavailable. Refresh." });
      }
      const [link] = await db.select().from(recordLinks).where(and(
        eq(recordLinks.fromRecordId, sourceRecordId),
        eq(recordLinks.targetRecordId, submissionRecordId),
        eq(recordLinks.relationKey, "responsibility_record"),
      )).limit(1);
      if (!link || objectValue(link.metadata).workItemId !== workItemId) {
        return res.status(409).json({ success: false, error: "The original CRM record link is missing or inconsistent." });
      }
      const originalPayload = objectValue(submission.payload);
      const originalAssignment = objectValue(originalPayload.__assignment);
      const time = new Date();
      const at = time.toISOString();
      const nextAssignment = {
        ...originalAssignment,
        assigneeUserId: nextUserId,
        previousAssigneeUserId: expectedUserId,
        reassignedByUserId: actorUserId,
        reassignedAt: at,
        handoverReason: reason,
      };

      // Optimistic concurrency protects employee edits made since read.
      // On mismatch we return BEFORE changing any work/link or emitting audit.
      const [updatedSubmission] = await db.update(dynamicSubmissions).set({
        userId: nextUserId,
        payload: { ...originalPayload, __assignment: nextAssignment },
        serverVersion: sql`${dynamicSubmissions.serverVersion} + 1`,
        updatedAt: time,
      }).where(and(
        eq(dynamicSubmissions.id, submission.id),
        eq(dynamicSubmissions.workItemId, workItemId),
        eq(dynamicSubmissions.userId, expectedUserId),
        eq(dynamicSubmissions.serverVersion, submission.serverVersion),
      )).returning();
      if (!updatedSubmission) {
        return res.status(409).json({
          success: false, code: "RECORD_VERSION_CONFLICT",
          error: "Employee progress changed during handover. Refresh and try again.",
        });
      }

      await db.update(workItems).set({
        assigneeUserId: nextUserId,
        payload: {
          ...workPayload,
          previousAssigneeUserId: expectedUserId,
          reassignedByUserId: actorUserId,
          reassignedAt: at,
          handoverCount: Number(workPayload.handoverCount ?? 0) + 1,
        },
        updatedAt: time,
      }).where(eq(workItems.id, workItemId));
      await db.update(recordLinks).set({
        metadata: {
          ...objectValue(link.metadata),
          assigneeUserId: nextUserId,
          previousAssigneeUserId: expectedUserId,
          reassignedByUserId: actorUserId,
          reassignedAt: at,
        },
      }).where(eq(recordLinks.id, link.id));

      await db.insert(applianceAuditLog).values({
        actorUserId, actorType: "admin", action: "responsibility.handover",
        entityType: "work_item", entityId: workItemId,
        beforeState: { assigneeUserId: expectedUserId, recordId: submission.id, serverVersion: submission.serverVersion },
        afterState: { assigneeUserId: nextUserId, recordId: submission.id, serverVersion: updatedSubmission.serverVersion },
        metadata: { reason, sourceRecordId, responsibilityKey: String(workPayload.responsibilityKey ?? ""), at },
      });
      await db.insert(platformAuditEvents).values({
        actorUserId,
        eventType: "field.responsibility_handed_over",
        subjectType: "entity_record", subjectId: sourceRecordId,
        payload: {
          title: "Responsibility handed over",
          responsibilityKey: String(workPayload.responsibilityKey ?? ""),
          workItemId,
          responsibilityRecordId: submission.id,
          previousAssigneeUserId: expectedUserId,
          assigneeUserId: nextUserId,
          assigneeName: newOwner.name ?? newOwner.username ?? `Employee ${nextUserId}`,
          reason,
          byName: req.adminActor?.username ?? "Dashboard administrator",
        },
      });

      return res.json({
        success: true,
        workItemId,
        recordId: submission.id,
        previousAssigneeUserId: expectedUserId,
        assigneeUserId: nextUserId,
        serverVersion: updatedSubmission.serverVersion,
        status: work.status,
      });
    }),
  );

  router.get(
    "/records",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const conditions: SQL[] = [];

        const responsibilityKey =
          typeof req.query.responsibilityKey ===
          "string"
            ? req.query.responsibilityKey
                .trim()
                .toLowerCase()
            : null;

        const userId =
          Number(
            req.query.userId,
          );

        const status =
          typeof req.query.status ===
          "string"
            ? req.query.status.trim()
            : null;

        if (responsibilityKey) {
          const [responsibility] =
            await db
              .select({
                id:
                  mobileCapabilities.id,
              })
              .from(
                mobileCapabilities,
              )
              .where(
                eq(
                  mobileCapabilities.key,
                  responsibilityKey,
                ),
              )
              .limit(1);

          if (!responsibility) {
            return res
              .status(404)
              .json({
                success: false,
                error:
                  "Responsibility not found.",
              });
          }

          conditions.push(
            eq(
              dynamicSubmissions.capabilityId,
              responsibility.id,
            ),
          );
        }

        if (
          Number.isInteger(userId) &&
          userId > 0
        ) {
          conditions.push(
            eq(
              dynamicSubmissions.userId,
              userId,
            ),
          );
        }

        if (status) {
          if (status !== "all") {
            conditions.push(
              eq(
                dynamicSubmissions.status,
                status,
              ),
            );
          }
        } else {
          conditions.push(
            ne(
              dynamicSubmissions.status,
              "deleted",
            ),
          );
        }

        // Free-text search across employee name/login and the record's
        // own JSON payload. Cast payload to text for a blunt but
        // effective ILIKE match -- avoids fetching everything and
        // filtering in Node, which doesn't scale past a few hundred rows.
        const search =
          typeof req.query.search === "string"
            ? req.query.search.trim()
            : null;

        if (search) {
          const pattern = `%${search}%`;
          conditions.push(
            or(
              ilike(users.displayName, pattern),
              ilike(users.salesmanLoginId, pattern),
              ilike(
                sql`${dynamicSubmissions.payload}::text`,
                pattern,
              ),
            )!,
          );
        }

        // Date range, inclusive. endDate is bumped to the start of the
        // next day so "endDate=2026-08-27" includes all of that day
        // rather than cutting off at midnight.
        const startDate =
          typeof req.query.startDate === "string"
            ? req.query.startDate.trim()
            : null;
        const endDate =
          typeof req.query.endDate === "string"
            ? req.query.endDate.trim()
            : null;

        if (startDate) {
          const parsed = new Date(`${startDate}T00:00:00.000Z`);
          if (!Number.isNaN(parsed.getTime())) {
            conditions.push(
              gte(dynamicSubmissions.createdAt, parsed),
            );
          }
        }

        if (endDate) {
          const parsed = new Date(`${endDate}T00:00:00.000Z`);
          if (!Number.isNaN(parsed.getTime())) {
            parsed.setUTCDate(parsed.getUTCDate() + 1);
            conditions.push(
              lt(dynamicSubmissions.createdAt, parsed),
            );
          }
        }

        const limit = Math.min(
          Math.max(
            Number(
              req.query.limit,
            ) || 200,
            1,
          ),
          1000,
        );

        const rows = await db
          .select({
            id:
              dynamicSubmissions.id,
            responsibilityId:
              mobileCapabilities.id,
            responsibilityKey:
              mobileCapabilities.key,
            responsibilityTitle:
              mobileCapabilities.title,
            userId:
              dynamicSubmissions.userId,
            employeeName:
              users.displayName,
            employeeCode:
              users.salesmanLoginId,
            status:
              dynamicSubmissions.status,
            payload:
              dynamicSubmissions.payload,
            serverVersion:
              dynamicSubmissions.serverVersion,
            createdAt:
              dynamicSubmissions.createdAt,
            updatedAt:
              dynamicSubmissions.updatedAt,
          })
          .from(
            dynamicSubmissions,
          )
          .innerJoin(
            mobileCapabilities,
            eq(
              dynamicSubmissions.capabilityId,
              mobileCapabilities.id,
            ),
          )
          .leftJoin(
            users,
            eq(
              dynamicSubmissions.userId,
              users.id,
            ),
          )
          .where(
            conditions.length
              ? and(...conditions)
              : undefined,
          )
          .orderBy(
            desc(
              dynamicSubmissions.updatedAt,
            ),
          )
          .limit(limit);

        return res.json({
          success: true,
          records:
            rows,
        });
      },
    ),
  );

  /*
   * BRIXTA_ADMIN_RECORD_EDIT_V1
   *
   * Dashboard administrators may correct EMPLOYEE-CAPTURED payload values.
   *
   * System-owned keys beginning with "__" are deliberately protected:
   * __state, __source, __assignment, __computed, etc.
   *
   * Optimistic concurrency via serverVersion prevents one admin from silently
   * overwriting a newer employee/admin change.
   *
   * Every correction is written to appliance_audit_log.
   */
  router.patch(
    "/records/:recordId",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const actorUserId =
          req.adminActor
            ?.userId ??
          null;

        if (
          !actorUserId
        ) {
          return res
            .status(403)
            .json({
              success:
                false,
              error:
                "A concrete dashboard administrator is required.",
            });
        }

        const recordId =
          String(
            req.params
              .recordId ??
            "",
          ).trim();

        if (
          !recordId
        ) {
          return res
            .status(400)
            .json({
              success:
                false,
              error:
                "recordId is required.",
            });
        }

        const expectedServerVersion =
          Number(
            req.body
              ?.expectedServerVersion,
          );

        if (
          !Number.isInteger(
            expectedServerVersion,
          ) ||
          expectedServerVersion <
            1
        ) {
          return res
            .status(400)
            .json({
              success:
                false,
              error:
                "expectedServerVersion is required. Refresh the record before editing.",
            });
        }

        const requestedPayload =
          objectValue(
            req.body
              ?.payload,
          );

        const keys =
          Object.keys(
            requestedPayload,
          );

        if (
          keys.length ===
          0
        ) {
          return res
            .status(400)
            .json({
              success:
                false,
              error:
                "At least one captured value is required.",
            });
        }

        const protectedKeys =
          keys.filter(
            (key) =>
              key.startsWith(
                "__",
              ),
          );

        if (
          protectedKeys.length >
          0
        ) {
          return res
            .status(400)
            .json({
              success:
                false,
              error:
                `System fields cannot be edited here: ${protectedKeys.join(", ")}`,
            });
        }

        const [
          existing,
        ] =
          await db
            .select()
            .from(
              dynamicSubmissions,
            )
            .where(
              eq(
                dynamicSubmissions.id,
                recordId,
              ),
            )
            .limit(1);

        if (
          !existing
        ) {
          return res
            .status(404)
            .json({
              success:
                false,
              error:
                "Responsibility record not found.",
            });
        }

        if (
          existing.status ===
          "deleted"
        ) {
          return res
            .status(409)
            .json({
              success:
                false,
              error:
                "Deleted records cannot be edited.",
            });
        }

        if (
          existing.serverVersion !==
          expectedServerVersion
        ) {
          return res
            .status(409)
            .json({
              success:
                false,
              code:
                "RECORD_VERSION_CONFLICT",
              error:
                "This record changed after you opened it. Refresh and try again.",
              currentServerVersion:
                existing.serverVersion,
            });
        }

        const previousPayload =
          objectValue(
            existing.payload,
          );

        const nextPayload = {
          ...previousPayload,
          ...requestedPayload,
        };

        const [
          updated,
        ] =
          await db
            .update(
              dynamicSubmissions,
            )
            .set({
              payload:
                nextPayload,

              serverVersion:
                existing.serverVersion +
                1,

              updatedAt:
                new Date(),
            })
            .where(
              and(
                eq(
                  dynamicSubmissions.id,
                  recordId,
                ),

                eq(
                  dynamicSubmissions.serverVersion,
                  expectedServerVersion,
                ),
              ),
            )
            .returning();

        if (
          !updated
        ) {
          return res
            .status(409)
            .json({
              success:
                false,
              code:
                "RECORD_VERSION_CONFLICT",
              error:
                "This record changed while you were saving. Refresh and try again.",
            });
        }

        await db
          .insert(
            applianceAuditLog,
          )
          .values({
            actorUserId,

            actorType:
              "admin",

            action:
              "responsibility_record.payload.update",

            entityType:
              "dynamic_submission",

            entityId:
              recordId,

            beforeState: {
              payload:
                previousPayload,
              serverVersion:
                existing.serverVersion,
            },

            afterState: {
              payload:
                updated.payload,
              serverVersion:
                updated.serverVersion,
            },

            metadata: {
              source:
                "responsibilities_records_tab",

              editedKeys:
                keys,
            },
          });

        return res.json({
          success:
            true,

          record:
            updated,
        });
      },
    ),
  );

  router.get(
    "/approvals",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const actorUserId =
          req.adminActor?.userId ??
          null;

        if (!actorUserId) {
          return res
            .status(403)
            .json({
              success: false,
              error:
                "A concrete dashboard user is required to resolve workflow approvals.",
            });
        }

        const status =
          typeof req.query.status ===
          "string"
            ? req.query.status
            : "pending";

        const rows = await db
          .select()
          .from(
            approvalRequests,
          )
          .where(
            and(
              eq(
                approvalRequests.sourceType,
                "workflow_step",
              ),
              status === "all"
                ? sql`true`
                : eq(
                    approvalRequests.status,
                    status,
                  ),
            ),
          )
          .orderBy(
            desc(
              approvalRequests.requestedAt,
            ),
          )
          .limit(500);

        const eligible = [] as typeof rows;

        for (const row of rows) {
          const payload =
            objectValue(
              row.payload,
            );
          const policyId =
            Number(
              payload.policyId,
            );
          const subjectUserId =
            Number(
              row.requesterUserId,
            );

          if (
            !Number.isInteger(policyId) ||
            policyId <= 0 ||
            !Number.isInteger(subjectUserId) ||
            subjectUserId <= 0
          ) {
            continue;
          }

          if (
            await userCanApprovePolicy(
              db,
              {
                policyId,
                subjectUserId,
                actorUserId,
              },
            )
          ) {
            eligible.push(row);
          }
        }

        const kernelDecisions =
          await listKernelDecisions(
            db,
            actorUserId,
            status ===
              "all"
              ? "all"
              : "pending",
            req.schemaName ??
              undefined,
          );

        /*
         * Pixel / Kernel is the more specific Responsibility reality.
         * If an inline Workflow approval and a Kernel decision both exist
         * for the same record, show the Kernel decision only.
         */
        const kernelRecordIds =
          new Set(
            kernelDecisions
              .map(
                (decision) =>
                  String(
                    decision
                      .recordId ??
                    objectValue(
                      decision.payload,
                    ).recordId ??
                    "",
                  ),
              )
              .filter(Boolean),
          );

        const workflowInstanceIds =
          eligible
            .map(
              (row) =>
                String(
                  objectValue(
                    row.payload,
                  )
                    .workflowInstanceId ??
                  "",
                ),
            )
            .filter(Boolean);

        const workflowContexts =
          workflowInstanceIds.length
            ? await db
                .select({
                  id:
                    workflowInstances.id,

                  contextType:
                    workflowInstances.contextType,

                  contextId:
                    workflowInstances.contextId,
                })
                .from(
                  workflowInstances,
                )
                .where(
                  inArray(
                    workflowInstances.id,
                    workflowInstanceIds,
                  ),
                )
            : [];

        const contextByWorkflow =
          new Map(
            workflowContexts.map(
              (item) => [
                item.id,
                item,
              ],
            ),
          );

        const workflowApprovals =
          eligible.filter(
            (row) => {
              const workflowInstanceId =
                String(
                  objectValue(
                    row.payload,
                  )
                    .workflowInstanceId ??
                  "",
                );

              const context =
                contextByWorkflow.get(
                  workflowInstanceId,
                );

              return !(
                context
                  ?.contextType ===
                  "responsibility_record" &&
                context.contextId &&
                kernelRecordIds.has(
                  context.contextId,
                )
              );
            },
          );

        return res.json({
          success: true,

          approvals: [
            ...workflowApprovals,
            ...kernelDecisions,
          ],
        });
      },
    ),
  );

  router.patch(
    "/approvals/:id/decision",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const actorUserId =
          req.adminActor?.userId ??
          null;

        if (!actorUserId) {
          return res
            .status(403)
            .json({
              success: false,
              error:
                "A concrete dashboard user is required for workflow approval.",
            });
        }

        const decision =
          String(
            req.body?.decision ??
              "",
          );

        if (
          decision !== "approved" &&
          decision !== "rejected"
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "decision must be approved or rejected.",
            });
        }

        const approvalId =
          String(
            req.params.id,
          );

        if (
          approvalId.startsWith(
            "kernel:",
          )
        ) {
          const result =
            await decideKernelDecision(
              db,
              {
                approvalId,

                actorUserId,

                decision,

                note:
                  String(
                    req.body
                      ?.note ??
                    "",
                  ).trim() ||
                  null,
              },
            );

          if (!result.ok) {
            return res
              .status(
                result.status,
              )
              .json({
                success:
                  false,

                code:
                  result.code,

                error:
                  result.error,
              });
          }

          return res.json({
            success:
              true,

            approval:
              result.approval,

            source:
              "kernel",
          });
        }

        const result =
          await decideWorkflowApproval(
            db,
            {
              approvalRequestId:
                String(
                  req.params.id,
                ),
              actorUserId,
              decision,
              note:
                String(
                  req.body?.note ??
                    "",
                ).trim() ||
                null,
            },
          );

        if (!result.ok) {
          return res
            .status(
              result.status,
            )
            .json({
              success: false,
              code:
                result.code,
              error:
                result.error,
            });
        }

        return res.json({
          success: true,
          approval:
            result.approval,
          workflowInstanceId:
            result.workflowInstanceId,
        });
      },
    ),
  );

  /**
   * Kernel-native action execution for admins/managers.
   *
   * Some Responsibilities (e.g. Leave, via responsibility-kernel-catalog's
   * addActionRule) define their own self-contained approve/reject actions
   * with real state-changing rules -- but until this route existed there
   * was no way to actually invoke them from the dashboard. This reuses
   * the exact same executeKernelAction runtime the mobile app calls at
   * POST /api/salesApp/responsibilities/:key/actions/:actionId, just
   * authenticated as the dashboard admin instead of the field employee.
   */
  /*
   * Actor-projected runtime for Dashboard records.
   * Same Kernel as Flutter; different authenticated surface.
   */
  router.get(
    "/records/:responsibilityKey/:recordId/runtime",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const actorUserId =
          req.adminActor
            ?.userId ??
          null;

        if (!actorUserId) {
          return res
            .status(403)
            .json({
              success: false,
              error:
                "A concrete dashboard user is required.",
            });
        }

        return sendResult(
          res,
          await getKernelRuntime(
            db,
            {
              userId:
                actorUserId,
              responsibilityKey:
                String(
                  req.params
                    .responsibilityKey,
                ),
              recordId:
                String(
                  req.params
                    .recordId,
                ),
            },
          ),
        );
      },
    ),
  );

  router.post(
    "/records/:responsibilityKey/:recordId/actions/:actionId",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const actorUserId =
          req.adminActor?.userId ??
          null;

        if (!actorUserId) {
          return res
            .status(403)
            .json({
              success: false,
              error:
                "A concrete dashboard user is required to run this action.",
            });
        }

        const result = await executeKernelAction(
          db,
          {
            userId: actorUserId,
            responsibilityKey:
              String(req.params.responsibilityKey),
            actionId:
              String(req.params.actionId),
            recordId:
              String(req.params.recordId ?? "").trim() ||
              null,
            payload:
              req.body?.payload ?? {},
          },
        );

        return sendResult(res, result);
      },
    ),
  );

  /**
   * Control Center feed: only things that exist because of current
   * Responsibilities and Workflows. No attendance/TA-DA/etc. hardcoding.
   */
  router.get(
    "/runtime",
    withAdminTenantDb<AdminRequest>(
      async (
        _req,
        res,
        db,
      ) => {
        const definitions = await db
          .select()
          .from(
            workflowDefinitions,
          )
          .where(
            eq(
              workflowDefinitions.isActive,
              true,
            ),
          )
          .orderBy(
            asc(
              workflowDefinitions.name,
            ),
          );

        const versionRows = definitions.length
          ? await db
              .select()
              .from(
                workflowVersions,
              )
              .where(
                inArray(
                  workflowVersions.workflowId,
                  definitions.map(
                    (item) => item.id,
                  ),
                ),
              )
              .orderBy(
                asc(
                  workflowVersions.workflowId,
                ),
                desc(
                  workflowVersions.version,
                ),
              )
          : [];

        const latestPublished =
          new Map<number, typeof versionRows[number]>();

        for (const version of versionRows) {
          if (
            version.status ===
              "published" &&
            !latestPublished.has(
              version.workflowId,
            )
          ) {
            latestPublished.set(
              version.workflowId,
              version,
            );
          }
        }

        const versionIds = [
          ...latestPublished.values(),
        ].map(
          (version) =>
            version.id,
        );

        const [
          stepRows,
          instanceCounts,
          stepCounts,
          recordCounts,
        ] = await Promise.all([
          versionIds.length
            ? db
                .select({
                  id:
                    workflowSteps.id,
                  workflowVersionId:
                    workflowSteps.workflowVersionId,
                  stepKey:
                    workflowSteps.stepKey,
                  title:
                    workflowSteps.title,
                  stepType:
                    workflowSteps.stepType,
                  actionKey:
                    actionDefinitions.key,
                  sortOrder:
                    workflowSteps.sortOrder,
                })
                .from(
                  workflowSteps,
                )
                .leftJoin(
                  actionDefinitions,
                  eq(
                    workflowSteps.actionDefinitionId,
                    actionDefinitions.id,
                  ),
                )
                .where(
                  inArray(
                    workflowSteps.workflowVersionId,
                    versionIds,
                  ),
                )
                .orderBy(
                  asc(
                    workflowSteps.workflowVersionId,
                  ),
                  asc(
                    workflowSteps.sortOrder,
                  ),
                )
            : Promise.resolve([]),

          versionIds.length
            ? db
                .select({
                  workflowVersionId:
                    workflowInstances.workflowVersionId,
                  status:
                    workflowInstances.status,
                  count:
                    sql<number>`count(*)::int`,
                })
                .from(
                  workflowInstances,
                )
                .where(
                  inArray(
                    workflowInstances.workflowVersionId,
                    versionIds,
                  ),
                )
                .groupBy(
                  workflowInstances.workflowVersionId,
                  workflowInstances.status,
                )
            : Promise.resolve([]),

          versionIds.length
            ? db
                .select({
                  workflowVersionId:
                    workflowInstances.workflowVersionId,
                  workflowStepId:
                    workflowStepInstances.workflowStepId,
                  status:
                    workflowStepInstances.status,
                  count:
                    sql<number>`count(*)::int`,
                })
                .from(
                  workflowStepInstances,
                )
                .innerJoin(
                  workflowInstances,
                  eq(
                    workflowStepInstances.workflowInstanceId,
                    workflowInstances.id,
                  ),
                )
                .where(
                  inArray(
                    workflowInstances.workflowVersionId,
                    versionIds,
                  ),
                )
                .groupBy(
                  workflowInstances.workflowVersionId,
                  workflowStepInstances.workflowStepId,
                  workflowStepInstances.status,
                )
            : Promise.resolve([]),

          db
            .select({
              responsibilityId:
                mobileCapabilities.id,
              responsibilityKey:
                mobileCapabilities.key,
              title:
                mobileCapabilities.title,
              count:
                sql<number>`count(${dynamicSubmissions.id})::int`,
            })
            .from(
              mobileCapabilities,
            )
            .leftJoin(
              dynamicSubmissions,
              eq(
                dynamicSubmissions.capabilityId,
                mobileCapabilities.id,
              ),
            )
            .where(
              eq(
                mobileCapabilities.isActive,
                true,
              ),
            )
            .groupBy(
              mobileCapabilities.id,
              mobileCapabilities.key,
              mobileCapabilities.title,
            )
            .orderBy(
              asc(
                mobileCapabilities.title,
              ),
            ),
        ]);

        return res.json({
          success: true,
          responsibilities:
            recordCounts,
          workflows:
            definitions.map(
              (definition) => {
                const version =
                  latestPublished.get(
                    definition.id,
                  );

                if (!version) {
                  return {
                    ...definition,
                    version: null,
                    instances: [],
                    steps: [],
                  };
                }

                return {
                  ...definition,
                  version: {
                    id:
                      version.id,
                    number:
                      version.version,
                  },
                  instances:
                    instanceCounts.filter(
                      (row) =>
                        row.workflowVersionId ===
                        version.id,
                    ),
                  steps:
                    stepRows
                      .filter(
                        (step) =>
                          step.workflowVersionId ===
                          version.id,
                      )
                      .map(
                        (step) => ({
                          ...step,
                          states:
                            stepCounts.filter(
                              (row) =>
                                row.workflowVersionId ===
                                  version.id &&
                                row.workflowStepId ===
                                  step.id,
                            ),
                        }),
                      ),
                };
              },
            ),
        });
      },
    ),
  );
}