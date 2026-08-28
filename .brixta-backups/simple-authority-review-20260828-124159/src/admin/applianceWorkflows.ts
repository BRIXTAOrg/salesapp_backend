import type { Router } from "express";

import { asc, desc, eq } from "drizzle-orm";

import { mobileCapabilities, roles } from "../db/schema";

import {
  actionDefinitions,
  approvalPolicies,
  approvalPolicyActors,
  workflowDefinitions,
  workflowStepDependencies,
  workflowSteps,
  workflowVersions,
} from "../db/workflowSchema";

import type { AppDatabase } from "../db/db";

import {
  withAdminTenantDb,
  type AdminRequest,
} from "../middleware/adminService";

import {
  ensureResponsibilityActions,
  getResponsibilityByKey,
  responsibilityActionKey,
} from "../platform/responsibility";

import type { CrudOperation } from "../platform/primitives";

import { writeAudit } from "../services/audit";

function normalizeKey(input: unknown) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value.map(Number).filter((item) => Number.isInteger(item) && item > 0),
    ),
  ];
}

const CRUD_OPERATIONS = new Set<CrudOperation>([
  "create",
  "read",
  "update",
  "delete",
]);

type CreateVersionInput = {
  workflowId: number;
  workflowKey: string;
  workflowName: string;
  version: number;
  steps: unknown[];
  actorUserId: number | null;
};

async function createPublishedVersion(
  db: AppDatabase,
  input: CreateVersionInput,
) {
  if (!input.steps.length) {
    throw new Error("Workflow requires at least one step.");
  }

  const first = objectValue(input.steps[0]);

  if (String(first.stepType ?? "action") !== "action") {
    throw new Error(
      "The first workflow step must be a CRUD action so the runtime has an event that starts the workflow.",
    );
  }

  const [version] = await db
    .insert(workflowVersions)
    .values({
      workflowId: input.workflowId,
      version: input.version,
      status: "published",
      createdByUserId: input.actorUserId,
      publishedAt: new Date(),
    })
    .returning();

  let previous: {
    id: number;
    stepType: string;
  } | null = null;

  for (let index = 0; index < input.steps.length; index += 1) {
    const raw = objectValue(input.steps[index]);

    const stepType = String(raw.stepType ?? "action");

    if (stepType !== "action" && stepType !== "approval") {
      throw new Error(
        `Step ${index + 1}: only action and approval nodes are supported by this runtime.`,
      );
    }

    const title = String(
      raw.title ?? (stepType === "approval" ? "Approval" : `Step ${index + 1}`),
    ).trim();

    if (!title) {
      throw new Error(`Step ${index + 1}: title is required.`);
    }

    let actionDefinitionId: number | null = null;
    let approvalPolicyId: number | null = null;
    let stepConfig: Record<string, unknown> = {};

    if (stepType === "action") {
      const responsibilityKey = normalizeKey(raw.responsibilityKey);

      const operation = String(raw.operation ?? "create") as CrudOperation;

      if (!responsibilityKey || !CRUD_OPERATIONS.has(operation)) {
        throw new Error(
          `Step ${index + 1}: valid responsibilityKey and CRUD operation are required.`,
        );
      }

      const responsibility = await getResponsibilityByKey(
        db,
        responsibilityKey,
      );

      if (!responsibility) {
        throw new Error(
          `Step ${index + 1}: Responsibility ${responsibilityKey} does not exist or is disabled.`,
        );
      }

      await ensureResponsibilityActions(db, responsibility);

      const actionKey = responsibilityActionKey(responsibility.key, operation);

      const [action] = await db
        .select({
          id: actionDefinitions.id,
        })
        .from(actionDefinitions)
        .where(eq(actionDefinitions.key, actionKey))
        .limit(1);

      if (!action) {
        throw new Error(
          `Step ${index + 1}: action definition ${actionKey} could not be created.`,
        );
      }

      actionDefinitionId = action.id;

      stepConfig = {
        responsibilityId: responsibility.id,
        responsibilityKey: responsibility.key,
        operation,
      };
    }

    if (stepType === "approval") {
      const approverKind =
        raw.approverKind === "reports_to" ? "reports_to" : "role";

      const roleIds = numberArray(raw.approverRoleIds);

      if (approverKind === "role" && !roleIds.length) {
        throw new Error(
          `Step ${index + 1}: choose who should verify this step.`,
        );
      }

      const policyKey = `${input.workflowKey}_v${input.version}_step_${index + 1}_approval`;

      const [policy] = await db
        .insert(approvalPolicies)
        .values({
          key: policyKey,
          name: `${input.workflowName} — ${title}`,
          mode: "any",
          minimumApprovals: 1,
          enabled: true,
          config: {
            origin: "workflow_builder",
          },
          createdByUserId: input.actorUserId,
        })
        .returning();

      approvalPolicyId = policy.id;

      await db.insert(approvalPolicyActors).values(
        approverKind === "reports_to"
          ? [
              {
                policyId: policy.id,
                subjectType: "reports_to",
                roleId: null,
                userId: null,
                scopeType: null,
                scopeConfig: {},
                sequence: 0,
                enabled: true,
              },
            ]
          : roleIds.map((roleId) => ({
              policyId: policy.id,
              subjectType: "role",
              roleId,
              userId: null,
              scopeType: null,
              scopeConfig: {},
              sequence: 0,
              enabled: true,
            })),
      );

      stepConfig = {
        approverKind,
        approverRoleIds: roleIds,
      };
    }

    const [step] = await db
      .insert(workflowSteps)
      .values({
        workflowVersionId: version.id,
        stepKey: `step_${index + 1}_${normalizeKey(title) || "node"}`,
        title,
        stepType,
        actionDefinitionId,
        approvalPolicyId,
        sortOrder: (index + 1) * 10,
        config: stepConfig,
      })
      .returning();

    if (previous) {
      await db.insert(workflowStepDependencies).values({
        stepId: step.id,
        dependsOnStepId: previous.id,
        requiredStatus:
          previous.stepType === "approval" ? "approved" : "completed",
      });
    }

    previous = {
      id: step.id,
      stepType,
    };
  }

  return version;
}

export function registerWorkflowAdminRoutes(router: Router) {
  router.get(
    "/workflows",
    withAdminTenantDb<AdminRequest>(async (_req, res, db) => {
      const [
        definitions,
        versions,
        steps,
        dependencies,
        responsibilities,
        roleRows,
      ] = await Promise.all([
        db
          .select()
          .from(workflowDefinitions)
          .orderBy(asc(workflowDefinitions.name)),

        db
          .select()
          .from(workflowVersions)
          .orderBy(
            asc(workflowVersions.workflowId),
            desc(workflowVersions.version),
          ),

        db
          .select({
            id: workflowSteps.id,
            workflowVersionId: workflowSteps.workflowVersionId,
            stepKey: workflowSteps.stepKey,
            title: workflowSteps.title,
            stepType: workflowSteps.stepType,
            actionDefinitionId: workflowSteps.actionDefinitionId,
            actionKey: actionDefinitions.key,
            handlerKey: actionDefinitions.handlerKey,
            approvalPolicyId: workflowSteps.approvalPolicyId,
            sortOrder: workflowSteps.sortOrder,
            config: workflowSteps.config,
          })
          .from(workflowSteps)
          .leftJoin(
            actionDefinitions,
            eq(workflowSteps.actionDefinitionId, actionDefinitions.id),
          )
          .orderBy(
            asc(workflowSteps.workflowVersionId),
            asc(workflowSteps.sortOrder),
          ),

        db.select().from(workflowStepDependencies),

        db
          .select({
            id: mobileCapabilities.id,
            key: mobileCapabilities.key,
            title: mobileCapabilities.title,
            isActive: mobileCapabilities.isActive,
          })
          .from(mobileCapabilities)
          .where(eq(mobileCapabilities.isActive, true))
          .orderBy(asc(mobileCapabilities.title)),

        db
          .select({
            id: roles.id,
            orgRole: roles.orgRole,
            jobRole: roles.jobRole,
          })
          .from(roles)
          .orderBy(asc(roles.orgRole), asc(roles.jobRole)),
      ]);

      return res.json({
        success: true,
        workflows: definitions.map((definition) => ({
          ...definition,
          versions: versions
            .filter((version) => version.workflowId === definition.id)
            .map((version) => ({
              ...version,
              steps: steps
                .filter((step) => step.workflowVersionId === version.id)
                .map((step) => ({
                  ...step,
                  dependencies: dependencies.filter(
                    (dependency) => dependency.stepId === step.id,
                  ),
                })),
            })),
        })),
        responsibilities,
        roles: roleRows.map((role) => ({
          id: role.id,
          label:
            role.jobRole && role.orgRole
              ? `${role.orgRole} · ${role.jobRole}`
              : (role.orgRole ?? role.jobRole ?? `Role ${role.id}`),
        })),
        operations: ["create", "read", "update", "delete"],
      });
    }),
  );

  router.post(
    "/workflows",
    withAdminTenantDb<AdminRequest>(async (req, res, db) => {
      const name = String(req.body?.name ?? "").trim();
      const key = normalizeKey(req.body?.key || name);
      const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];

      if (!name || !key || !steps.length) {
        return res.status(400).json({
          success: false,
          error: "name and at least one workflow step are required.",
        });
      }

      try {
        const [workflow] = await db
          .insert(workflowDefinitions)
          .values({
            key,
            name,
            description: String(req.body?.description ?? "").trim() || null,
            isActive: true,
            createdByUserId: req.adminActor?.userId ?? null,
          })
          .returning();

        const version = await createPublishedVersion(db, {
          workflowId: workflow.id,
          workflowKey: workflow.key,
          workflowName: workflow.name,
          version: 1,
          steps,
          actorUserId: req.adminActor?.userId ?? null,
        });

        await writeAudit(db, {
          actorUserId: req.adminActor?.userId,
          action: "workflow.create",
          entityType: "workflow",
          entityId: workflow.id,
          afterState: {
            workflow,
            version,
          },
        });

        return res.status(201).json({
          success: true,
          workflow,
          version,
        });
      } catch (error: any) {
        return res.status(400).json({
          success: false,
          error: error?.message ?? "Unable to create workflow.",
        });
      }
    }),
  );

  router.post(
    "/workflows/:id/versions",
    withAdminTenantDb<AdminRequest>(async (req, res, db) => {
      const workflowId = Number(req.params.id);
      const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];

      if (!Number.isInteger(workflowId) || workflowId <= 0 || !steps.length) {
        return res.status(400).json({
          success: false,
          error: "Valid workflow ID and steps are required.",
        });
      }

      const [workflow] = await db
        .select()
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.id, workflowId))
        .limit(1);

      if (!workflow) {
        return res.status(404).json({
          success: false,
          error: "Workflow not found.",
        });
      }

      const [latest] = await db
        .select()
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, workflowId))
        .orderBy(desc(workflowVersions.version))
        .limit(1);

      const nextVersion = (latest?.version ?? 0) + 1;

      try {
        if (latest) {
          await db
            .update(workflowVersions)
            .set({
              status: "retired",
            })
            .where(eq(workflowVersions.id, latest.id));
        }

        const version = await createPublishedVersion(db, {
          workflowId,
          workflowKey: workflow.key,
          workflowName: workflow.name,
          version: nextVersion,
          steps,
          actorUserId: req.adminActor?.userId ?? null,
        });

        return res.status(201).json({
          success: true,
          version,
        });
      } catch (error: any) {
        return res.status(400).json({
          success: false,
          error: error?.message ?? "Unable to publish workflow version.",
        });
      }
    }),
  );

  router.patch(
    "/workflows/:id",
    withAdminTenantDb<AdminRequest>(async (req, res, db) => {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid workflow ID.",
        });
      }

      const update: {
        name?: string;
        description?: string | null;
        isActive?: boolean;
        updatedAt: Date;
      } = {
        updatedAt: new Date(),
      };

      if ("name" in (req.body ?? {})) {
        update.name = String(req.body.name ?? "").trim();
      }

      if ("description" in (req.body ?? {})) {
        update.description = String(req.body.description ?? "").trim() || null;
      }

      if ("isActive" in (req.body ?? {})) {
        update.isActive = Boolean(req.body.isActive);
      }

      const [updated] = await db
        .update(workflowDefinitions)
        .set(update)
        .where(eq(workflowDefinitions.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: "Workflow not found.",
        });
      }

      return res.json({
        success: true,
        workflow: updated,
      });
    }),
  );
}
