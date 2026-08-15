import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export interface AdminActor {
  userId: number | null;
  username: string | null;
}

export interface AdminRequest extends Request {
  adminActor?: AdminActor;
}

function constantTimeEquals(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireAdminService(
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

  next();
}
