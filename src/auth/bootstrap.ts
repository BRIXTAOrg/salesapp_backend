import {
  createHash,
} from "node:crypto";

import type {
  Express,
} from "express";

import {
  eq,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../db/db";

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
} from "../platform/responsibility";

import {
  PLATFORM_PRIMITIVES,
} from "../platform/primitives";


function workspaceRevision(
  resolved: Awaited<
    ReturnType<typeof getResolvedCapabilitiesForUser>
  >,
  workflow: Awaited<
    ReturnType<typeof getWorkflowBootstrapForUser>
  >,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        responsibilities:
          resolved.map(
            (item) => ({
              id:
                item.id,
              key:
                item.key,
              config:
                item.config,
              source:
                item.source,
              sortOrder:
                item.sortOrder,
            }),
          ),
        workflow,
      }),
    )
    .digest("hex");
}


async function buildWorkspace(
  db: AppDatabase,
  userId: number,
  options: {
    ensureActions?: boolean;
  } = {},
) {
  const resolved =
    await getResolvedCapabilitiesForUser(
      db,
      userId,
    );

  /*
   * BRIXTA_FAST_BOOTSTRAP_V1
   *
   * Compatibility note:
   * `options.ensureActions` remains accepted so existing callers do not
   * break, but bootstrap is now strictly read-only.
   *
   * Responsibility CRUD action definitions are synchronized on the
   * Responsibility create/update/publish write paths. Repeating those
   * UPSERT/lookup loops here on every employee bootstrap was redundant
   * hot-path database work.
   */
  void options;

  const workflow =
    await getWorkflowBootstrapForUser(
      db,
      userId,
    );

  return {
    resolved,
    workflow,
    revision:
      workspaceRevision(
        resolved,
        workflow,
      ),
  };
}


/**
 * BRIXTA Employee Runtime
 *
 * LOGIN:
 *   Native + protected.
 *
 * POST LOGIN:
 *   Business Responsibilities come from the CMS.
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

        const [user] =
          await db
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

        const workspace =
          await buildWorkspace(
            db,
            userId,
            {
              ensureActions: true,
            },
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

          /*
           * THIS is the employee's business UI.
           *
           * The CMS publishes the generated Responsibility definition into
           * mobile_capabilities.config.
           *
           * Flutter renders this generic contract.
           */
          responsibilities:
            workspace.resolved.map(
              (
                responsibility,
              ) => ({
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

          workflow:
            workspace.workflow,

          readyActions:
            workspace.workflow
              .readyActions,

          blockedActions:
            workspace.workflow
              .blockedActions,

          pendingApprovals:
            workspace.workflow
              .pendingApprovals,

          primitives:
            PLATFORM_PRIMITIVES,

          /*
           * Existing Flutter AppSessionController already understands this.
           */
          sync: {
            workspaceRevision:
              workspace.revision,
            pollSeconds:
              15,
          },

          /*
           * Explicit architecture contract.
           */
          device: {
            runtimeMode:
              "cms_compiled_definition",
            coreLoginProtected:
              true,
            legacyBusinessUi:
              false,
          },

          generatedAt:
            now.toISOString(),
        });
      },
    ),
  );


  /*
   * Flutter polls this.
   *
   * Publish something in CMS
   *       ↓
   * hash changes
   *       ↓
   * Flutter refreshes bootstrap
   *       ↓
   * new Responsibility definition appears.
   */
  app.get(
    "/api/salesApp/sync/state",
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

        const workspace =
          await buildWorkspace(
            db,
            userId,
          );

        const since =
          typeof req.query.since ===
          "string"
            ? req.query.since
            : "";

        return res.json({
          success: true,

          revision:
            workspace.revision,

          changed:
            !since ||
            since !==
              workspace.revision,

          generatedAt:
            new Date()
              .toISOString(),
        });
      },
    ),
  );


  /*
   * Employee Work feed used by the existing Flutter shell.
   */
  app.get(
    "/api/salesApp/my-work",
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

        const workflow =
          await getWorkflowBootstrapForUser(
            db,
            userId,
          );

        return res.json({
          success: true,

          work: {
            ready:
              workflow.readyActions,
            blocked:
              workflow.blockedActions,
            approvals:
              workflow.pendingApprovals,
          },

          generatedAt:
            new Date()
              .toISOString(),
        });
      },
    ),
  );
}
