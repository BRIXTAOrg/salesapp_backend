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

import {
  computeWorkspaceRevision,
  getPublishedRuntimeManifests,
} from "../platform/vnext/runtimeManifest";

import {
  deviceContextFromRequest,
  listUserDevices,
  registerOrTouchDevice,
} from "../services/deviceRuntime";

/**
 * One bootstrap contract for the employee app.
 *
 * The base V2 Responsibility definition stays present for older app builds.
 * New app builds consume `runtimeManifest`, whose latest published version is
 * authored by the CMS and read directly from compiled_responsibility_manifests.
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

        const responsibilityIds =
          resolved.map((item) => item.id);

        const [
          manifests,
          workflow,
          workspaceRevision,
        ] = await Promise.all([
          getPublishedRuntimeManifests(
            db,
            responsibilityIds,
          ),
          getWorkflowBootstrapForUser(
            db,
            userId,
          ),
          computeWorkspaceRevision(
            db,
            responsibilityIds,
          ),
        ]);

        const now =
          new Date();

        const device =
          deviceContextFromRequest(
            req as unknown as {
              headers?: Record<string, unknown>;
              body?: Record<string, unknown>;
            },
          );

        const currentDevice =
          device.deviceId
            ? await registerOrTouchDevice(
                db,
                {
                  userId,
                  deviceId:
                    device.deviceId,
                  platform:
                    device.platform,
                  appVersion:
                    device.appVersion,
                  pushToken:
                    device.pushToken,
                  metadata:
                    device.metadata,
                  synced: true,
                },
              )
            : null;

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

        const devices =
          await listUserDevices(
            db,
            userId,
          );

        res.setHeader(
          "Cache-Control",
          "no-store",
        );
        res.setHeader(
          "ETag",
          `"${workspaceRevision}"`,
        );

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
              (responsibility) => {
                const published =
                  manifests.get(
                    responsibility.id,
                  );

                return {
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

                  // Compatibility contract for current Flutter builds.
                  definition:
                    normalizeResponsibilityConfig(
                      responsibility.config,
                    ),

                  // Authoritative contract for Kernel-aware app builds.
                  runtimeManifest:
                    published
                      ? {
                          version:
                            published.version,
                          hash:
                            published.manifestHash,
                          source:
                            published.source,
                          kernelAvailable:
                            Boolean(
                              published.kernel,
                            ),
                          manifest:
                            published.manifest,
                        }
                      : null,

                  source:
                    responsibility.source,
                  sortOrder:
                    responsibility.sortOrder,
                };
              },
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

          sync: {
            workspaceRevision,
            pollAfterSeconds: 15,
            // Push tokens may already exist, but CMS-publish invalidation is
            // not pushed by this backend patch yet. Flutter should use the
            // revision check on resume/reconnect + the recommended poll.
            pushRefreshSupported: false,
            pushTokenRegistered:
              devices.some(
                (item) =>
                  Boolean(item.pushToken),
              ),
            appResumeRefresh: true,
            networkReconnectRefresh: true,
          },

          device: {
            current:
              currentDevice,
            currentDeviceId:
              device.deviceId || null,
            registeredCount:
              devices.length,
            devices,
          },

          generatedAt:
            now.toISOString(),
        });
      },
    ),
  );
}
