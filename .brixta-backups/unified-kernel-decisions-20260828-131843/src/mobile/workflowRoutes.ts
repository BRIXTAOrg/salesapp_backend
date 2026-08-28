import type {
  Express,
} from "express";

import {
  authenticateToken,
  withTenantDb,
  type AuthRequest,
} from "../middleware/auth";

import {
  decideWorkflowApproval,
} from "../services/workflowEngine";

import {
  decideKernelDecision,
} from "../services/kernelDecisionInbox";

import {
  getWorkflowBootstrapForUser,
} from "../services/workflowBootstrap";

import {
  userIdFrom,
} from "./http";

export function registerWorkflowRoutes(
  app: Express,
) {
  app.get(
    "/api/salesApp/workflow/state",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) {
          return res.status(401).json({ success: false, error: "Unauthenticated." });
        }

        return res.json({
          success: true,
          workflow: await getWorkflowBootstrapForUser(db, userId),
        });
      },
    ),
  );

  app.post(
    "/api/salesApp/workflow/approvals/:id/decision",
    authenticateToken,
    withTenantDb<AuthRequest>(
      async (req, res, db) => {
        const userId = userIdFrom(req);
        if (!userId) {
          return res.status(401).json({ success: false, error: "Unauthenticated." });
        }

        const decision = String(req.body?.decision ?? "");
        if (decision !== "approved" && decision !== "rejected") {
          return res.status(400).json({
            success: false,
            error: "decision must be approved or rejected.",
          });
        }

        const approvalId =
          String(
            req.params.id,
          );

        if (
          approvalId.startsWith(
            "kernel:",
          )
        ) {
          const result =
            await decideKernelDecision(
              db,
              {
                approvalId,

                actorUserId:
                  userId,

                decision,

                note:
                  String(
                    req.body
                      ?.note ??
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
                success:
                  false,

                code:
                  result.code,

                error:
                  result.error,
              });
          }

          return res.json({
            success:
              true,

            approval:
              result.approval,

            source:
              "kernel",

            workflow:
              await getWorkflowBootstrapForUser(
                db,
                userId,
              ),
          });
        }

        const result = await decideWorkflowApproval(db, {
          approvalRequestId:
            approvalId,
          actorUserId:
            userId,
          decision,
          note:
            String(
              req.body
                ?.note ??
              "",
            ).trim() ||
            null,
        });

        if (!result.ok) {
          return res.status(result.status).json({
            success: false,
            code: result.code,
            error: result.error,
          });
        }

        return res.json({
          success: true,
          approval: result.approval,
          workflow: await getWorkflowBootstrapForUser(db, userId),
        });
      },
    ),
  );
}
