import type {
  Express,
  Response,
} from "express";

import {
  and,
  desc,
  eq,
  sql,
} from "drizzle-orm";

import {
  approvalRequests,
  deviceRegistrations,
  dynamicSubmissions,
  employeeRuntimeState,
  usageEvents,
  userPins,
  workItems,
} from "../db/applianceSchema";
import {
  authenticateToken,
  withTenantDb,
  type AuthRequest,
} from "../middleware/auth";
import { getResolvedCapabilitiesForUser } from "../services/capabilityResolver";
import { resolveAdminOwner } from "../services/ownerResolver";

function userIdFrom(req: AuthRequest) {
  return req.user?.userId ?? null;
}

export default function setupMobileApplianceRoutes(app: Express) {
  app.post(
    "/api/salesApp/device/register",
    authenticateToken,
    withTenantDb<AuthRequest>(async (req, res, db) => {
      const userId = userIdFrom(req);

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Unauthenticated.",
        });
      }

      const deviceId = String(req.body?.deviceId ?? "").trim();
      const platform = String(req.body?.platform ?? "").trim();

      if (!deviceId || !platform) {
        return res.status(400).json({
          success: false,
          error: "deviceId and platform are required.",
        });
      }

      const [device] = await db
        .insert(deviceRegistrations)
        .values({
          userId,
          deviceId,
          platform,
          appVersion: String(req.body?.appVersion ?? "").trim() || null,
          pushToken: String(req.body?.pushToken ?? "").trim() || null,
          metadata:
            req.body?.metadata &&
            typeof req.body.metadata === "object" &&
            !Array.isArray(req.body.metadata)
              ? req.body.metadata
              : {},
          isActive: true,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            deviceRegistrations.userId,
            deviceRegistrations.deviceId,
          ],
          set: {
            platform,
            appVersion: String(req.body?.appVersion ?? "").trim() || null,
            pushToken: String(req.body?.pushToken ?? "").trim() || null,
            isActive: true,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning();

      await db
        .insert(employeeRuntimeState)
        .values({
          userId,
          lastSeenAt: new Date(),
          currentDeviceId: deviceId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: employeeRuntimeState.userId,
          set: {
            lastSeenAt: new Date(),
            currentDeviceId: deviceId,
            updatedAt: new Date(),
          },
        });

      return res.json({
        success: true,
        device,
      });
    }),
  );

  app.post(
    "/api/salesApp/device/heartbeat",
    authenticateToken,
    withTenantDb<AuthRequest>(async (req, res, db) => {
      const userId = userIdFrom(req);

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Unauthenticated.",
        });
      }

      const deviceId = String(req.body?.deviceId ?? "").trim();
      const synced = Boolean(req.body?.synced);
      const now = new Date();

      if (deviceId) {
        const update: any = {
          lastSeenAt: now,
          updatedAt: now,
        };

        if (synced) {
          update.lastSyncAt = now;
        }

        await db
          .update(deviceRegistrations)
          .set(update)
          .where(
            and(
              eq(deviceRegistrations.userId, userId),
              eq(deviceRegistrations.deviceId, deviceId),
            ),
          );
      }

      const runtimeUpdate: any = {
        lastSeenAt: now,
        updatedAt: now,
      };

      if (synced) {
        runtimeUpdate.lastSyncAt = now;
      }

      if (deviceId) {
        runtimeUpdate.currentDeviceId = deviceId;
      }

      await db
        .insert(employeeRuntimeState)
        .values({
          userId,
          lastSeenAt: now,
          lastSyncAt: synced ? now : null,
          currentDeviceId: deviceId || null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: employeeRuntimeState.userId,
          set: runtimeUpdate,
        });

      return res.json({
        success: true,
        serverTime: now.toISOString(),
      });
    }),
  );

  app.get(
    "/api/salesApp/work-items",
    authenticateToken,
    withTenantDb<AuthRequest>(async (req, res, db) => {
      const userId = userIdFrom(req);

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Unauthenticated.",
        });
      }

      const rows = await db
        .select()
        .from(workItems)
        .where(eq(workItems.assigneeUserId, userId))
        .orderBy(desc(workItems.createdAt));

      return res.json({
        success: true,
        workItems: rows,
      });
    }),
  );

  app.patch(
    "/api/salesApp/work-items/:id/status",
    authenticateToken,
    withTenantDb<AuthRequest>(async (req, res, db) => {
      const userId = userIdFrom(req);
      const id = String(req.params.id);
      const status = String(req.body?.status ?? "");

      if (
        !userId ||
        !["assigned", "in_progress", "completed"].includes(status)
      ) {
        return res.status(400).json({
          success: false,
          error: "Valid status is required.",
        });
      }

      const [existing] = await db
        .select()
        .from(workItems)
        .where(
          and(
            eq(workItems.id, id),
            eq(workItems.assigneeUserId, userId),
          ),
        )
        .limit(1);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: "Work item not found.",
        });
      }

      const [updated] = await db
        .update(workItems)
        .set({
          status,
          startedAt:
            status === "in_progress" && !existing.startedAt
              ? new Date()
              : existing.startedAt,
          completedAt:
            status === "completed"
              ? new Date()
              : existing.completedAt,
          updatedAt: new Date(),
        })
        .where(eq(workItems.id, id))
        .returning();

      if (status === "completed" && updated.approvalRequired) {
        const areaKey =
          updated.approvalAreaKey ??
          "work_item_approval";

        const owner = await resolveAdminOwner(db, { areaKey });

        await db.insert(approvalRequests).values({
          sourceType: "work_item",
          sourceId: id,
          areaKey,
          title: updated.title,
          requesterUserId: userId,
          assignedAdminUserId: owner.userId,
          payload: {
            workItemId: id,
            ownerResolution: owner,
          },
        });
      }

      return res.json({
        success: true,
        workItem: updated,
      });
    }),
  );

  app.post(
    "/api/salesApp/submissions",
    authenticateToken,
    withTenantDb<AuthRequest>(async (req, res, db) => {
      const userId = userIdFrom(req);
      const capabilityId = Number(req.body?.capabilityId);
      const clientMutationId =
        String(req.body?.clientMutationId ?? "").trim();

      if (
        !userId ||
        !Number.isInteger(capabilityId) ||
        capabilityId <= 0 ||
        !clientMutationId
      ) {
        return res.status(400).json({
          success: false,
          error: "capabilityId and clientMutationId are required.",
        });
      }

      const resolved =
        await getResolvedCapabilitiesForUser(db, userId);

      if (
        !resolved.some(
          (capability) =>
            capability.id === capabilityId,
        )
      ) {
        return res.status(403).json({
          success: false,
          error:
            "This responsibility is not assigned to the employee.",
        });
      }

      const payload =
        req.body?.payload &&
        typeof req.body.payload === "object" &&
        !Array.isArray(req.body.payload)
          ? req.body.payload
          : {};

      const workItemId =
        req.body?.workItemId
          ? String(req.body.workItemId)
          : null;

      if (workItemId) {
        const [ownedWorkItem] = await db
          .select({
            id: workItems.id,
          })
          .from(workItems)
          .where(
            and(
              eq(workItems.id, workItemId),
              eq(workItems.assigneeUserId, userId),
            ),
          )
          .limit(1);

        if (!ownedWorkItem) {
          return res.status(403).json({
            success: false,
            error:
              "Work item does not belong to this employee.",
          });
        }
      }

      const [submission] = await db
        .insert(dynamicSubmissions)
        .values({
          clientMutationId,
          userId,
          capabilityId,
          workItemId,
          status:
            String(req.body?.status ?? "submitted"),
          payload,
          clientCreatedAt:
            req.body?.clientCreatedAt
              ? new Date(req.body.clientCreatedAt)
              : null,
        })
        .onConflictDoUpdate({
          target: dynamicSubmissions.clientMutationId,
          set: {
            payload,
            status:
              String(req.body?.status ?? "submitted"),
            updatedAt: new Date(),
            serverVersion:
              sql`${dynamicSubmissions.serverVersion} + 1`,
          },
        })
        .returning();

      return res.status(201).json({
        success: true,
        submission,
      });
    }),
  );

  app.get(
    "/api/salesApp/submissions",
    authenticateToken,
    withTenantDb<AuthRequest>(async (req, res, db) => {
      const userId = userIdFrom(req);

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Unauthenticated.",
        });
      }

      const rows = await db
        .select()
        .from(dynamicSubmissions)
        .where(eq(dynamicSubmissions.userId, userId))
        .orderBy(desc(dynamicSubmissions.submittedAt))
        .limit(500);

      return res.json({
        success: true,
        submissions: rows,
      });
    }),
  );

  app.post(
    "/api/salesApp/usage",
    authenticateToken,
    withTenantDb<AuthRequest>(async (req, res, db) => {
      const userId = userIdFrom(req);
      const actionKey =
        String(req.body?.actionKey ?? "").trim();

      if (!userId || !actionKey) {
        return res.status(400).json({
          success: false,
          error: "actionKey is required.",
        });
      }

      await db.insert(usageEvents).values({
        actorUserId: userId,
        surface: "mobile",
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

      return res.status(201).json({
        success: true,
      });
    }),
  );

  app.get(
    "/api/salesApp/pins",
    authenticateToken,
    withTenantDb<AuthRequest>(async (req, res, db) => {
      const userId = userIdFrom(req);

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Unauthenticated.",
        });
      }

      const pins = await db
        .select()
        .from(userPins)
        .where(
          and(
            eq(userPins.userId, userId),
            eq(userPins.surface, "mobile_home"),
          ),
        )
        .orderBy(userPins.sortOrder);

      return res.json({
        success: true,
        pins,
      });
    }),
  );

  app.put(
    "/api/salesApp/pins",
    authenticateToken,
    withTenantDb<AuthRequest>(async (req, res, db) => {
      const userId = userIdFrom(req);

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Unauthenticated.",
        });
      }

      const itemKeys = Array.isArray(req.body?.itemKeys)
        ? req.body.itemKeys.map(String).filter(Boolean)
        : [];

      // No nested db.transaction() here: `db` is already running inside
      // the transaction withTenantSchema opened to hold search_path, so
      // this delete+insert is already atomic within it. A second
      // .transaction() would issue a redundant BEGIN on an already-open
      // transaction and its COMMIT would end the outer one early.
      await db
        .delete(userPins)
        .where(
          and(
            eq(userPins.userId, userId),
            eq(userPins.surface, "mobile_home"),
          ),
        );

      if (itemKeys.length) {
        await db.insert(userPins).values(
          itemKeys.map((itemKey: string, index: number) => ({
            userId,
            surface: "mobile_home",
            itemKey,
            sortOrder: index,
          })),
        );
      }

      return res.json({ success: true });
    }),
  );

}