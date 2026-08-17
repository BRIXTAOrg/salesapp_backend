import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";

import { db, withTenantSchema, type AppDatabase } from "../db/db";
import { organizations } from "../db/publicSchema";

export interface AdminActor {
  userId: number | null;
  username: string | null;
}

export interface AdminRequest extends Request {
  adminActor?: AdminActor;
  schemaName?: string;
}

function constantTimeEquals(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function requireAdminService(
  req: AdminRequest,
  res: Response,
  next: NextFunction,
) {
  const expected =
    process.env.ADMIN_SERVICE_SECRET ??
    process.env.FLOW1_ADMIN_SECRET;

  if (!expected) {
    console.error("ADMIN_SERVICE_SECRET/FLOW1_ADMIN_SECRET is not configured.");
    return res.status(500).json({
      success: false,
      error: "Admin service authentication is not configured.",
    });
  }

  const raw =
    req.headers["x-admin-service-secret"] ??
    req.headers["x-flow1-admin-secret"];
  const supplied = Array.isArray(raw) ? raw[0] : raw;

  if (!supplied || !constantTimeEquals(String(supplied), expected)) {
    return res.status(401).json({ success: false, error: "Unauthorized." });
  }

  const actorHeader = req.headers["x-admin-user-id"];
  const actorId = Number(Array.isArray(actorHeader) ? actorHeader[0] : actorHeader);
  const usernameHeader = req.headers["x-admin-username"];

  req.adminActor = {
    userId: Number.isInteger(actorId) && actorId > 0 ? actorId : null,
    username:
      typeof usernameHeader === "string"
        ? usernameHeader
        : Array.isArray(usernameHeader)
          ? usernameHeader[0] ?? null
          : null,
  };

  // The CMS resolves its own tenant at dashboard login (same pattern as
  // mobile login) and forwards it here as a header on every proxied call.
  // We do NOT trust this header at face value -- a compromised or
  // misconfigured CMS deployment could otherwise claim any schema. It's
  // validated against public.organizations, the one registry every
  // deployment can always see regardless of search_path.
  const schemaHeader = req.headers["x-tenant-schema"];
  const suppliedSchema = Array.isArray(schemaHeader) ? schemaHeader[0] : schemaHeader;

  if (!suppliedSchema) {
    return res.status(400).json({
      success: false,
      error: "Missing tenant schema.",
    });
  }

  try {
    const [org] = await db
      .select({ schemaName: organizations.schemaName })
      .from(organizations)
      .where(eq(organizations.schemaName, String(suppliedSchema).trim().toLowerCase()))
      .limit(1);

    if (!org) {
      return res.status(403).json({
        success: false,
        error: "Unknown tenant schema.",
      });
    }

    req.schemaName = org.schemaName;

    next();
  } catch (error) {
    console.error("Tenant resolution error:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to resolve tenant.",
    });
  }
}

/**
 * Admin-route equivalent of middleware/auth.ts's withTenantDb -- wraps a
 * handler so it receives a `db` scoped to req.schemaName (resolved and
 * validated by requireAdminService above), instead of the route importing
 * the module-level `db` singleton directly.
 *
 * Must run AFTER requireAdminService -- req.schemaName needs to already
 * be set.
 */
export function withAdminTenantDb<Req extends AdminRequest = AdminRequest>(
  handler: (
    req: Req,
    res: Response,
    db: AppDatabase,
  ) => Promise<void | Response>,
) {
  return async (req: Req, res: Response) => {
    const schemaName = req.schemaName;

    if (!schemaName) {
      return res.status(400).json({
        success: false,
        error: "Missing tenant schema.",
      });
    }

    try {
      await withTenantSchema(schemaName, (db) => handler(req, res, db) as Promise<void>);
    } catch (error) {
      console.error("Tenant-scoped admin route error:", error);

      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: "Internal server error.",
        });
      }
    }
  };
}