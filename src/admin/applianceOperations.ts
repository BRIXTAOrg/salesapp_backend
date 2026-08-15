import type { Router } from "express";

import {
  and,
  asc,
  desc,
  eq,
  type SQL,
} from "drizzle-orm";

import { db } from "../db/db";
import { users } from "../db/schema";
import {
  adminOwnershipRules,
  approvalRequests,
  attentionItems,
  deviceRegistrations,
  usageEvents,
  userPins,
  workspaceSettings,
  workItems,
} from "../db/applianceSchema";
import type { AdminRequest } from "../middleware/adminService";
import { resolveAdminOwner } from "../services/ownerResolver";
import { writeAudit } from "../services/audit";

export function registerOperationsAdminRoutes(router: Router) {
  router.get("/work-items", async (req, res) => {
    const assigneeUserId = Number(req.query.assigneeUserId);
    const status =
      typeof req.query.status === "string"
        ? req.query.status
        : null;

    const conditions: SQL[] = [];

    if (Number.isInteger(assigneeUserId) && assigneeUserId > 0) {
      conditions.push(
        eq(workItems.assigneeUserId, assigneeUserId),
      );
    }

    if (status) {
      conditions.push(eq(workItems.status, status));
    }

    const rows = await db
      .select()
      .from(workItems)
      .where(
        conditions.length
          ? and(...conditions)
          : undefined,
      )
      .orderBy(desc(workItems.createdAt))
      .limit(500);

    return res.json({
      success: true,
      workItems: rows,
    });
  });

  router.post("/work-items", async (req: AdminRequest, res) => {
    const {
      capabilityId,
      assigneeUserId,
      title,
      description,
      priority = "normal",
      dueAt,
      payload = {},
      approvalRequired = false,
      approvalAreaKey,
    } = req.body ?? {};

    if (
      !Number.isInteger(Number(assigneeUserId)) ||
      !String(title ?? "").trim()
    ) {
      return res.status(400).json({
        success: false,
        error: "assigneeUserId and title are required.",
      });
    }

    const [assignee] = await db
      .select({
        id: users.id,
        mobile: users.isSalesAppUser,
      })
      .from(users)
      .where(eq(users.id, Number(assigneeUserId)))
      .limit(1);

    if (!assignee || !assignee.mobile) {
      return res.status(400).json({
        success: false,
        error: "Assignee is not a mobile employee.",
      });
    }

    const [created] = await db
      .insert(workItems)
      .values({
        capabilityId:
          Number.isInteger(Number(capabilityId))
            ? Number(capabilityId)
            : null,
        assigneeUserId: Number(assigneeUserId),
        createdByUserId: req.adminActor?.userId ?? null,
        title: String(title).trim(),
        description: String(description ?? "").trim() || null,
        priority: String(priority),
        dueAt: dueAt ? new Date(dueAt) : null,
        payload:
          payload &&
          typeof payload === "object" &&
          !Array.isArray(payload)
            ? payload
            : {},
        approvalRequired: Boolean(approvalRequired),
        approvalAreaKey:
          String(approvalAreaKey ?? "").trim() || null,
      })
      .returning();

    await writeAudit({
      actorUserId: req.adminActor?.userId,
      action: "work_item.create",
      entityType: "work_item",
      entityId: created.id,
      afterState: created,
    });

    return res.status(201).json({
      success: true,
      workItem: created,
    });
  });

  router.patch("/work-items/:id", async (req: AdminRequest, res) => {
    const id = String(req.params.id);

    const [before] = await db
      .select()
      .from(workItems)
      .where(eq(workItems.id, id))
      .limit(1);

    if (!before) {
      return res.status(404).json({
        success: false,
        error: "Work item not found.",
      });
    }

    const update: any = {
      updatedAt: new Date(),
    };

    for (const key of [
      "title",
      "description",
      "status",
      "priority",
      "payload",
      "approvalRequired",
      "approvalAreaKey",
    ]) {
      if (key in (req.body ?? {})) {
        update[key] = req.body[key];
      }
    }

    if ("dueAt" in (req.body ?? {})) {
      update.dueAt = req.body.dueAt
        ? new Date(req.body.dueAt)
        : null;
    }

    if (update.status === "cancelled") {
      update.cancelledAt = new Date();
    }

    const [updated] = await db
      .update(workItems)
      .set(update)
      .where(eq(workItems.id, id))
      .returning();

    await writeAudit({
      actorUserId: req.adminActor?.userId,
      action: "work_item.update",
      entityType: "work_item",
      entityId: id,
      beforeState: before,
      afterState: updated,
    });

    return res.json({
      success: true,
      workItem: updated,
    });
  });

  router.get("/approvals", async (req, res) => {
    const status =
      typeof req.query.status === "string"
        ? req.query.status
        : "pending";

    const rows = await db
      .select()
      .from(approvalRequests)
      .where(
        status === "all"
          ? undefined
          : eq(approvalRequests.status, status),
      )
      .orderBy(desc(approvalRequests.requestedAt))
      .limit(500);

    return res.json({
      success: true,
      approvals: rows,
    });
  });

  router.post("/approvals", async (req: AdminRequest, res) => {
    const {
      sourceType,
      sourceId,
      areaKey,
      title,
      requesterUserId,
      payload = {},
      scopeType,
      scopeValue,
    } = req.body ?? {};

    if (
      !String(sourceType ?? "").trim() ||
      !String(sourceId ?? "").trim() ||
      !String(areaKey ?? "").trim() ||
      !String(title ?? "").trim()
    ) {
      return res.status(400).json({
        success: false,
        error:
          "sourceType, sourceId, areaKey and title are required.",
      });
    }

    const owner = await resolveAdminOwner({
      areaKey: String(areaKey),
      scopeType: String(scopeType ?? "organization"),
      scopeValue:
        scopeValue === undefined || scopeValue === null
          ? null
          : String(scopeValue),
    });

    const normalizedPayload =
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload)
        ? payload
        : {};

    const [created] = await db
      .insert(approvalRequests)
      .values({
        sourceType: String(sourceType),
        sourceId: String(sourceId),
        areaKey: String(areaKey),
        title: String(title),
        requesterUserId:
          Number.isInteger(Number(requesterUserId))
            ? Number(requesterUserId)
            : null,
        assignedAdminUserId: owner.userId,
        payload: {
          ...normalizedPayload,
          ownerResolution: owner,
        },
      })
      .returning();

    return res.status(201).json({
      success: true,
      approval: created,
      owner,
    });
  });

  router.patch(
    "/approvals/:id/decision",
    async (req: AdminRequest, res) => {
      const id = String(req.params.id);
      const decision = String(req.body?.decision ?? "");

      if (!["approved", "rejected"].includes(decision)) {
        return res.status(400).json({
          success: false,
          error: "decision must be approved or rejected.",
        });
      }

      const [updated] = await db
        .update(approvalRequests)
        .set({
          status: decision,
          decidedAt: new Date(),
          decidedByUserId: req.adminActor?.userId ?? null,
          decisionNote:
            String(req.body?.note ?? "").trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(approvalRequests.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: "Approval request not found.",
        });
      }

      await writeAudit({
        actorUserId: req.adminActor?.userId,
        action: `approval.${decision}`,
        entityType: "approval",
        entityId: id,
        afterState: updated,
      });

      return res.json({
        success: true,
        approval: updated,
      });
    },
  );

  router.get("/devices", async (_req, res) => {
    const rows = await db
      .select()
      .from(deviceRegistrations)
      .orderBy(desc(deviceRegistrations.lastSeenAt));

    return res.json({
      success: true,
      devices: rows,
    });
  });

  router.post("/devices/:id/revoke", async (req: AdminRequest, res) => {
    const id = String(req.params.id);

    const [updated] = await db
      .update(deviceRegistrations)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(deviceRegistrations.id, id))
      .returning();

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: "Device not found.",
      });
    }

    await writeAudit({
      actorUserId: req.adminActor?.userId,
      action: "device.revoke",
      entityType: "device",
      entityId: id,
    });

    return res.json({
      success: true,
      device: updated,
    });
  });

  router.get("/ownership-rules", async (_req, res) => {
    return res.json({
      success: true,
      rules: await db
        .select()
        .from(adminOwnershipRules)
        .orderBy(asc(adminOwnershipRules.id)),
    });
  });

  router.post(
    "/ownership-rules",
    async (req: AdminRequest, res) => {
      const {
        areaKey,
        scopeType = "organization",
        scopeValue,
        primaryAdminUserId,
        fallbackAdminUserId,
        priority = 0,
        slaMinutes,
        config = {},
      } = req.body ?? {};

      if (!String(areaKey ?? "").trim()) {
        return res.status(400).json({
          success: false,
          error: "areaKey is required.",
        });
      }

      const [created] = await db
        .insert(adminOwnershipRules)
        .values({
          areaKey: String(areaKey).trim(),
          scopeType: String(scopeType),
          scopeValue:
            scopeValue === null || scopeValue === undefined
              ? null
              : String(scopeValue),
          primaryAdminUserId:
            Number.isInteger(Number(primaryAdminUserId))
              ? Number(primaryAdminUserId)
              : null,
          fallbackAdminUserId:
            Number.isInteger(Number(fallbackAdminUserId))
              ? Number(fallbackAdminUserId)
              : null,
          priority: Number(priority) || 0,
          slaMinutes:
            Number.isInteger(Number(slaMinutes))
              ? Number(slaMinutes)
              : null,
          config:
            config &&
            typeof config === "object" &&
            !Array.isArray(config)
              ? config
              : {},
          createdByUserId: req.adminActor?.userId ?? null,
        })
        .returning();

      return res.status(201).json({
        success: true,
        rule: created,
      });
    },
  );

  router.patch(
    "/ownership-rules/:id",
    async (req: AdminRequest, res) => {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid ownership rule ID.",
        });
      }

      const allowed = [
        "areaKey",
        "scopeType",
        "scopeValue",
        "primaryAdminUserId",
        "fallbackAdminUserId",
        "priority",
        "slaMinutes",
        "enabled",
        "config",
      ];

      const update: any = {
        updatedAt: new Date(),
      };

      for (const key of allowed) {
        if (key in (req.body ?? {})) {
          update[key] = req.body[key];
        }
      }

      const [updated] = await db
        .update(adminOwnershipRules)
        .set(update)
        .where(eq(adminOwnershipRules.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: "Ownership rule not found.",
        });
      }

      return res.json({
        success: true,
        rule: updated,
      });
    },
  );

  router.get("/settings", async (_req, res) => {
    return res.json({
      success: true,
      settings: await db
        .select()
        .from(workspaceSettings)
        .orderBy(asc(workspaceSettings.key)),
    });
  });

  router.put("/settings/:key", async (req: AdminRequest, res) => {
    const key = String(req.params.key);

    if (!("value" in (req.body ?? {}))) {
      return res.status(400).json({
        success: false,
        error: "value is required.",
      });
    }

    const [updated] = await db
      .insert(workspaceSettings)
      .values({
        key,
        value: req.body.value,
        updatedByUserId: req.adminActor?.userId ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: workspaceSettings.key,
        set: {
          value: req.body.value,
          updatedByUserId: req.adminActor?.userId ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return res.json({
      success: true,
      setting: updated,
    });
  });

  router.get("/attention", async (req, res) => {
    const status =
      typeof req.query.status === "string"
        ? req.query.status
        : "open";

    const rows = await db
      .select()
      .from(attentionItems)
      .where(
        status === "all"
          ? undefined
          : eq(attentionItems.status, status),
      )
      .orderBy(desc(attentionItems.createdAt));

    return res.json({
      success: true,
      items: rows,
    });
  });

  router.patch(
    "/attention/:id/resolve",
    async (req: AdminRequest, res) => {
      const id = String(req.params.id);

      const [updated] = await db
        .update(attentionItems)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
          resolvedByUserId: req.adminActor?.userId ?? null,
        })
        .where(eq(attentionItems.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: "Attention item not found.",
        });
      }

      return res.json({
        success: true,
        item: updated,
      });
    },
  );

  router.post("/usage", async (req: AdminRequest, res) => {
    const actionKey = String(req.body?.actionKey ?? "").trim();

    if (!actionKey) {
      return res.status(400).json({
        success: false,
        error: "actionKey is required.",
      });
    }

    const actorFromBody = Number(req.body?.actorUserId);

    await db.insert(usageEvents).values({
      actorUserId:
        req.adminActor?.userId ??
        (Number.isInteger(actorFromBody) && actorFromBody > 0
          ? actorFromBody
          : null),
      surface: "admin",
      actionKey,
      entityType:
        String(req.body?.entityType ?? "").trim() || null,
      entityId:
        String(req.body?.entityId ?? "").trim() || null,
      metadata:
        req.body?.metadata &&
        typeof req.body.metadata === "object" &&
        !Array.isArray(req.body.metadata)
          ? req.body.metadata
          : {},
    });

    return res.status(201).json({ success: true });
  });

  router.get("/pins", async (req: AdminRequest, res) => {
    const queryActor = Number(req.query.actorUserId);
    const actorUserId =
      req.adminActor?.userId ??
      (Number.isInteger(queryActor) ? queryActor : null);

    if (!actorUserId || actorUserId <= 0) {
      return res.json({
        success: true,
        pins: [],
      });
    }

    return res.json({
      success: true,
      pins: await db
        .select()
        .from(userPins)
        .where(
          and(
            eq(userPins.userId, actorUserId),
            eq(userPins.surface, "admin_home"),
          ),
        )
        .orderBy(userPins.sortOrder),
    });
  });

  router.put("/pins", async (req: AdminRequest, res) => {
    const bodyActor = Number(req.body?.actorUserId);
    const actorUserId =
      req.adminActor?.userId ??
      (Number.isInteger(bodyActor) ? bodyActor : null);

    const itemKeys: string[] =
      Array.isArray(req.body?.itemKeys)
        ? req.body.itemKeys
            .map((item: unknown) => String(item))
            .filter((item: string) => item.length > 0)
        : [];

    if (!actorUserId || actorUserId <= 0) {
      return res.status(400).json({
        success: false,
        error: "Admin actor user ID is required.",
      });
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(userPins)
        .where(
          and(
            eq(userPins.userId, actorUserId),
            eq(userPins.surface, "admin_home"),
          ),
        );

      if (itemKeys.length) {
        await tx.insert(userPins).values(
          itemKeys.map((itemKey, index) => ({
            userId: actorUserId,
            surface: "admin_home",
            itemKey,
            sortOrder: index,
          })),
        );
      }
    });

    return res.json({ success: true });
  });
}