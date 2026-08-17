import type { Router } from "express";

import { asc, count, eq } from "drizzle-orm";

import {
  mobileCapabilities,
  userMobileCapabilities,
} from "../db/schema";
import { capabilityAssignmentRules } from "../db/applianceSchema";
import {
  withAdminTenantDb,
  type AdminRequest,
} from "../middleware/adminService";
import { writeAudit } from "../services/audit";

const SUPPORTED_TYPES = new Set([
  "form",
  "approval_queue",
  "tracking",
  "report",
  "checklist",
  "data_view",
  "status_update",
  "upload",
  "native",
]);

function normalizeKey(input: unknown) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function registerResponsibilityAdminRoutes(router: Router) {
  router.get("/capabilities", withAdminTenantDb<AdminRequest>(async (_req, res, db) => {
    const capabilities = await db
      .select()
      .from(mobileCapabilities)
      .orderBy(asc(mobileCapabilities.title));

    const directCounts = await db
      .select({
        capabilityId: userMobileCapabilities.capabilityId,
        count: count(),
      })
      .from(userMobileCapabilities)
      .groupBy(userMobileCapabilities.capabilityId);

    const ruleCounts = await db
      .select({
        capabilityId: capabilityAssignmentRules.capabilityId,
        count: count(),
      })
      .from(capabilityAssignmentRules)
      .groupBy(capabilityAssignmentRules.capabilityId);

    const directMap = new Map(
      directCounts.map((row) => [
        row.capabilityId,
        Number(row.count),
      ]),
    );

    const ruleMap = new Map(
      ruleCounts.map((row) => [
        row.capabilityId,
        Number(row.count),
      ]),
    );

    return res.json({
      success: true,
      capabilities: capabilities.map((capability) => ({
        ...capability,
        directAssignments: directMap.get(capability.id) ?? 0,
        assignmentRules: ruleMap.get(capability.id) ?? 0,
      })),
    });
  }));

  router.post("/capabilities", withAdminTenantDb<AdminRequest>(async (req, res, db) => {
    const {
      key,
      title,
      type,
      description,
      icon,
      config,
    } = req.body ?? {};

    const normalizedKey = normalizeKey(key || title);
    const normalizedTitle = String(title ?? "").trim();

    if (
      !normalizedKey ||
      !normalizedTitle ||
      !SUPPORTED_TYPES.has(String(type))
    ) {
      return res.status(400).json({
        success: false,
        error: "title and a supported type are required.",
      });
    }

    try {
      const [created] = await db
        .insert(mobileCapabilities)
        .values({
          key: normalizedKey,
          title: normalizedTitle,
          type: String(type),
          description: String(description ?? "").trim() || null,
          icon: String(icon ?? "").trim() || null,
          config:
            config &&
            typeof config === "object" &&
            !Array.isArray(config)
              ? config
              : {},
          isActive: true,
        })
        .returning();

      await writeAudit(db, {
        actorUserId: req.adminActor?.userId,
        action: "responsibility.create",
        entityType: "responsibility",
        entityId: created.id,
        afterState: created,
      });

      return res.status(201).json({
        success: true,
        capability: created,
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error:
          error?.message ??
          "Unable to create responsibility.",
      });
    }
  }));

  router.patch("/capabilities/:id", withAdminTenantDb<AdminRequest>(async (req, res, db) => {
    const capabilityId = Number(req.params.id);

    if (!Number.isInteger(capabilityId) || capabilityId <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid responsibility ID.",
      });
    }

    const [before] = await db
      .select()
      .from(mobileCapabilities)
      .where(eq(mobileCapabilities.id, capabilityId))
      .limit(1);

    if (!before) {
      return res.status(404).json({
        success: false,
        error: "Responsibility not found.",
      });
    }

    const update: any = {
      updatedAt: new Date(),
    };

    if ("title" in (req.body ?? {})) {
      update.title = String(req.body.title).trim();
    }

    if ("description" in (req.body ?? {})) {
      update.description =
        String(req.body.description ?? "").trim() || null;
    }

    if ("icon" in (req.body ?? {})) {
      update.icon = String(req.body.icon ?? "").trim() || null;
    }

    if ("type" in (req.body ?? {})) {
      const type = String(req.body.type);

      if (!SUPPORTED_TYPES.has(type)) {
        return res.status(400).json({
          success: false,
          error: "Unsupported responsibility type.",
        });
      }

      update.type = type;
    }

    if ("config" in (req.body ?? {})) {
      if (
        !req.body.config ||
        typeof req.body.config !== "object" ||
        Array.isArray(req.body.config)
      ) {
        return res.status(400).json({
          success: false,
          error: "config must be a JSON object.",
        });
      }

      update.config = req.body.config;
    }

    if ("isActive" in (req.body ?? {})) {
      update.isActive = Boolean(req.body.isActive);
    }

    const [updated] = await db
      .update(mobileCapabilities)
      .set(update)
      .where(eq(mobileCapabilities.id, capabilityId))
      .returning();

    await writeAudit(db, {
      actorUserId: req.adminActor?.userId,
      action: "responsibility.update",
      entityType: "responsibility",
      entityId: capabilityId,
      beforeState: before,
      afterState: updated,
    });

    return res.json({
      success: true,
      capability: updated,
    });
  }));

  router.get("/capability-rules", withAdminTenantDb<AdminRequest>(async (_req, res, db) => {
    return res.json({
      success: true,
      rules: await db
        .select()
        .from(capabilityAssignmentRules)
        .orderBy(asc(capabilityAssignmentRules.id)),
    });
  }));

  router.post("/capability-rules", withAdminTenantDb<AdminRequest>(async (req, res, db) => {
    const {
      capabilityId,
      subjectType,
      subjectValue,
      effect = "allow",
      priority = 0,
      config = {},
    } = req.body ?? {};

    if (
      !Number.isInteger(Number(capabilityId)) ||
      !["all", "user", "department", "designation", "role"].includes(
        String(subjectType),
      ) ||
      !["allow", "deny"].includes(String(effect))
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Valid capabilityId, subjectType and effect are required.",
      });
    }

    const [created] = await db
      .insert(capabilityAssignmentRules)
      .values({
        capabilityId: Number(capabilityId),
        subjectType: String(subjectType),
        subjectValue:
          subjectType === "all"
            ? null
            : String(subjectValue ?? "").trim() || null,
        effect: String(effect),
        priority: Number(priority) || 0,
        config:
          config &&
          typeof config === "object" &&
          !Array.isArray(config)
            ? config
            : {},
        createdByUserId: req.adminActor?.userId ?? null,
      })
      .returning();

    await writeAudit(db, {
      actorUserId: req.adminActor?.userId,
      action: "responsibility.rule_create",
      entityType: "capability_assignment_rule",
      entityId: created.id,
      afterState: created,
    });

    return res.status(201).json({
      success: true,
      rule: created,
    });
  }));

  router.patch(
    "/capability-rules/:id",
    withAdminTenantDb<AdminRequest>(async (req, res, db) => {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid rule ID.",
        });
      }

      const [before] = await db
        .select()
        .from(capabilityAssignmentRules)
        .where(eq(capabilityAssignmentRules.id, id))
        .limit(1);

      if (!before) {
        return res.status(404).json({
          success: false,
          error: "Rule not found.",
        });
      }

      const update: any = {
        updatedAt: new Date(),
      };

      for (const key of [
        "subjectType",
        "subjectValue",
        "effect",
        "priority",
        "enabled",
        "config",
      ]) {
        if (key in (req.body ?? {})) {
          update[key] = req.body[key];
        }
      }

      const [updated] = await db
        .update(capabilityAssignmentRules)
        .set(update)
        .where(eq(capabilityAssignmentRules.id, id))
        .returning();

      await writeAudit(db, {
        actorUserId: req.adminActor?.userId,
        action: "responsibility.rule_update",
        entityType: "capability_assignment_rule",
        entityId: id,
        beforeState: before,
        afterState: updated,
      });

      return res.json({
        success: true,
        rule: updated,
      });
    }),
  );
}