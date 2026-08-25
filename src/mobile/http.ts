import type {
  Response,
} from "express";

import type {
  AppDatabase,
} from "../db/db";

import type {
  AuthRequest,
} from "../middleware/auth";

import {
  deviceContextFromRequest,
  registerOrTouchDevice,
} from "../services/deviceRuntime";

export function userIdFrom(
  req: AuthRequest,
) {
  return req.user?.userId ?? null;
}

export function sendResult(
  res: Response,
  result: any,
  successStatus = 200,
) {
  res.setHeader("Cache-Control", "no-store");

  if (!result.ok) {
    return res
      .status(result.status)
      .json({
        success: false,
        code: result.code,
        error: result.error,
        details: result.details,
      });
  }

  return res
    .status(successStatus)
    .json({
      success: true,
      ...result.value,
    });
}

export function parseFilters(
  value: unknown,
) {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
          .filter((item) =>
            item &&
            typeof item === "object" &&
            !Array.isArray(item),
          )
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

export async function touchRequestDevice(
  db: AppDatabase,
  req: AuthRequest,
  userId: number,
  synced = false,
) {
  const device =
    deviceContextFromRequest(
      req as unknown as {
        headers?: Record<string, unknown>;
        body?: Record<string, unknown>;
      },
    );

  if (!device.deviceId) {
    return {
      row: null,
      context: {
        deviceId: null,
        platform: device.platform,
        appVersion: device.appVersion,
        online: true,
        metadata: device.metadata,
      },
    };
  }

  const row = await registerOrTouchDevice(
    db,
    {
      userId,
      deviceId: device.deviceId,
      platform: device.platform,
      appVersion: device.appVersion,
      pushToken: device.pushToken,
      metadata: device.metadata,
      synced,
    },
  );

  return {
    row,
    context: {
      deviceId: device.deviceId,
      platform: device.platform,
      appVersion: device.appVersion,
      online: true,
      metadata: device.metadata,
    },
  };
}
