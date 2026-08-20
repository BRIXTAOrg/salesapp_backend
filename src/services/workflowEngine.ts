import {
  and,
  asc,
  desc,
  eq,
  inArray,
  type SQL,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../db/db";

import {
  approvalRequests,
} from "../db/applianceSchema";

import {
  actionDefinitions,
  approvalPolicies,
  workflowDefinitions,
  workflowInstances,
  workflowStepDependencies,
  workflowStepInstances,
  workflowSteps,
  workflowVersions,
} from "../db/workflowSchema";

import {
  resolveApprovalPolicy,
  userCanApprovePolicy,
} from "./approvalPolicyResolver";

export type WorkflowGate = {
  allowed: boolean;
  code:
    | "OK"
    | "WORKFLOW_CONTEXT_REQUIRED"
    | "WORKFLOW_CONTEXT_NOT_FOUND"
    | "WORKFLOW_STEP_BLOCKED"
    | "WORKFLOW_APPROVAL_PENDING"
    | "WORKFLOW_STEP_ALREADY_COMPLETED"
    | "WORKFLOW_REJECTED";
  reason?: string;
  startsWorkflow?: boolean;
  workflowInstanceId?: string;
  stepInstanceId?: string;
};

type ActionBinding = {
  workflowId: number;
  workflowKey: string;
  workflowName: string;
  versionId: number;
  version: number;
  stepId: number;
  stepKey: string;
  stepTitle: string;
  stepType: string;
  approvalPolicyId: number | null;
  isRoot: boolean;
};

type ExistingActionState = {
  workflowInstanceId: string;
  workflowStatus: string;
  contextType: string | null;
  contextId: string | null;
  stepInstanceId: string;
  stepStatus: string;
  stepId: number;
  stepTitle: string;
  stepType: string;
  blockedReason: string | null;
  actionKey: string;
};

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function dependencySatisfied(
  actual: string,
  required: string,
) {
  if (required === "completed") {
    return actual === "completed" ||
      actual === "approved";
  }

  return actual === required;
}

async function currentActionBindings(
  db: AppDatabase,
  actionKey: string,
): Promise<ActionBinding[]> {
  const rows = await db
    .select({
      workflowId:
        workflowDefinitions.id,
      workflowKey:
        workflowDefinitions.key,
      workflowName:
        workflowDefinitions.name,
      versionId:
        workflowVersions.id,
      version:
        workflowVersions.version,
      stepId:
        workflowSteps.id,
      stepKey:
        workflowSteps.stepKey,
      stepTitle:
        workflowSteps.title,
      stepType:
        workflowSteps.stepType,
      approvalPolicyId:
        workflowSteps.approvalPolicyId,
    })
    .from(actionDefinitions)
    .innerJoin(
      workflowSteps,
      eq(
        workflowSteps.actionDefinitionId,
        actionDefinitions.id,
      ),
    )
    .innerJoin(
      workflowVersions,
      eq(
        workflowSteps.workflowVersionId,
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
          actionDefinitions.key,
          actionKey,
        ),
        eq(
          actionDefinitions.isActive,
          true,
        ),
        eq(
          workflowDefinitions.isActive,
          true,
        ),
        eq(
          workflowVersions.status,
          "published",
        ),
      ),
    )
    .orderBy(
      asc(
        workflowDefinitions.id,
      ),
      desc(
        workflowVersions.version,
      ),
      asc(
        workflowSteps.sortOrder,
      ),
    );

  const latestVersionByWorkflow =
    new Map<number, number>();

  for (const row of rows) {
    if (
      !latestVersionByWorkflow.has(
        row.workflowId,
      )
    ) {
      latestVersionByWorkflow.set(
        row.workflowId,
        row.versionId,
      );
    }
  }

  const selected = rows.filter(
    (row) =>
      latestVersionByWorkflow.get(
        row.workflowId,
      ) === row.versionId,
  );

  const stepIds = selected.map(
    (row) => row.stepId,
  );

  const dependencies = stepIds.length
    ? await db
        .select({
          stepId:
            workflowStepDependencies.stepId,
        })
        .from(
          workflowStepDependencies,
        )
        .where(
          inArray(
            workflowStepDependencies.stepId,
            stepIds,
          ),
        )
    : [];

  const dependentSteps =
    new Set(
      dependencies.map(
        (row) => row.stepId,
      ),
    );

  return selected.map(
    (row) => ({
      ...row,
      isRoot:
        !dependentSteps.has(
          row.stepId,
        ),
    }),
  );
}

async function existingActionStates(
  db: AppDatabase,
  input: {
    actionKey: string;
    subjectUserId: number;
    workflowInstanceId?: string | null;
    contextType?: string | null;
    contextId?: string | null;
  },
): Promise<ExistingActionState[]> {
  const conditions: SQL[] = [
    eq(
      workflowInstances.subjectUserId,
      input.subjectUserId,
    ),
    eq(
      actionDefinitions.key,
      input.actionKey,
    ),
  ];

  if (input.workflowInstanceId) {
    conditions.push(
      eq(
        workflowInstances.id,
        input.workflowInstanceId,
      ),
    );
  } else if (
    input.contextType &&
    input.contextId
  ) {
    conditions.push(
      eq(
        workflowInstances.contextType,
        input.contextType,
      ),
    );
    conditions.push(
      eq(
        workflowInstances.contextId,
        input.contextId,
      ),
    );
  } else {
    return [];
  }

  return db
    .select({
      workflowInstanceId:
        workflowInstances.id,
      workflowStatus:
        workflowInstances.status,
      contextType:
        workflowInstances.contextType,
      contextId:
        workflowInstances.contextId,
      stepInstanceId:
        workflowStepInstances.id,
      stepStatus:
        workflowStepInstances.status,
      blockedReason:
        workflowStepInstances.blockedReason,
      stepId:
        workflowSteps.id,
      stepTitle:
        workflowSteps.title,
      stepType:
        workflowSteps.stepType,
      actionKey:
        actionDefinitions.key,
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
    .innerJoin(
      workflowSteps,
      eq(
        workflowStepInstances.workflowStepId,
        workflowSteps.id,
      ),
    )
    .innerJoin(
      actionDefinitions,
      eq(
        workflowSteps.actionDefinitionId,
        actionDefinitions.id,
      ),
    )
    .where(
      and(...conditions),
    );
}

/**
 * Answers only the workflow-state question. Responsibility assignment is
 * enforced by actionAuthorization.ts before we get here.
 */
export async function getWorkflowGateForAction(
  db: AppDatabase,
  input: {
    actionKey: string;
    subjectUserId: number;
    workflowInstanceId?: string | null;
    contextType?: string | null;
    contextId?: string | null;
  },
): Promise<WorkflowGate> {
  const states =
    await existingActionStates(
      db,
      input,
    );

  if (states.length) {
    const rejected = states.find(
      (state) =>
        state.workflowStatus ===
          "rejected" ||
        state.stepStatus ===
          "rejected",
    );

    if (rejected) {
      return {
        allowed: false,
        code:
          "WORKFLOW_REJECTED",
        reason:
          "This workflow has been rejected.",
        workflowInstanceId:
          rejected.workflowInstanceId,
        stepInstanceId:
          rejected.stepInstanceId,
      };
    }

    const blocked = states.find(
      (state) =>
        state.stepStatus ===
        "blocked",
    );

    if (blocked) {
      return {
        allowed: false,
        code:
          "WORKFLOW_STEP_BLOCKED",
        reason:
          blocked.blockedReason ??
          "A prerequisite is still pending.",
        workflowInstanceId:
          blocked.workflowInstanceId,
        stepInstanceId:
          blocked.stepInstanceId,
      };
    }

    const approval = states.find(
      (state) =>
        state.stepStatus ===
        "pending_approval",
    );

    if (approval) {
      return {
        allowed: false,
        code:
          "WORKFLOW_APPROVAL_PENDING",
        reason:
          "Approval is required before this action can continue.",
        workflowInstanceId:
          approval.workflowInstanceId,
        stepInstanceId:
          approval.stepInstanceId,
      };
    }

    const executable = states.find(
      (state) =>
        state.stepStatus ===
          "ready" ||
        state.stepStatus ===
          "in_progress",
    );

    if (executable) {
      return {
        allowed: true,
        code: "OK",
        workflowInstanceId:
          executable.workflowInstanceId,
        stepInstanceId:
          executable.stepInstanceId,
      };
    }

    const completed = states.find(
      (state) =>
        state.stepStatus ===
          "completed" ||
        state.stepStatus ===
          "approved",
    );

    if (completed) {
      return {
        allowed: false,
        code:
          "WORKFLOW_STEP_ALREADY_COMPLETED",
        reason:
          "This workflow step is already complete.",
        workflowInstanceId:
          completed.workflowInstanceId,
        stepInstanceId:
          completed.stepInstanceId,
      };
    }
  }

  const bindings =
    await currentActionBindings(
      db,
      input.actionKey,
    );

  // No active workflow constrains the CRUD action.
  if (!bindings.length) {
    return {
      allowed: true,
      code: "OK",
    };
  }

  // Root action may start a new workflow instance after the record write.
  if (
    bindings.every(
      (binding) =>
        binding.isRoot,
    )
  ) {
    return {
      allowed: true,
      code: "OK",
      startsWorkflow: true,
    };
  }

  if (
    !input.workflowInstanceId &&
    !(
      input.contextType &&
      input.contextId
    )
  ) {
    return {
      allowed: false,
      code:
        "WORKFLOW_CONTEXT_REQUIRED",
      reason:
        "This CRUD action belongs to an existing workflow instance.",
    };
  }

  return {
    allowed: false,
    code:
      "WORKFLOW_CONTEXT_NOT_FOUND",
    reason:
      "No matching workflow instance was found for this action.",
  };
}

async function createApprovalRequestForStep(
  db: AppDatabase,
  input: {
    stepInstanceId: string;
    workflowInstanceId: string;
  },
) {
  const [existing] = await db
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
        eq(
          approvalRequests.sourceId,
          input.stepInstanceId,
        ),
        eq(
          approvalRequests.status,
          "pending",
        ),
      ),
    )
    .limit(1);

  if (existing) {
    return existing;
  }

  const [row] = await db
    .select({
      subjectUserId:
        workflowInstances.subjectUserId,
      workflowKey:
        workflowDefinitions.key,
      workflowName:
        workflowDefinitions.name,
      stepId:
        workflowSteps.id,
      stepKey:
        workflowSteps.stepKey,
      stepTitle:
        workflowSteps.title,
      policyId:
        workflowSteps.approvalPolicyId,
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
    .innerJoin(
      workflowSteps,
      eq(
        workflowStepInstances.workflowStepId,
        workflowSteps.id,
      ),
    )
    .innerJoin(
      workflowVersions,
      eq(
        workflowSteps.workflowVersionId,
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
      eq(
        workflowStepInstances.id,
        input.stepInstanceId,
      ),
    )
    .limit(1);

  if (
    !row ||
    !row.policyId
  ) {
    return null;
  }

  const policy =
    await resolveApprovalPolicy(
      db,
      {
        policyId:
          row.policyId,
        subjectUserId:
          row.subjectUserId,
      },
    );

  const [created] = await db
    .insert(
      approvalRequests,
    )
    .values({
      sourceType:
        "workflow_step",
      sourceId:
        input.stepInstanceId,
      areaKey:
        `workflow:${row.workflowKey}:${row.stepKey}`,
      title:
        row.stepTitle,
      requesterUserId:
        row.subjectUserId,
      assignedAdminUserId:
        policy?.eligibleUserIds[0] ??
        null,
      payload: {
        workflowInstanceId:
          input.workflowInstanceId,
        workflowStepInstanceId:
          input.stepInstanceId,
        workflowStepId:
          row.stepId,
        workflowKey:
          row.workflowKey,
        workflowName:
          row.workflowName,
        stepKey:
          row.stepKey,
        policyId:
          row.policyId,
        eligibleUserIds:
          policy?.eligibleUserIds ??
          [],
      },
    })
    .returning();

  return created;
}

async function refreshWorkflowTerminalState(
  db: AppDatabase,
  workflowInstanceId: string,
) {
  const rows = await db
    .select({
      status:
        workflowStepInstances.status,
    })
    .from(
      workflowStepInstances,
    )
    .where(
      eq(
        workflowStepInstances.workflowInstanceId,
        workflowInstanceId,
      ),
    );

  if (
    rows.some(
      (row) =>
        row.status ===
        "rejected",
    )
  ) {
    await db
      .update(
        workflowInstances,
      )
      .set({
        status:
          "rejected",
        updatedAt:
          new Date(),
      })
      .where(
        and(
          eq(
            workflowInstances.id,
            workflowInstanceId,
          ),
          eq(
            workflowInstances.status,
            "active",
          ),
        ),
      );
    return;
  }

  const allTerminal =
    rows.length > 0 &&
    rows.every(
      (row) =>
        row.status ===
          "completed" ||
        row.status ===
          "approved" ||
        row.status ===
          "cancelled",
    );

  if (allTerminal) {
    const now =
      new Date();

    await db
      .update(
        workflowInstances,
      )
      .set({
        status:
          "completed",
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(
            workflowInstances.id,
            workflowInstanceId,
          ),
          eq(
            workflowInstances.status,
            "active",
          ),
        ),
      );
  }
}

/**
 * Re-evaluate blocked nodes and activate anything whose dependencies are
 * now satisfied. Approval nodes create their own approval request.
 */
export async function advanceWorkflowInstance(
  db: AppDatabase,
  workflowInstanceId: string,
) {
  for (
    let pass = 0;
    pass < 20;
    pass += 1
  ) {
    const stepRows = await db
      .select({
        stepInstanceId:
          workflowStepInstances.id,
        stepId:
          workflowSteps.id,
        stepType:
          workflowSteps.stepType,
        status:
          workflowStepInstances.status,
      })
      .from(
        workflowStepInstances,
      )
      .innerJoin(
        workflowSteps,
        eq(
          workflowStepInstances.workflowStepId,
          workflowSteps.id,
        ),
      )
      .where(
        eq(
          workflowStepInstances.workflowInstanceId,
          workflowInstanceId,
        ),
      );

    const stepIds = stepRows.map(
      (row) => row.stepId,
    );

    const dependencyRows = stepIds.length
      ? await db
          .select()
          .from(
            workflowStepDependencies,
          )
          .where(
            inArray(
              workflowStepDependencies.stepId,
              stepIds,
            ),
          )
      : [];

    const statusByStep =
      new Map(
        stepRows.map(
          (row) => [
            row.stepId,
            row.status,
          ],
        ),
      );

    let changed = false;

    for (const step of stepRows) {
      if (
        step.status !==
        "blocked"
      ) {
        continue;
      }

      const dependencies =
        dependencyRows.filter(
          (row) =>
            row.stepId ===
            step.stepId,
        );

      if (!dependencies.length) {
        continue;
      }

      const satisfied =
        dependencies.every(
          (dependency) => {
            const actual =
              statusByStep.get(
                dependency.dependsOnStepId,
              );

            return Boolean(
              actual &&
              dependencySatisfied(
                actual,
                dependency.requiredStatus,
              ),
            );
          },
        );

      if (!satisfied) {
        continue;
      }

      const nextStatus =
        step.stepType ===
        "approval"
          ? "pending_approval"
          : "ready";

      const now =
        new Date();

      const [updated] = await db
        .update(
          workflowStepInstances,
        )
        .set({
          status:
            nextStatus,
          activatedAt:
            now,
          blockedReason:
            null,
          updatedAt:
            now,
        })
        .where(
          and(
            eq(
              workflowStepInstances.id,
              step.stepInstanceId,
            ),
            eq(
              workflowStepInstances.status,
              "blocked",
            ),
          ),
        )
        .returning();

      if (!updated) {
        continue;
      }

      changed = true;

      if (
        nextStatus ===
        "pending_approval"
      ) {
        await createApprovalRequestForStep(
          db,
          {
            stepInstanceId:
              step.stepInstanceId,
            workflowInstanceId,
          },
        );
      }
    }

    if (!changed) {
      break;
    }
  }

  await refreshWorkflowTerminalState(
    db,
    workflowInstanceId,
  );
}

async function startRootWorkflows(
  db: AppDatabase,
  input: {
    actionKey: string;
    subjectUserId: number;
    actorUserId: number;
    contextType: string;
    contextId: string;
    context?: Record<string, unknown>;
    sourceType: string;
    sourceId: string;
  },
) {
  const bindings = (
    await currentActionBindings(
      db,
      input.actionKey,
    )
  ).filter(
    (binding) =>
      binding.isRoot,
  );

  const started: string[] = [];

  for (const binding of bindings) {
    const [existing] = await db
      .select({
        id:
          workflowInstances.id,
      })
      .from(
        workflowInstances,
      )
      .where(
        and(
          eq(
            workflowInstances.workflowVersionId,
            binding.versionId,
          ),
          eq(
            workflowInstances.subjectUserId,
            input.subjectUserId,
          ),
          eq(
            workflowInstances.contextType,
            input.contextType,
          ),
          eq(
            workflowInstances.contextId,
            input.contextId,
          ),
        ),
      )
      .limit(1);

    if (existing) {
      started.push(
        existing.id,
      );
      continue;
    }

    const [instance] = await db
      .insert(
        workflowInstances,
      )
      .values({
        workflowVersionId:
          binding.versionId,
        subjectUserId:
          input.subjectUserId,
        status: "active",
        contextType:
          input.contextType,
        contextId:
          input.contextId,
        context:
          input.context ?? {},
      })
      .returning();

    const [
      steps,
      dependencies,
    ] = await Promise.all([
      db
        .select({
          id:
            workflowSteps.id,
          stepType:
            workflowSteps.stepType,
          actionKey:
            actionDefinitions.key,
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
          eq(
            workflowSteps.workflowVersionId,
            binding.versionId,
          ),
        )
        .orderBy(
          asc(
            workflowSteps.sortOrder,
          ),
        ),

      db
        .select({
          stepId:
            workflowStepDependencies.stepId,
        })
        .from(
          workflowStepDependencies,
        )
        .innerJoin(
          workflowSteps,
          eq(
            workflowStepDependencies.stepId,
            workflowSteps.id,
          ),
        )
        .where(
          eq(
            workflowSteps.workflowVersionId,
            binding.versionId,
          ),
        ),
    ]);

    const dependentSteps =
      new Set(
        dependencies.map(
          (row) =>
            row.stepId,
        ),
      );

    for (const step of steps) {
      const isRoot =
        !dependentSteps.has(
          step.id,
        );

      const isTrigger =
        step.id ===
          binding.stepId &&
        step.actionKey ===
          input.actionKey;

      let status =
        "blocked";

      if (isTrigger) {
        status = "completed";
      } else if (isRoot) {
        status =
          step.stepType ===
          "approval"
            ? "pending_approval"
            : "ready";
      }

      const now =
        new Date();

      const [createdStep] = await db
        .insert(
          workflowStepInstances,
        )
        .values({
          workflowInstanceId:
            instance.id,
          workflowStepId:
            step.id,
          status,
          actorUserId:
            isTrigger
              ? input.actorUserId
              : null,
          sourceType:
            isTrigger
              ? input.sourceType
              : null,
          sourceId:
            isTrigger
              ? input.sourceId
              : null,
          blockedReason:
            status === "blocked"
              ? "PREREQUISITE_PENDING"
              : null,
          activatedAt:
            status !== "blocked"
              ? now
              : null,
          completedAt:
            status === "completed"
              ? now
              : null,
          updatedAt:
            now,
        })
        .returning();

      if (
        status ===
        "pending_approval"
      ) {
        await createApprovalRequestForStep(
          db,
          {
            stepInstanceId:
              createdStep.id,
            workflowInstanceId:
              instance.id,
          },
        );
      }
    }

    await advanceWorkflowInstance(
      db,
      instance.id,
    );

    started.push(
      instance.id,
    );
  }

  return started;
}

/**
 * Called after a generic CRUD mutation succeeds. The CRUD mutation and
 * workflow transition run in the same tenant transaction.
 */
export async function recordCompletedWorkflowAction(
  db: AppDatabase,
  input: {
    actionKey: string;
    subjectUserId: number;
    actorUserId: number;
    workflowInstanceId?: string | null;
    contextType?: string | null;
    contextId?: string | null;
    context?: Record<string, unknown>;
    sourceType: string;
    sourceId: string;
  },
) {
  const states =
    await existingActionStates(
      db,
      {
        actionKey:
          input.actionKey,
        subjectUserId:
          input.subjectUserId,
        workflowInstanceId:
          input.workflowInstanceId,
        contextType:
          input.contextType,
        contextId:
          input.contextId,
      },
    );

  let completedExisting =
    false;

  for (const state of states) {
    if (
      state.stepStatus !==
        "ready" &&
      state.stepStatus !==
        "in_progress"
    ) {
      continue;
    }

    const now =
      new Date();

    const [updated] = await db
      .update(
        workflowStepInstances,
      )
      .set({
        status:
          "completed",
        actorUserId:
          input.actorUserId,
        sourceType:
          input.sourceType,
        sourceId:
          input.sourceId,
        completedAt:
          now,
        updatedAt:
          now,
      })
      .where(
        and(
          eq(
            workflowStepInstances.id,
            state.stepInstanceId,
          ),
          inArray(
            workflowStepInstances.status,
            [
              "ready",
              "in_progress",
            ],
          ),
        ),
      )
      .returning();

    if (!updated) {
      continue;
    }

    completedExisting =
      true;

    await advanceWorkflowInstance(
      db,
      state.workflowInstanceId,
    );
  }

  if (completedExisting) {
    return {
      completedExisting:
        true,
      startedWorkflowInstanceIds:
        [] as string[],
    };
  }

  if (
    !input.contextType ||
    !input.contextId
  ) {
    return {
      completedExisting:
        false,
      startedWorkflowInstanceIds:
        [] as string[],
    };
  }

  const started =
    await startRootWorkflows(
      db,
      {
        actionKey:
          input.actionKey,
        subjectUserId:
          input.subjectUserId,
        actorUserId:
          input.actorUserId,
        contextType:
          input.contextType,
        contextId:
          input.contextId,
        context:
          input.context,
        sourceType:
          input.sourceType,
        sourceId:
          input.sourceId,
      },
    );

  return {
    completedExisting:
      false,
    startedWorkflowInstanceIds:
      started,
  };
}

export type WorkflowDecisionResult =
  | {
      ok: true;
      approval:
        typeof approvalRequests.$inferSelect;
      workflowInstanceId: string;
      stepInstanceId: string;
    }
  | {
      ok: false;
      status: number;
      code: string;
      error: string;
    };

/**
 * Current runtime fully supports any-one approval. Multi-vote policies
 * need a vote ledger and are rejected instead of being approximated.
 */
export async function decideWorkflowApproval(
  db: AppDatabase,
  input: {
    approvalRequestId: string;
    actorUserId: number;
    decision:
      | "approved"
      | "rejected";
    note?: string | null;
  },
): Promise<WorkflowDecisionResult> {
  const [approval] = await db
    .select()
    .from(
      approvalRequests,
    )
    .where(
      and(
        eq(
          approvalRequests.id,
          input.approvalRequestId,
        ),
        eq(
          approvalRequests.sourceType,
          "workflow_step",
        ),
      ),
    )
    .limit(1);

  if (!approval) {
    return {
      ok: false,
      status: 404,
      code:
        "WORKFLOW_APPROVAL_NOT_FOUND",
      error:
        "Workflow approval was not found.",
    };
  }

  if (
    approval.status !==
    "pending"
  ) {
    return {
      ok: false,
      status: 409,
      code:
        "WORKFLOW_APPROVAL_ALREADY_DECIDED",
      error:
        "This approval has already been decided.",
    };
  }

  const payload =
    objectValue(
      approval.payload,
    );

  const policyId =
    Number(
      payload.policyId,
    );

  const stepInstanceId =
    String(
      payload.workflowStepInstanceId ??
        approval.sourceId,
    );

  if (
    !Number.isInteger(
      policyId,
    ) ||
    policyId <= 0 ||
    !stepInstanceId
  ) {
    return {
      ok: false,
      status: 409,
      code:
        "WORKFLOW_APPROVAL_INVALID",
      error:
        "Workflow approval metadata is incomplete.",
    };
  }

  const [stepInstance] = await db
    .select({
      id:
        workflowStepInstances.id,
      workflowInstanceId:
        workflowStepInstances.workflowInstanceId,
      status:
        workflowStepInstances.status,
      subjectUserId:
        workflowInstances.subjectUserId,
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
      eq(
        workflowStepInstances.id,
        stepInstanceId,
      ),
    )
    .limit(1);

  if (!stepInstance) {
    return {
      ok: false,
      status: 404,
      code:
        "WORKFLOW_STEP_NOT_FOUND",
      error:
        "Workflow approval step was not found.",
    };
  }

  if (
    stepInstance.status !==
    "pending_approval"
  ) {
    return {
      ok: false,
      status: 409,
      code:
        "WORKFLOW_STEP_NOT_PENDING",
      error:
        "The workflow step is no longer awaiting approval.",
    };
  }

  const [policy] = await db
    .select({
      mode:
        approvalPolicies.mode,
      minimumApprovals:
        approvalPolicies.minimumApprovals,
    })
    .from(
      approvalPolicies,
    )
    .where(
      eq(
        approvalPolicies.id,
        policyId,
      ),
    )
    .limit(1);

  if (
    !policy ||
    policy.mode !== "any" ||
    policy.minimumApprovals > 1
  ) {
    return {
      ok: false,
      status: 409,
      code:
        "WORKFLOW_APPROVAL_MODE_UNSUPPORTED",
      error:
        "This policy needs multi-vote tracking, which is not enabled yet.",
    };
  }

  const eligible =
    await userCanApprovePolicy(
      db,
      {
        policyId,
        subjectUserId:
          stepInstance.subjectUserId,
        actorUserId:
          input.actorUserId,
      },
    );

  if (!eligible) {
    return {
      ok: false,
      status: 403,
      code:
        "WORKFLOW_APPROVER_NOT_ELIGIBLE",
      error:
        "This user is not eligible to approve this workflow step.",
    };
  }

  const now =
    new Date();

  const [updatedApproval] = await db
    .update(
      approvalRequests,
    )
    .set({
      status:
        input.decision,
      decidedAt:
        now,
      decidedByUserId:
        input.actorUserId,
      decisionNote:
        input.note?.trim() ||
        null,
      updatedAt:
        now,
    })
    .where(
      and(
        eq(
          approvalRequests.id,
          input.approvalRequestId,
        ),
        eq(
          approvalRequests.status,
          "pending",
        ),
      ),
    )
    .returning();

  if (!updatedApproval) {
    return {
      ok: false,
      status: 409,
      code:
        "WORKFLOW_APPROVAL_CONFLICT",
      error:
        "The approval changed before this decision could be saved.",
    };
  }

  const [updatedStep] = await db
    .update(
      workflowStepInstances,
    )
    .set({
      status:
        input.decision,
      actorUserId:
        input.actorUserId,
      completedAt:
        now,
      updatedAt:
        now,
    })
    .where(
      and(
        eq(
          workflowStepInstances.id,
          stepInstanceId,
        ),
        eq(
          workflowStepInstances.status,
          "pending_approval",
        ),
      ),
    )
    .returning();

  if (!updatedStep) {
    return {
      ok: false,
      status: 409,
      code:
        "WORKFLOW_STEP_CONFLICT",
      error:
        "The workflow step changed before this decision could be saved.",
    };
  }

  if (
    input.decision ===
    "approved"
  ) {
    await advanceWorkflowInstance(
      db,
      stepInstance.workflowInstanceId,
    );
  } else {
    await db
      .update(
        workflowInstances,
      )
      .set({
        status:
          "rejected",
        updatedAt:
          now,
      })
      .where(
        eq(
          workflowInstances.id,
          stepInstance.workflowInstanceId,
        ),
      );
  }

  return {
    ok: true,
    approval:
      updatedApproval,
    workflowInstanceId:
      stepInstance.workflowInstanceId,
    stepInstanceId,
  };
}
