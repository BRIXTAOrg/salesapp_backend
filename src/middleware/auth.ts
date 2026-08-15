import type {
  NextFunction,
  Request,
  Response,
} from "express";

import {
  type MobileJwtPayload,
  verifyMobileToken,
} from "../auth/jwt";

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
