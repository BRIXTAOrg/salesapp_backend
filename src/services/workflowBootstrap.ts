import {
  and,
  asc,
  eq,
  inArray,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../db/db";

import {
  approvalRequests,
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
  userCanApprovePolicy,
} from "./approvalPolicyResolver";

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function getWorkflowBootstrapForUser(
  db: AppDatabase,
  userId: number,
) {
  const instances = await db
    .select({
      id:
        workflowInstances.id,
      workflowVersionId:
        workflowInstances.workflowVersionId,
      status:
        workflowInstances.status,
      contextType:
        workflowInstances.contextType,
      contextId:
        workflowInstances.contextId,
      context:
        workflowInstances.context,
      startedAt:
        workflowInstances.startedAt,
      updatedAt:
        workflowInstances.updatedAt,

      workflowId:
        workflowDefinitions.id,
      workflowKey:
        workflowDefinitions.key,
      workflowName:
        workflowDefinitions.name,

      version:
        workflowVersions.version,
    })
    .from(workflowInstances)
    .innerJoin(
      workflowVersions,
      eq(
        workflowInstances.workflowVersionId,
        workflowVersions.id,
      ),
    )
    .innerJoin(
      workflowDefinitions,
      eq(
        workflowVersions.workflowId,
        workflowDefinitions.id,
      ),
    )
    .where(
      and(
        eq(
          workflowInstances.subjectUserId,
          userId,
        ),
        eq(
          workflowInstances.status,
          "active",
        ),
      ),
    )
    .orderBy(
      asc(
        workflowInstances.startedAt,
      ),
    );

  const instanceIds =
    instances.map(
      (instance) =>
        instance.id,
    );

  const steps =
    instanceIds.length
      ? await db
          .select({
            stepInstanceId:
              workflowStepInstances.id,
            workflowInstanceId:
              workflowStepInstances.workflowInstanceId,
            status:
              workflowStepInstances.status,
            blockedReason:
              workflowStepInstances.blockedReason,
            activatedAt:
              workflowStepInstances.activatedAt,
            sourceType:
              workflowStepInstances.sourceType,
            sourceId:
              workflowStepInstances.sourceId,

            stepId:
              workflowSteps.id,
            stepKey:
              workflowSteps.stepKey,
            title:
              workflowSteps.title,
            stepType:
              workflowSteps.stepType,
            sortOrder:
              workflowSteps.sortOrder,

            actionKey:
              actionDefinitions.key,
            actionTitle:
              actionDefinitions.title,
            handlerKey:
              actionDefinitions.handlerKey,
            capabilityId:
              actionDefinitions.capabilityId,
          })
          .from(workflowStepInstances)
          .innerJoin(
            workflowSteps,
            eq(
              workflowStepInstances.workflowStepId,
              workflowSteps.id,
            ),
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
              workflowStepInstances.workflowInstanceId,
              instanceIds,
            ),
          )
          .orderBy(
            asc(
              workflowStepInstances.workflowInstanceId,
            ),
            asc(
              workflowSteps.sortOrder,
            ),
          )
      : [];

  const readyActions = steps
    .filter(
      (step) =>
        step.stepType ===
          "action" &&
        Boolean(
          step.actionKey,
        ) &&
        step.actionKey!.startsWith(
          "responsibility.",
        ) &&
        (
          step.status ===
            "ready" ||
          step.status ===
            "in_progress"
        ),
    )
    .map(
      (step) => {
        const instance =
          instances.find(
            (item) =>
              item.id ===
              step.workflowInstanceId,
          );

        return {
          workflowInstanceId:
            step.workflowInstanceId,
          stepInstanceId:
            step.stepInstanceId,
          actionKey:
            step.actionKey,
          title:
            step.actionTitle ??
            step.title,
          handlerKey:
            step.handlerKey,
          capabilityId:
            step.capabilityId,
          sourceType:
            step.sourceType,
          sourceId:
            step.sourceId,
          contextType:
            instance?.contextType ??
            null,
          contextId:
            instance?.contextId ??
            null,
          status:
            step.status,
        };
      },
    );

  const blockedActions = steps
    .filter(
      (step) =>
        step.stepType ===
          "action" &&
        Boolean(
          step.actionKey,
        ) &&
        step.actionKey!.startsWith(
          "responsibility.",
        ) &&
        step.status ===
          "blocked",
    )
    .map(
      (step) => {
        const instance =
          instances.find(
            (item) =>
              item.id ===
              step.workflowInstanceId,
          );

        return {
          workflowInstanceId:
            step.workflowInstanceId,
          stepInstanceId:
            step.stepInstanceId,
          actionKey:
            step.actionKey,
          title:
            step.actionTitle ??
            step.title,
          handlerKey:
            step.handlerKey,
          capabilityId:
            step.capabilityId,
          sourceType:
            step.sourceType,
          sourceId:
            step.sourceId,
          contextType:
            instance?.contextType ??
            null,
          contextId:
            instance?.contextId ??
            null,
          reason:
            step.blockedReason ??
            "PREREQUISITE_PENDING",
        };
      },
    );

  const legacyReadyActions = steps
    .filter(
      (step) =>
        step.stepType ===
          "action" &&
        Boolean(
          step.actionKey,
        ) &&
        !step.actionKey!.startsWith(
          "responsibility.",
        ) &&
        (
          step.status ===
            "ready" ||
          step.status ===
            "in_progress"
        ),
    )
    .map(
      (step) => ({
        workflowInstanceId:
          step.workflowInstanceId,
        stepInstanceId:
          step.stepInstanceId,
        actionKey:
          step.actionKey,
        title:
          step.actionTitle ??
          step.title,
        handlerKey:
          step.handlerKey,
        capabilityId:
          step.capabilityId,
        sourceType:
          step.sourceType,
        sourceId:
          step.sourceId,
        reason:
          "LEGACY_ACTION_NOT_MIGRATED",
      }),
    );

  const pendingRows = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(
          approvalRequests.sourceType,
          "workflow_step",
        ),
        eq(
          approvalRequests.status,
          "pending",
        ),
      ),
    );

  const pendingApprovals: Array<
    typeof pendingRows[number] & {
      workflowInstanceId:
        string | null;
      workflowStepInstanceId:
        string | null;
      workflowKey:
        string | null;
      workflowName:
        string | null;
      stepKey:
        string | null;
    }
  > = [];

  for (const approval of pendingRows) {
    const payload =
      objectValue(
        approval.payload,
      );

    const policyId =
      Number(
        payload.policyId,
      );

    const requesterUserId =
      Number(
        approval.requesterUserId,
      );

    if (
      !Number.isInteger(
        policyId,
      ) ||
      policyId <= 0 ||
      !Number.isInteger(
        requesterUserId,
      ) ||
      requesterUserId <= 0
    ) {
      continue;
    }

    const eligible =
      await userCanApprovePolicy(
        db,
        {
          policyId,
          subjectUserId:
            requesterUserId,
          actorUserId:
            userId,
        },
      );

    if (!eligible) {
      continue;
    }

    pendingApprovals.push({
      ...approval,
      workflowInstanceId:
        typeof payload.workflowInstanceId ===
        "string"
          ? payload.workflowInstanceId
          : null,
      workflowStepInstanceId:
        typeof payload.workflowStepInstanceId ===
        "string"
          ? payload.workflowStepInstanceId
          : null,
      workflowKey:
        typeof payload.workflowKey ===
        "string"
          ? payload.workflowKey
          : null,
      workflowName:
        typeof payload.workflowName ===
        "string"
          ? payload.workflowName
          : null,
      stepKey:
        typeof payload.stepKey ===
        "string"
          ? payload.stepKey
          : null,
    });
  }

  return {
    instances: instances.map(
      (instance) => ({
        ...instance,
        steps:
          steps.filter(
            (step) =>
              step.workflowInstanceId ===
              instance.id,
          ),
      }),
    ),

    readyActions,
    blockedActions: [
      ...blockedActions,
      ...legacyReadyActions,
    ],
    pendingApprovals,
  };
}
