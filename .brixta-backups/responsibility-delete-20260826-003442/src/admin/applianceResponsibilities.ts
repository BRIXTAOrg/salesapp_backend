import type {
  Router,
} from "express";

import {
  asc,
  count,
  eq,
} from "drizzle-orm";

import {
  mobileCapabilities,
  userMobileCapabilities,
} from "../db/schema";

import {
  capabilityAssignmentRules,
} from "../db/applianceSchema";

import {
  withAdminTenantDb,
  type AdminRequest,
} from "../middleware/adminService";

import {
  writeAudit,
} from "../services/audit";

import {
  ensureResponsibilityActions,
  normalizeResponsibilityConfig,
} from "../platform/responsibility";

function normalizeKey(
  input: unknown,
) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Responsibility definitions are now renderer/schema definitions, not a
 * list of backend route types. Every new Responsibility uses the same
 * generic CRUD engine.
 */
export function registerResponsibilityAdminRoutes(
  router: Router,
) {
  router.get(
    "/responsibilities",
    withAdminTenantDb<AdminRequest>(
      async (
        _req,
        res,
        db,
      ) => {
        const responsibilities =
          await db
            .select()
            .from(
              mobileCapabilities,
            )
            .orderBy(
              asc(
                mobileCapabilities.title,
              ),
            );

        const directCounts =
          await db
            .select({
              capabilityId:
                userMobileCapabilities.capabilityId,
              count:
                count(),
            })
            .from(
              userMobileCapabilities,
            )
            .groupBy(
              userMobileCapabilities.capabilityId,
            );

        const ruleCounts =
          await db
            .select({
              capabilityId:
                capabilityAssignmentRules.capabilityId,
              count:
                count(),
            })
            .from(
              capabilityAssignmentRules,
            )
            .groupBy(
              capabilityAssignmentRules.capabilityId,
            );

        const directMap =
          new Map(
            directCounts.map(
              (row) => [
                row.capabilityId,
                Number(
                  row.count,
                ),
              ],
            ),
          );

        const ruleMap =
          new Map(
            ruleCounts.map(
              (row) => [
                row.capabilityId,
                Number(
                  row.count,
                ),
              ],
            ),
          );

        for (const responsibility of responsibilities) {
          if (responsibility.isActive) {
            await ensureResponsibilityActions(
              db,
              responsibility,
            );
          }
        }

        return res.json({
          success: true,
          responsibilities:
            responsibilities.map(
              (
                responsibility,
              ) => ({
                ...responsibility,
                type:
                  "record",
                definition:
                  normalizeResponsibilityConfig(
                    responsibility.config,
                  ),
                directAssignments:
                  directMap.get(
                    responsibility.id,
                  ) ?? 0,
                assignmentRules:
                  ruleMap.get(
                    responsibility.id,
                  ) ?? 0,
              }),
            ),
        });
      },
    ),
  );

  router.post(
    "/responsibilities",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const normalizedKey =
          normalizeKey(
            req.body?.key ||
              req.body?.title,
          );

        const title =
          String(
            req.body?.title ??
              "",
          ).trim();

        if (
          !normalizedKey ||
          !title
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "title is required.",
            });
        }

        const config =
          objectValue(
            req.body?.config,
          );

        // Validate/normalize once so malformed config fails here instead of
        // at mobile runtime. Unknown renderer names remain allowed.
        const definition =
          normalizeResponsibilityConfig(
            config,
          );

        const [created] = await db
          .insert(
            mobileCapabilities,
          )
          .values({
            key:
              normalizedKey,
            title,
            type:
              "record",
            description:
              String(
                req.body?.description ??
                  "",
              ).trim() ||
              null,
            icon:
              String(
                req.body?.icon ??
                  "",
              ).trim() ||
              null,
            config,
            isActive: true,
          })
          .returning();

        await ensureResponsibilityActions(
          db,
          created,
        );

        await writeAudit(
          db,
          {
            actorUserId:
              req.adminActor?.userId,
            action:
              "responsibility.create",
            entityType:
              "responsibility",
            entityId:
              created.id,
            afterState: {
              ...created,
              definition,
            },
          },
        );

        return res
          .status(201)
          .json({
            success: true,
            responsibility: {
              ...created,
              definition,
            },
          });
      },
    ),
  );

  router.patch(
    "/responsibilities/:id",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const id =
          Number(
            req.params.id,
          );

        if (
          !Number.isInteger(id) ||
          id <= 0
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "Invalid Responsibility ID.",
            });
        }

        const [before] = await db
          .select()
          .from(
            mobileCapabilities,
          )
          .where(
            eq(
              mobileCapabilities.id,
              id,
            ),
          )
          .limit(1);

        if (!before) {
          return res
            .status(404)
            .json({
              success: false,
              error:
                "Responsibility not found.",
            });
        }

        const update: {
          title?: string;
          description?: string | null;
          icon?: string | null;
          config?: Record<string, unknown>;
          isActive?: boolean;
          type: string;
          updatedAt: Date;
        } = {
          type: "record",
          updatedAt:
            new Date(),
        };

        if (
          "title" in
          (req.body ?? {})
        ) {
          const title =
            String(
              req.body.title ??
                "",
            ).trim();

          if (!title) {
            return res
              .status(400)
              .json({
                success: false,
                error:
                  "title cannot be empty.",
              });
          }

          update.title =
            title;
        }

        if (
          "description" in
          (req.body ?? {})
        ) {
          update.description =
            String(
              req.body.description ??
                "",
            ).trim() ||
            null;
        }

        if (
          "icon" in
          (req.body ?? {})
        ) {
          update.icon =
            String(
              req.body.icon ??
                "",
            ).trim() ||
            null;
        }

        if (
          "config" in
          (req.body ?? {})
        ) {
          const config =
            objectValue(
              req.body.config,
            );

          normalizeResponsibilityConfig(
            config,
          );

          update.config =
            config;
        }

        if (
          "isActive" in
          (req.body ?? {})
        ) {
          update.isActive =
            Boolean(
              req.body.isActive,
            );
        }

        const [updated] = await db
          .update(
            mobileCapabilities,
          )
          .set(update)
          .where(
            eq(
              mobileCapabilities.id,
              id,
            ),
          )
          .returning();

        if (updated.isActive) {
          await ensureResponsibilityActions(
            db,
            updated,
          );
        }

        await writeAudit(
          db,
          {
            actorUserId:
              req.adminActor?.userId,
            action:
              "responsibility.update",
            entityType:
              "responsibility",
            entityId:
              id,
            beforeState:
              before,
            afterState:
              updated,
          },
        );

        return res.json({
          success: true,
          responsibility: {
            ...updated,
            definition:
              normalizeResponsibilityConfig(
                updated.config,
              ),
          },
        });
      },
    ),
  );

  router.get(
    "/responsibility-rules",
    withAdminTenantDb<AdminRequest>(
      async (
        _req,
        res,
        db,
      ) => res.json({
        success: true,
        rules:
          await db
            .select()
            .from(
              capabilityAssignmentRules,
            )
            .orderBy(
              asc(
                capabilityAssignmentRules.id,
              ),
            ),
      }),
    ),
  );

  router.post(
    "/responsibility-rules",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const capabilityId =
          Number(
            req.body?.responsibilityId ??
              req.body?.capabilityId,
          );

        const subjectType =
          String(
            req.body?.subjectType ??
              "",
          );

        const effect =
          String(
            req.body?.effect ??
              "allow",
          );

        if (
          !Number.isInteger(
            capabilityId,
          ) ||
          capabilityId <= 0 ||
          ![
            "all",
            "user",
            "department",
            "designation",
            "role",
          ].includes(
            subjectType,
          ) ||
          ![
            "allow",
            "deny",
          ].includes(effect)
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "Valid responsibilityId, subjectType and effect are required.",
            });
        }

        const [created] = await db
          .insert(
            capabilityAssignmentRules,
          )
          .values({
            capabilityId,
            subjectType,
            subjectValue:
              subjectType ===
              "all"
                ? null
                : String(
                    subjectType ===
                    "role"
                      ? req.body?.roleId ??
                        req.body?.subjectValue ??
                        ""
                      : req.body?.subjectValue ??
                        "",
                  ).trim() ||
                  null,
            effect,
            priority:
              Number(
                req.body?.priority,
              ) || 0,
            config:
              objectValue(
                req.body?.config,
              ),
            createdByUserId:
              req.adminActor?.userId ??
              null,
          })
          .returning();

        await writeAudit(
          db,
          {
            actorUserId:
              req.adminActor?.userId,
            action:
              "responsibility.rule_create",
            entityType:
              "capability_assignment_rule",
            entityId:
              created.id,
            afterState:
              created,
          },
        );

        return res
          .status(201)
          .json({
            success: true,
            rule:
              created,
          });
      },
    ),
  );

  router.patch(
    "/responsibility-rules/:id",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const id =
          Number(
            req.params.id,
          );

        if (
          !Number.isInteger(id) ||
          id <= 0
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "Invalid rule ID.",
            });
        }

        const update: any = {
          updatedAt:
            new Date(),
        };

        for (const key of [
          "subjectType",
          "subjectValue",
          "effect",
          "priority",
          "enabled",
          "config",
        ]) {
          if (
            key in
            (req.body ?? {})
          ) {
            update[key] =
              req.body[key];
          }
        }

        const [updated] = await db
          .update(
            capabilityAssignmentRules,
          )
          .set(update)
          .where(
            eq(
              capabilityAssignmentRules.id,
              id,
            ),
          )
          .returning();

        if (!updated) {
          return res
            .status(404)
            .json({
              success: false,
              error:
                "Rule not found.",
            });
        }

        return res.json({
          success: true,
          rule:
            updated,
        });
      },
    ),
  );
}
