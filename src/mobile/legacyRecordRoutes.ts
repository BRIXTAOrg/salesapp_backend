import type {
  Express,
} from "express";

import {
  authenticateToken,
  withTenantDb,
  type AuthRequest,
} from "../middleware/auth";

import {
  createRecord,
  deleteRecord,
  getOwnRecord,
  listOwnRecords,
  updateRecord,
} from "../platform/recordEngine";

import {
  sendResult,
  userIdFrom,
} from "./http";

/**
 * V2 compatibility surface. New Flutter builds should execute published
 * Kernel actions instead. Keep this until all installed app versions migrate.
 */
export function registerLegacyRecordRoutes(
  app: Express,
) {
  app.get(
    "/api/salesApp/records/:responsibilityKey",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) return res.status(401).json({ success: false, error: "Unauthenticated." });

        return sendResult(
          res,
          await listOwnRecords(db, {
            userId,
            responsibilityKey: String(req.params.responsibilityKey),
            limit: Number(req.query.limit) || 100,
          }),
        );
      },
    ),
  );

  app.post(
    "/api/salesApp/records/:responsibilityKey",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) return res.status(401).json({ success: false, error: "Unauthenticated." });

        return sendResult(
          res,
          await createRecord(db, {
            userId,
            responsibilityKey: String(req.params.responsibilityKey),
            payload: req.body?.payload,
            status: req.body?.status,
            appActionKey: req.body?.appActionKey,
            clientMutationId: req.body?.clientMutationId,
            clientCreatedAt: req.body?.clientCreatedAt,
            workflowInstanceId: req.body?.workflowInstanceId,
          }),
          201,
        );
      },
    ),
  );

  app.get(
    "/api/salesApp/records/:responsibilityKey/:id",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) return res.status(401).json({ success: false, error: "Unauthenticated." });

        return sendResult(
          res,
          await getOwnRecord(db, {
            userId,
            responsibilityKey: String(req.params.responsibilityKey),
            recordId: String(req.params.id),
          }),
        );
      },
    ),
  );

  app.patch(
    "/api/salesApp/records/:responsibilityKey/:id",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) return res.status(401).json({ success: false, error: "Unauthenticated." });

        return sendResult(
          res,
          await updateRecord(db, {
            userId,
            responsibilityKey: String(req.params.responsibilityKey),
            recordId: String(req.params.id),
            payload: req.body?.payload,
            status: req.body?.status,
            appActionKey: req.body?.appActionKey,
            workflowInstanceId: req.body?.workflowInstanceId,
          }),
        );
      },
    ),
  );

  app.delete(
    "/api/salesApp/records/:responsibilityKey/:id",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) return res.status(401).json({ success: false, error: "Unauthenticated." });

        return sendResult(
          res,
          await deleteRecord(db, {
            userId,
            responsibilityKey: String(req.params.responsibilityKey),
            recordId: String(req.params.id),
            workflowInstanceId: req.body?.workflowInstanceId,
          }),
        );
      },
    ),
  );
}
