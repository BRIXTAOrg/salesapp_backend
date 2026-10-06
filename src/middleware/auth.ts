import type {
  NextFunction,
  Request,
  Response,
} from "express";

import {
  type MobileJwtPayload,
  verifyMobileToken,
} from "../auth/jwt";
import { eq } from "drizzle-orm";

import { withTenantSchema, type AppDatabase } from "../db/db";
import { users } from "../db/schema";

export type AuthUserPayload = MobileJwtPayload;

export interface AuthRequest extends Request {
  user?: AuthUserPayload;
}

export function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "Access token missing.",
    });
  }

  const token = authHeader.slice("Bearer ".length).trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Access token missing.",
    });
  }

  try {
    req.user = verifyMobileToken(token);
    next();
  } catch {
    return res.status(401).json({
      success: false,
      error: "Session expired or invalid token.",
    });
  }
}

/**
 * Wraps a route handler so it receives a `db` already scoped to the
 * caller's tenant schema (via the JWT's schemaName claim), instead of the
 * route importing the module-level `db` singleton directly.
 *
 * Must run AFTER authenticateToken -- req.user needs to already be set.
 *
 * Usage:
 *   app.get(
 *     "/api/salesApp/bootstrap",
 *     authenticateToken,
 *     withTenantDb(async (req, res, db) => {
 *       const rows = await db.select().from(users)...
 *     }),
 *   );
 */
export function withTenantDb<Req extends AuthRequest = AuthRequest>(
  handler: (
    req: Req,
    res: Response,
    db: AppDatabase,
  ) => Promise<void | Response>,
) {
  return async (req: Req, res: Response) => {
    const schemaName = req.user?.schemaName;

    if (!schemaName) {
      return res.status(401).json({
        success: false,
        error: "Unauthenticated.",
      });
    }

    try {
      await withTenantSchema(schemaName, async (db) => {
        // BRIXTA_LIVE_MOBILE_ACCESS_V1: a token is only as good as the
        // account behind it. Deactivating an employee (or switching off
        // their sales-app access) stops their app on the next request,
        // not 7 days later when the token expires.
        const [current] = await db
          .select({
            status: users.status,
            isSalesAppUser: users.isSalesAppUser,
          })
          .from(users)
          .where(eq(users.id, req.user!.userId))
          .limit(1);

        if (
          !current ||
          current.status !== "active" ||
          !current.isSalesAppUser
        ) {
          res.status(403).json({
            success: false,
            code: "ACCOUNT_INACTIVE",
            error:
              "Mobile access is disabled for this employee. Contact management.",
          });
          return;
        }

        await handler(req, res, db);
      });
    } catch (error) {
      console.error("Tenant-scoped route error:", error);

      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: "Internal server error.",
        });
      }
    }
  };
}