import type {
  Express,
  Response,
} from "express";

import {
  and,
  asc,
  eq,
} from "drizzle-orm";

import { db } from "../db/db";
import {
  mobileCapabilities,
  userMobileCapabilities,
  users,
} from "../db/schema";
import {
  type AuthRequest,
  authenticateToken,
} from "../middleware/auth";

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
        const authenticatedUserId =
          req.user?.userId;

        if (!authenticatedUserId) {
          return res.status(401).json({
            success: false,
            error: "Unauthenticated.",
          });
        }

        const [user] = await db
          .select()
          .from(users)
          .where(
            eq(
              users.id,
              authenticatedUserId,
            ),
          )
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

        const assignedModules =
          await db
            .select({
              id: mobileCapabilities.id,
              key: mobileCapabilities.key,
              title:
                mobileCapabilities.title,
              type: mobileCapabilities.type,
              description:
                mobileCapabilities.description,
              icon: mobileCapabilities.icon,
              config:
                mobileCapabilities.config,
              sortOrder:
                userMobileCapabilities.sortOrder,
            })
            .from(
              userMobileCapabilities,
            )
            .innerJoin(
              mobileCapabilities,
              eq(
                userMobileCapabilities.capabilityId,
                mobileCapabilities.id,
              ),
            )
            .where(
              and(
                eq(
                  userMobileCapabilities.userId,
                  user.id,
                ),
                eq(
                  mobileCapabilities.isActive,
                  true,
                ),
              ),
            )
            .orderBy(
              asc(
                userMobileCapabilities.sortOrder,
              ),
              asc(
                mobileCapabilities.title,
              ),
            );

        const modules =
          assignedModules.map(
            ({
              sortOrder: _sortOrder,
              ...module
            }) => ({
              ...module,
              config: module.config ?? {},
            }),
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
          },

          permissions: modules.map(
            (module) =>
              `capability.${module.key}.use`,
          ),

          modules,

          config: {
            dynamicModules: true,
          },

          generatedAt:
            new Date().toISOString(),
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
