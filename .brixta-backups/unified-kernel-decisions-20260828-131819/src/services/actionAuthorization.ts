import {
  and,
  eq,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../db/db";

import {
  actionDefinitions,
} from "../db/workflowSchema";

import {
  getResolvedCapabilitiesForUser,
} from "./capabilityResolver";

import {
  getWorkflowGateForAction,
  type WorkflowGate,
} from "./workflowEngine";

export type ActionAuthorization =
  | ({
      allowed: true;
      capabilityId:
        number | null;
    } & WorkflowGate)
  | ({
      allowed: false;
      status: number;
      capabilityId:
        number | null;
    } & WorkflowGate);

/**
 * Canonical server-side gate:
 *  1. action exists + active;
 *  2. employee is assigned the Responsibility tied to that action;
 *  3. workflow state allows the action now.
 */
export async function authorizeAction(
  db: AppDatabase,
  input: {
    actorUserId: number;
    subjectUserId?: number;
    actionKey: string;
    workflowInstanceId?: string | null;
    contextType?: string | null;
    contextId?: string | null;
    allowCompleted?: boolean;
  },
): Promise<ActionAuthorization> {
  const [action] = await db
    .select({
      capabilityId:
        actionDefinitions.capabilityId,
    })
    .from(
      actionDefinitions,
    )
    .where(
      and(
        eq(
          actionDefinitions.key,
          input.actionKey,
        ),
        eq(
          actionDefinitions.isActive,
          true,
        ),
      ),
    )
    .limit(1);

  if (!action) {
    return {
      allowed: false,
      status: 404,
      capabilityId: null,
      code:
        "WORKFLOW_STEP_BLOCKED",
      reason:
        "Action definition does not exist.",
    };
  }

  const capabilityId =
    action.capabilityId ??
    null;

  if (capabilityId) {
    const resolved =
      await getResolvedCapabilitiesForUser(
        db,
        input.actorUserId,
      );

    if (
      !resolved.some(
        (capability) =>
          capability.id ===
          capabilityId,
      )
    ) {
      return {
        allowed: false,
        status: 403,
        capabilityId,
        code:
          "WORKFLOW_STEP_BLOCKED",
        reason:
          "This Responsibility is not assigned to the employee.",
      };
    }
  }

  const workflow =
    await getWorkflowGateForAction(
      db,
      {
        actionKey:
          input.actionKey,
        subjectUserId:
          input.subjectUserId ??
          input.actorUserId,
        workflowInstanceId:
          input.workflowInstanceId,
        contextType:
          input.contextType,
        contextId:
          input.contextId,
      },
    );

  if (!workflow.allowed) {
    if (
      input.allowCompleted &&
      workflow.code ===
        "WORKFLOW_STEP_ALREADY_COMPLETED"
    ) {
      return {
        ...workflow,
        allowed: true,
        capabilityId,
      };
    }

    return {
      ...workflow,
      allowed: false,
      status:
        workflow.code ===
        "WORKFLOW_REJECTED"
          ? 403
          : 409,
      capabilityId,
    };
  }

  return {
    ...workflow,
    allowed: true,
    capabilityId,
  };
}
