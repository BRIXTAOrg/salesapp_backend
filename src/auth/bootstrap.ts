import type {
  Express,
} from "express";

import {
  eq,
} from "drizzle-orm";

import {
  users,
} from "../db/schema";

import {
  employeeRuntimeState,
} from "../db/applianceSchema";

import {
  authenticateToken,
  withTenantDb,
  type AuthRequest,
} from "../middleware/auth";

import {
  getResolvedCapabilitiesForUser,
} from "../services/capabilityResolver";

import {
  getWorkflowBootstrapForUser,
} from "../services/workflowBootstrap";

import {
  normalizeResponsibilityConfig,
  ensureResponsibilityActions,
} from "../platform/responsibility";

import {
  PLATFORM_PRIMITIVES,
} from "../platform/primitives";

/**
 * One bootstrap contract for the generic Responsibility/CRUD/Workflow app.
 * There are no business-specific modules in this payload.
 */
export default function setupMobileBootstrapRoutes(
  app: Express,
) {
  app.get(
    "/api/salesApp/bootstrap",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          req.user?.userId;

        if (!userId) {
          return res
            .status(401)
            .json({
              success: false,
              error:
                "Unauthenticated.",
            });
        }

        const [user] = await db
          .select()
          .from(users)
          .where(
            eq(
              users.id,
              userId,
            ),
          )
          .limit(1);

        if (
          !user ||
          !user.isSalesAppUser ||
          user.status !== "active"
        ) {
          return res
            .status(403)
            .json({
              success: false,
              error:
                "Mobile access is disabled for this employee.",
            });
        }

        const resolved =
          await getResolvedCapabilitiesForUser(
            db,
            userId,
          );

        for (const responsibility of resolved) {
          await ensureResponsibilityActions(
            db,
            {
              id:
                responsibility.id,
              key:
                responsibility.key,
              title:
                responsibility.title,
            },
          );
        }

        const workflow =
          await getWorkflowBootstrapForUser(
            db,
            userId,
          );

        const now =
          new Date();

        await db
          .insert(
            employeeRuntimeState,
          )
          .values({
            userId,
            lastBootstrapAt:
              now,
            lastSeenAt:
              now,
            updatedAt:
              now,
          })
          .onConflictDoUpdate({
            target:
              employeeRuntimeState.userId,
            set: {
              lastBootstrapAt:
                now,
              lastSeenAt:
                now,
              updatedAt:
                now,
            },
          });

        return res.json({
          success: true,

          user: {
            id:
              user.id,
            employeeCode:
              user.salesmanLoginId,
            name:
              user.displayName ??
              user.username ??
              user.salesmanLoginId,
            department:
              user.department,
            designation:
              user.designation,
            role:
              user.role,
            area:
              user.area,
            zone:
              user.zone,
            reportsToId:
              user.reportsToId,
          },

          responsibilities:
            resolved.map(
              (responsibility) => ({
                id:
                  responsibility.id,
                key:
                  responsibility.key,
                title:
                  responsibility.title,
                description:
                  responsibility.description,
                icon:
                  responsibility.icon,
                definition:
                  normalizeResponsibilityConfig(
                    responsibility.config,
                  ),
                source:
                  responsibility.source,
                sortOrder:
                  responsibility.sortOrder,
              }),
            ),

          workflow,
          readyActions:
            workflow.readyActions,
          blockedActions:
            workflow.blockedActions,
          pendingApprovals:
            workflow.pendingApprovals,

          primitives:
            PLATFORM_PRIMITIVES,

          generatedAt:
            now.toISOString(),
        });
      },
    ),
  );
}
