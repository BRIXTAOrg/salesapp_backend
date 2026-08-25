import {
  and,
  desc,
  eq,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../db/db";

import {
  deviceRegistrations,
  employeeRuntimeState,
  usageEvents,
} from "../db/applianceSchema";

export type DeviceRuntimeInput = {
  userId: number;
  deviceId: string;
  platform: string;
  appVersion?: string | null;
  pushToken?: string | null;
  metadata?: Record<string, unknown>;
  synced?: boolean;
};

function normalizeDeviceId(
  value: unknown,
) {
  return String(value ?? "")
    .trim()
    .slice(0, 255);
}

function normalizePlatform(
  value: unknown,
) {
  return String(value ?? "unknown")
    .trim()
    .toLowerCase()
    .slice(0, 40) || "unknown";
}

export function deviceContextFromRequest(
  req: {
    headers?: Record<string, unknown>;
    body?: Record<string, unknown>;
  },
) {
  const headers =
    req.headers ?? {};
  const body =
    req.body ?? {};

  return {
    deviceId:
      normalizeDeviceId(
        body.deviceId ??
        headers["x-brixta-device-id"],
      ),
    platform:
      normalizePlatform(
        body.platform ??
        headers["x-brixta-platform"],
      ),
    appVersion:
      String(
        body.appVersion ??
        headers["x-brixta-app-version"] ??
        "",
      ).trim().slice(0, 80) || null,
    pushToken:
      String(
        body.pushToken ?? "",
      ).trim().slice(0, 700) || null,
    metadata:
      body.metadata &&
      typeof body.metadata === "object" &&
      !Array.isArray(body.metadata)
        ? body.metadata as Record<string, unknown>
        : {},
  };
}

export async function registerOrTouchDevice(
  db: AppDatabase,
  input: DeviceRuntimeInput,
) {
  const deviceId =
    normalizeDeviceId(input.deviceId);

  if (!deviceId) {
    return null;
  }

  const now = new Date();

  const [row] = await db
    .insert(deviceRegistrations)
    .values({
      userId: input.userId,
      deviceId,
      platform:
        normalizePlatform(input.platform),
      appVersion:
        input.appVersion ?? null,
      pushToken:
        input.pushToken ?? null,
      isActive: true,
      lastSeenAt: now,
      lastSyncAt:
        input.synced ? now : null,
      metadata:
        input.metadata ?? {},
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        deviceRegistrations.userId,
        deviceRegistrations.deviceId,
      ],
      set: {
        platform:
          normalizePlatform(input.platform),
        appVersion:
          input.appVersion ?? null,
        pushToken:
          input.pushToken ?? null,
        isActive: true,
        lastSeenAt: now,
        ...(input.synced
          ? { lastSyncAt: now }
          : {}),
        metadata:
          input.metadata ?? {},
        updatedAt: now,
      },
    })
    .returning();

  await db
    .insert(employeeRuntimeState)
    .values({
      userId: input.userId,
      lastSeenAt: now,
      lastSyncAt: input.synced ? now : null,
      currentDeviceId: deviceId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target:
        employeeRuntimeState.userId,
      set: {
        lastSeenAt: now,
        ...(input.synced ? { lastSyncAt: now } : {}),
        currentDeviceId: deviceId,
        updatedAt: now,
      },
    });

  return row;
}

export async function listUserDevices(
  db: AppDatabase,
  userId: number,
) {
  return db
    .select()
    .from(deviceRegistrations)
    .where(
      and(
        eq(deviceRegistrations.userId, userId),
        eq(deviceRegistrations.isActive, true),
      ),
    )
    .orderBy(
      desc(deviceRegistrations.lastSeenAt),
    );
}

export async function recordUsage(
  db: AppDatabase,
  input: {
    userId: number;
    actionKey: string;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await db
    .insert(usageEvents)
    .values({
      actorUserId: input.userId,
      surface: "sales_app",
      actionKey: input.actionKey,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? {},
    });
}
