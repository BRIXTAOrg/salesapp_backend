import type {
  Express,
} from "express";

import {
  authenticateToken,
  withTenantDb,
  type AuthRequest,
} from "../middleware/auth";

import {
  PLATFORM_PRIMITIVES,
} from "../platform/primitives";

import {
  createRecord,
  deleteRecord,
  getOwnRecord,
  listOwnRecords,
  updateRecord,
} from "../platform/recordEngine";

import {
  decideWorkflowApproval,
} from "../services/workflowEngine";

import {
  getWorkflowBootstrapForUser,
} from "../services/workflowBootstrap";

function userIdFrom(
  req: AuthRequest,
) {
  return req.user?.userId ??
    null;
}

function sendResult(
  res: any,
  result: any,
  successStatus = 200,
) {
  if (!result.ok) {
    return res
      .status(result.status)
      .json({
        success: false,
        code: result.code,
        error: result.error,
        details:
          result.details,
      });
  }

  return res
    .status(successStatus)
    .json({
      success: true,
      ...result.value,
    });
}

/**
 * The entire employee-side business API.
 *
 * No dealer/PJP/DVR/leave/etc. route exists here. Every normal business
 * object is a Responsibility record using the same CRUD surface.
 */
export default function setupMobilePlatformRoutes(
  app: Express,
) {
  app.get(
    "/api/salesApp/primitives",
    authenticateToken,
    (_req, res) =>
      res.json({
        success: true,
        primitives:
          PLATFORM_PRIMITIVES,
      }),
  );

  app.get(
    "/api/salesApp/workflow/state",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          userIdFrom(req);

        if (!userId) {
          return res
            .status(401)
            .json({
              success: false,
              error:
                "Unauthenticated.",
            });
        }

        return res.json({
          success: true,
          workflow:
            await getWorkflowBootstrapForUser(
              db,
              userId,
            ),
        });
      },
    ),
  );

  app.post(
    "/api/salesApp/workflow/approvals/:id/decision",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          userIdFrom(req);

        if (!userId) {
          return res
            .status(401)
            .json({
              success: false,
              error:
                "Unauthenticated.",
            });
        }

        const decision =
          String(
            req.body?.decision ??
              "",
          );

        if (
          decision !==
            "approved" &&
          decision !==
            "rejected"
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "decision must be approved or rejected.",
            });
        }

        const result =
          await decideWorkflowApproval(
            db,
            {
              approvalRequestId:
                String(
                  req.params.id,
                ),
              actorUserId:
                userId,
              decision,
              note:
                String(
                  req.body?.note ??
                    "",
                ).trim() ||
                null,
            },
          );

        if (!result.ok) {
          return res
            .status(
              result.status,
            )
            .json({
              success: false,
              code:
                result.code,
              error:
                result.error,
            });
        }

        return res.json({
          success: true,
          approval:
            result.approval,
          workflow:
            await getWorkflowBootstrapForUser(
              db,
              userId,
            ),
        });
      },
    ),
  );

  app.get(
    "/api/salesApp/records/:responsibilityKey",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          userIdFrom(req);

        if (!userId) {
          return res
            .status(401)
            .json({
              success: false,
              error:
                "Unauthenticated.",
            });
        }

        return sendResult(
          res,
          await listOwnRecords(
            db,
            {
              userId,
              responsibilityKey:
                String(
                  req.params.responsibilityKey,
                ),
              limit:
                Number(
                  req.query.limit,
                ) || 100,
            },
          ),
        );
      },
    ),
  );

  app.post(
    "/api/salesApp/records/:responsibilityKey",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          userIdFrom(req);

        if (!userId) {
          return res
            .status(401)
            .json({
              success: false,
              error:
                "Unauthenticated.",
            });
        }

        return sendResult(
          res,
          await createRecord(
            db,
            {
              userId,
              responsibilityKey:
                String(
                  req.params.responsibilityKey,
                ),
              payload:
                req.body?.payload,
              status:
                req.body?.status,
              clientMutationId:
                req.body?.clientMutationId,
              clientCreatedAt:
                req.body?.clientCreatedAt,
              workflowInstanceId:
                req.body?.workflowInstanceId,
            },
          ),
          201,
        );
      },
    ),
  );

  app.get(
    "/api/salesApp/records/:responsibilityKey/:id",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          userIdFrom(req);

        if (!userId) {
          return res
            .status(401)
            .json({
              success: false,
              error:
                "Unauthenticated.",
            });
        }

        return sendResult(
          res,
          await getOwnRecord(
            db,
            {
              userId,
              responsibilityKey:
                String(
                  req.params.responsibilityKey,
                ),
              recordId:
                String(
                  req.params.id,
                ),
            },
          ),
        );
      },
    ),
  );

  app.patch(
    "/api/salesApp/records/:responsibilityKey/:id",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          userIdFrom(req);

        if (!userId) {
          return res
            .status(401)
            .json({
              success: false,
              error:
                "Unauthenticated.",
            });
        }

        return sendResult(
          res,
          await updateRecord(
            db,
            {
              userId,
              responsibilityKey:
                String(
                  req.params.responsibilityKey,
                ),
              recordId:
                String(
                  req.params.id,
                ),
              payload:
                req.body?.payload,
              status:
                req.body?.status,
              workflowInstanceId:
                req.body?.workflowInstanceId,
            },
          ),
        );
      },
    ),
  );

  app.delete(
    "/api/salesApp/records/:responsibilityKey/:id",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          userIdFrom(req);

        if (!userId) {
          return res
            .status(401)
            .json({
              success: false,
              error:
                "Unauthenticated.",
            });
        }

        return sendResult(
          res,
          await deleteRecord(
            db,
            {
              userId,
              responsibilityKey:
                String(
                  req.params.responsibilityKey,
                ),
              recordId:
                String(
                  req.params.id,
                ),
              workflowInstanceId:
                req.body?.workflowInstanceId,
            },
          ),
        );
      },
    ),
  );
}
