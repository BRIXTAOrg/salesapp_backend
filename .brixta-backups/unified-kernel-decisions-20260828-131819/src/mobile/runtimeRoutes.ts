import type {
  Express,
} from "express";

import {
  authenticateToken,
  withTenantDb,
  type AuthRequest,
} from "../middleware/auth";

import {
  getResolvedCapabilitiesForUser,
} from "../services/capabilityResolver";

import {
  recordUsage,
} from "../services/deviceRuntime";

import {
  getMyWork,
} from "../services/myWork";

import {
  getResponsibilityByKey,
} from "../platform/responsibility";

import {
  executeKernelAction,
  getKernelRuntime,
} from "../platform/kernel/runtimeEngine";

import {
  computeWorkspaceRevision,
  getPublishedRuntimeManifest,
} from "../platform/vnext/runtimeManifest";

import {
  sendResult,
  touchRequestDevice,
  userIdFrom,
} from "./http";

export function registerRuntimeRoutes(
  app: Express,
) {
  app.get(
    "/api/salesApp/sync/state",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) {
          return res.status(401).json({ success: false, error: "Unauthenticated." });
        }

        const resolved = await getResolvedCapabilitiesForUser(db, userId);
        const revision = await computeWorkspaceRevision(
          db,
          resolved.map((item) => item.id),
        );
        const since = String(req.query.since ?? "").trim();
        const device = await touchRequestDevice(db, req, userId, true);

        res.setHeader("Cache-Control", "no-store");
        return res.json({
          success: true,
          revision,
          changed: !since || since !== revision,
          refreshRecommended: !since || since !== revision,
          pollAfterSeconds: 15,
          generatedAt: new Date().toISOString(),
          device: device.row,
        });
      },
    ),
  );

  app.get(
    "/api/salesApp/my-work",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) {
          return res.status(401).json({ success: false, error: "Unauthenticated." });
        }

        return res.json({
          success: true,
          work: await getMyWork(db, userId),
        });
      },
    ),
  );

  app.get(
    "/api/salesApp/responsibilities/:responsibilityKey/manifest",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) {
          return res.status(401).json({ success: false, error: "Unauthenticated." });
        }

        const responsibility = await getResponsibilityByKey(
          db,
          String(req.params.responsibilityKey),
        );
        if (!responsibility) {
          return res.status(404).json({ success: false, error: "Responsibility not found." });
        }

        const assigned = await getResolvedCapabilitiesForUser(db, userId);
        if (!assigned.some((item) => item.id === responsibility.id)) {
          return res.status(403).json({ success: false, error: "Responsibility is not assigned." });
        }

        const manifest = await getPublishedRuntimeManifest(db, responsibility.id);
        if (!manifest) {
          return res.status(404).json({ success: false, error: "Published manifest not found." });
        }

        res.setHeader("Cache-Control", "no-store");
        return res.json({
          success: true,
          version: manifest.version,
          manifestHash: manifest.manifestHash,
          source: manifest.source,
          kernelAvailable: Boolean(manifest.kernel),
          manifest: manifest.manifest,
        });
      },
    ),
  );

  app.get(
    "/api/salesApp/responsibilities/:responsibilityKey/runtime",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) {
          return res.status(401).json({ success: false, error: "Unauthenticated." });
        }

        const touched = await touchRequestDevice(db, req, userId);
        return sendResult(
          res,
          await getKernelRuntime(db, {
            userId,
            responsibilityKey: String(req.params.responsibilityKey),
            recordId: String(req.query.recordId ?? "").trim() || null,
            device: touched.context,
          }),
        );
      },
    ),
  );

  app.post(
    "/api/salesApp/responsibilities/:responsibilityKey/actions/:actionId",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) {
          return res.status(401).json({ success: false, error: "Unauthenticated." });
        }

        const touched = await touchRequestDevice(db, req, userId, true);
        const result = await executeKernelAction(db, {
          userId,
          responsibilityKey: String(req.params.responsibilityKey),
          actionId: String(req.params.actionId),
          recordId: String(req.body?.recordId ?? "").trim() || null,
          payload: req.body?.payload,
          clientMutationId: String(req.body?.clientMutationId ?? "").trim() || null,
          clientCreatedAt: String(req.body?.clientCreatedAt ?? "").trim() || null,
          workflowInstanceId: String(req.body?.workflowInstanceId ?? "").trim() || null,
          device: touched.context,
        });

        if (result.ok) {
          const record = result.value.record as { id?: unknown } | undefined;
          await recordUsage(db, {
            userId,
            actionKey: `kernel.${String(req.params.responsibilityKey)}.${String(req.params.actionId)}`,
            entityType: "responsibility_record",
            entityId: record?.id ? String(record.id) : null,
            metadata: {
              deviceId: touched.context.deviceId,
              manifestRuntime: true,
            },
          });
        }

        return sendResult(res, result);
      },
    ),
  );
}
