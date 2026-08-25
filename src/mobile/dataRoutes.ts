import type {
  Express,
} from "express";

import type {
  AppDatabase,
} from "../db/db";

import {
  authenticateToken,
  withTenantDb,
  type AuthRequest,
} from "../middleware/auth";

import {
  getRuntimeDataSourceRecord,
  queryRuntimeDataSource,
} from "../platform/vnext/dataSourceRuntime";

import {
  confirmEntityMemory,
  getEntityMemory,
} from "../platform/vnext/memoryRuntime";

import {
  getPublishedRuntimeManifests,
  manifestReferencesDataSource,
} from "../platform/vnext/runtimeManifest";

import {
  getResolvedCapabilitiesForUser,
} from "../services/capabilityResolver";

import {
  parseFilters,
  sendResult,
  userIdFrom,
} from "./http";

async function sourceAllowed(
  db: AppDatabase,
  userId: number,
  sourceKey: string,
) {
  const responsibilities =
    await getResolvedCapabilitiesForUser(
      db,
      userId,
    );
  const manifests =
    await getPublishedRuntimeManifests(
      db,
      responsibilities.map((item) => item.id),
    );

  return [...manifests.values()].some((manifest) =>
    manifestReferencesDataSource(
      manifest,
      sourceKey,
    ),
  );
}

export function registerDataRoutes(
  app: Express,
) {
  app.get(
    "/api/salesApp/data-sources/:key",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) {
          return res.status(401).json({ success: false, error: "Unauthenticated." });
        }

        const sourceKey = String(req.params.key);
        if (!(await sourceAllowed(db, userId, sourceKey))) {
          return res.status(403).json({
            success: false,
            code: "DATA_SOURCE_NOT_ASSIGNED",
            error: "No assigned published Responsibility references this Data Source.",
          });
        }

        return sendResult(
          res,
          await queryRuntimeDataSource(db, {
            key: sourceKey,
            q: String(req.query.q ?? ""),
            limit: Number(req.query.limit) || 50,
            filters: parseFilters(req.query.filters) as Array<{
              field: string;
              operator?: string;
              value?: unknown;
            }>,
          }),
        );
      },
    ),
  );

  app.get(
    "/api/salesApp/data-sources/:key/:id",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) {
          return res.status(401).json({ success: false, error: "Unauthenticated." });
        }

        const sourceKey = String(req.params.key);
        if (!(await sourceAllowed(db, userId, sourceKey))) {
          return res.status(403).json({
            success: false,
            code: "DATA_SOURCE_NOT_ASSIGNED",
            error: "No assigned published Responsibility references this Data Source.",
          });
        }

        return sendResult(
          res,
          await getRuntimeDataSourceRecord(db, {
            key: sourceKey,
            id: String(req.params.id),
          }),
        );
      },
    ),
  );

  app.get(
    "/api/salesApp/memory/:sourceKey/:entityId",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) {
          return res.status(401).json({ success: false, error: "Unauthenticated." });
        }

        const sourceKey = String(req.params.sourceKey);
        if (!(await sourceAllowed(db, userId, sourceKey))) {
          return res.status(403).json({
            success: false,
            code: "DATA_SOURCE_NOT_ASSIGNED",
            error: "No assigned published Responsibility references this memory source.",
          });
        }

        return res.json({
          success: true,
          memory: await getEntityMemory(db, {
            sourceKey,
            entityId: String(req.params.entityId),
            fieldKey: String(req.query.fieldKey ?? "").trim() || null,
          }),
        });
      },
    ),
  );

  app.post(
    "/api/salesApp/memory/confirm",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) {
          return res.status(401).json({ success: false, error: "Unauthenticated." });
        }

        const sourceKey = String(req.body?.sourceKey ?? "").trim();
        const entityId = String(req.body?.entityId ?? "").trim();
        const fieldKey = String(req.body?.fieldKey ?? "").trim();

        if (!sourceKey || !entityId || !fieldKey) {
          return res.status(400).json({
            success: false,
            error: "sourceKey, entityId and fieldKey are required.",
          });
        }

        if (!(await sourceAllowed(db, userId, sourceKey))) {
          return res.status(403).json({
            success: false,
            code: "DATA_SOURCE_NOT_ASSIGNED",
            error: "No assigned published Responsibility references this memory source.",
          });
        }

        const memory = await confirmEntityMemory(db, {
          userId,
          sourceKey,
          entityId,
          fieldKey,
          value: req.body?.value,
          ttlDays: req.body?.ttlDays,
          metadata: req.body?.metadata,
        });

        return res.json({ success: true, memory });
      },
    ),
  );
}
