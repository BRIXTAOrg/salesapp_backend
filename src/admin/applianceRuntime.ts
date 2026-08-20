import type {
  Router,
} from "express";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  mobileCapabilities,
  users,
} from "../db/schema";

import {
  approvalRequests,
  dynamicSubmissions,
} from "../db/applianceSchema";

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

        return res.json({
          success: true,
          approvals:
            eligible,
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
