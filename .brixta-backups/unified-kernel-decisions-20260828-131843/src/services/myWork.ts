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
  workItems,
} from "../db/applianceSchema";

import {
  mobileCapabilities,
} from "../db/schema";

import {
  getWorkflowBootstrapForUser,
} from "./workflowBootstrap";

import {
  listKernelDecisions,
} from "./kernelDecisionInbox";

export async function getMyWork(
  db: AppDatabase,
  userId: number,
) {
  const workflow =
    await getWorkflowBootstrapForUser(
      db,
      userId,
    );

  const assigned = await db
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.assigneeUserId, userId),
        inArray(
          workItems.status,
          ["assigned", "in_progress"],
        ),
      ),
    )
    .orderBy(
      asc(workItems.dueAt),
      asc(workItems.createdAt),
    )
    .limit(200);

  const capabilityIds = [
    ...new Set(
      assigned
        .map((item) => item.capabilityId)
        .filter((id): id is number => Number.isInteger(id)),
    ),
  ];

  const capabilities = capabilityIds.length
    ? await db
        .select({
          id: mobileCapabilities.id,
          key: mobileCapabilities.key,
          title: mobileCapabilities.title,
          icon: mobileCapabilities.icon,
        })
        .from(mobileCapabilities)
        .where(
          inArray(
            mobileCapabilities.id,
            capabilityIds,
          ),
        )
    : [];

  const capabilityMap =
    new Map(
      capabilities.map((item) => [item.id, item]),
    );

  const kernelApprovals =
    await listKernelDecisions(
      db,
      userId,
      "pending",
    );

  const kernelDecisionWorkIds =
    new Set(
      kernelApprovals
        .map(
          (approval) =>
            String(
              (
                approval.payload &&
                typeof approval.payload ===
                  "object" &&
                !Array.isArray(
                  approval.payload,
                )
              )
                ? (
                    approval.payload as
                    Record<
                      string,
                      unknown
                    >
                  ).workItemId ??
                  ""
                : "",
            ),
        )
        .filter(Boolean),
    );

  const ordinaryAssigned =
    assigned.filter(
      (item) => {
        const payload =
          (
            item.payload &&
            typeof item.payload ===
              "object" &&
            !Array.isArray(
              item.payload,
            )
          )
            ? item.payload as
              Record<
                string,
                unknown
              >
            : {};

        /*
         * Decision work belongs under Approvals.
         * Notifications and other assigned work remain Ready Work.
         */
        if (
          payload.kind ===
          "kernel_decision"
        ) {
          return false;
        }

        return !kernelDecisionWorkIds.has(
          item.id,
        );
      },
    );

  /*
   * Pixel/Kernel decision projection and legacy Workflow approvals are
   * presented through the exact same mobile "approvals" collection.
   */
  return {
    ready: [
      ...workflow.readyActions.map((action) => ({
        kind:
          "workflow_action",
        ...action,
      })),

      ...ordinaryAssigned.map((item) => ({
        kind:
          "assigned_work",

        id:
          item.id,

        title:
          item.title,

        description:
          item.description,

        status:
          item.status,

        priority:
          item.priority,

        dueAt:
          item.dueAt,

        payload:
          item.payload,

        responsibility:
          item.capabilityId
            ? capabilityMap.get(
                item.capabilityId,
              ) ?? null
            : null,
      })),
    ],

    blocked:
      workflow.blockedActions,

    approvals: [
      ...workflow.pendingApprovals,
      ...kernelApprovals,
    ],

    workflowInstances:
      workflow.instances,
  };
}
