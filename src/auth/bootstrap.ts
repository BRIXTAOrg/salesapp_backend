import type {
  Express,
  Response,
} from "express";

import {
  and,
  asc,
  eq,
  sql,
} from "drizzle-orm";

import { db } from "../db/db";
import { users } from "../db/schema";
import {
  employeeRuntimeState,
  workItems,
  workspaceSettings,
} from "../db/applianceSchema";
import {
  authenticateToken,
  type AuthRequest,
} from "../middleware/auth";
import { getResolvedCapabilitiesForUser } from "../services/capabilityResolver";
import { rankMobileCapabilities } from "../services/mobileHomeRanking";

async function getWorkspaceConfig() {
  const rows = await db
    .select()
    .from(workspaceSettings);

  const settings = Object.fromEntries(
    rows.map((row) => [
      row.key,
      row.value,
    ]),
  );

  return {
    dynamicModules: true,
    adaptiveHome:
      settings.adaptive_home ??
      true,
    devicePolicy:
      settings.device_policy ?? {
        oneActiveDevice: false,
      },
    offlinePolicy:
      settings.offline_policy ?? {
        allowCachedLogin: true,
      },
  };
}

export default function setupMobileBootstrapRoutes(
  app: Express,
) {
  app.get(
    "/api/salesApp/bootstrap",
    authenticateToken,
    async (
      req: AuthRequest,
      res: Response,
    ) => {
      try {
        const userId =
          req.user?.userId;

        if (!userId) {
          return res.status(401).json({
            success: false,
            error: "Unauthenticated.",
          });
        }

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        if (
          !user ||
          !user.isSalesAppUser ||
          user.status !== "active"
        ) {
          return res.status(403).json({
            success: false,
            error:
              "Mobile access is disabled for this employee.",
          });
        }

        const [
          resolvedCapabilities,
          assignedWork,
          config,
        ] = await Promise.all([
          getResolvedCapabilitiesForUser(
            userId,
          ),

          db
            .select()
            .from(workItems)
            .where(
              and(
                eq(
                  workItems.assigneeUserId,
                  userId,
                ),
                sql`${workItems.status} in ('assigned', 'in_progress')`,
              ),
            )
            .orderBy(
              asc(workItems.dueAt),
              asc(workItems.createdAt),
            )
            .limit(100),

          getWorkspaceConfig(),
        ]);

        const now = new Date();

        await db
          .insert(employeeRuntimeState)
          .values({
            userId,
            lastBootstrapAt: now,
            lastSeenAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target:
              employeeRuntimeState.userId,
            set: {
              lastBootstrapAt: now,
              lastSeenAt: now,
              updatedAt: now,
            },
          });

        const rankedCapabilities =
          await rankMobileCapabilities(
            userId,
            resolvedCapabilities,
          );

        const modules =
          rankedCapabilities.map(
            ({
              sortOrder: _sortOrder,
              ...capability
            }) => capability,
          );

        return res.status(200).json({
          success: true,

          user: {
            id: user.id,
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
            role: user.role,
            area: user.area,
            zone: user.zone,
            reportsToId:
              user.reportsToId,
          },

          permissions:
            rankedCapabilities.map(
              (capability) =>
                `capability.${capability.key}.use`,
            ),

          modules,

          workItems:
            assignedWork,

          config,

          generatedAt:
            now.toISOString(),
        });
      } catch (error) {
        console.error(
          "Mobile bootstrap route error:",
          error,
        );

        return res.status(500).json({
          success: false,
          error:
            "Unable to load employee workspace.",
        });
      }
    },
  );
}
