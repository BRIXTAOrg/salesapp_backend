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
  authenticateToken,
  withTenantDb,
  type AuthRequest,
} from "../middleware/auth";

import {
  deviceContextFromRequest,
  listUserDevices,
  recordUsage,
  registerOrTouchDevice,
} from "../services/deviceRuntime";

import {
  touchRequestDevice,
  userIdFrom,
} from "./http";

export function registerDeviceRoutes(
  app: Express,
) {
  app.post(
    "/api/salesApp/devices/register",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) {
          return res.status(401).json({ success: false, error: "Unauthenticated." });
        }

        const device = deviceContextFromRequest(
          req as unknown as {
            headers?: Record<string, unknown>;
            body?: Record<string, unknown>;
          },
        );

        if (!device.deviceId) {
          return res.status(400).json({
            success: false,
            error: "deviceId is required.",
          });
        }

        const row = await registerOrTouchDevice(db, {
          userId,
          deviceId: device.deviceId,
          platform: device.platform,
          appVersion: device.appVersion,
          pushToken: device.pushToken,
          metadata: device.metadata,
          synced: true,
        });

        await recordUsage(db, {
          userId,
          actionKey: "device.register",
          entityType: "device",
          entityId: device.deviceId,
          metadata: device.metadata,
        });

        return res.json({ success: true, device: row });
      },
    ),
  );

  app.post(
    "/api/salesApp/devices/heartbeat",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) {
          return res.status(401).json({ success: false, error: "Unauthenticated." });
        }

        const touched = await touchRequestDevice(
          db,
          req,
          userId,
          req.body?.synced === true,
        );

        return res.json({
          success: true,
          device: touched.row,
          serverTime: new Date().toISOString(),
        });
      },
    ),
  );

  app.get(
    "/api/salesApp/profile/runtime",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) {
          return res.status(401).json({ success: false, error: "Unauthenticated." });
        }

        const [userRows, devices] = await Promise.all([
          db
            .select({
              id: users.id,
              name: users.displayName,
              username: users.username,
              employeeCode: users.salesmanLoginId,
              department: users.department,
              designation: users.designation,
              reportsToId: users.reportsToId,
              area: users.area,
              zone: users.zone,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1),
          listUserDevices(db, userId),
        ]);

        const current = deviceContextFromRequest(
          req as unknown as {
            headers?: Record<string, unknown>;
            body?: Record<string, unknown>;
          },
        );

        return res.json({
          success: true,
          user: userRows[0] ?? null,
          currentDeviceId: current.deviceId || null,
          devices,
          deviceCount: devices.length,
        });
      },
    ),
  );

  app.post(
    "/api/salesApp/usage",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) {
          return res.status(401).json({ success: false, error: "Unauthenticated." });
        }

        const actionKey = String(req.body?.actionKey ?? "").trim();
        if (!actionKey) {
          return res.status(400).json({ success: false, error: "actionKey is required." });
        }

        await recordUsage(db, {
          userId,
          actionKey,
          entityType: String(req.body?.entityType ?? "").trim() || null,
          entityId: String(req.body?.entityId ?? "").trim() || null,
          metadata:
            req.body?.metadata &&
            typeof req.body.metadata === "object" &&
            !Array.isArray(req.body.metadata)
              ? req.body.metadata
              : {},
        });

        return res.status(201).json({ success: true });
      },
    ),
  );
}
