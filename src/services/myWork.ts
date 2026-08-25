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

  return {
    ready: [
      ...workflow.readyActions.map((action) => ({
        kind: "workflow_action",
        ...action,
      })),
      ...assigned.map((item) => ({
        kind: "assigned_work",
        id: item.id,
        title: item.title,
        description: item.description,
        status: item.status,
        priority: item.priority,
        dueAt: item.dueAt,
        payload: item.payload,
        responsibility:
          item.capabilityId
            ? capabilityMap.get(item.capabilityId) ?? null
            : null,
      })),
    ],
    blocked:
      workflow.blockedActions,
    approvals:
      workflow.pendingApprovals,
    workflowInstances:
      workflow.instances,
  };
}
