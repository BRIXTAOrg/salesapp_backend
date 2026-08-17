import {
  and,
  count,
  eq,
  gte,
} from "drizzle-orm";

import type { AppDatabase } from "../db/db";
import {
  usageEvents,
  userPins,
} from "../db/applianceSchema";
import type {
  ResolvedCapability,
} from "./capabilityResolver";

export async function rankMobileCapabilities(
  db: AppDatabase,
  userId: number,
  capabilities: ResolvedCapability[],
) {
  const cutoff = new Date(
    Date.now() -
      45 * 24 * 60 * 60 * 1000,
  );

  const [pins, usageRows] =
    await Promise.all([
      db
        .select()
        .from(userPins)
        .where(
          and(
            eq(userPins.userId, userId),
            eq(userPins.surface, "mobile_home"),
          ),
        )
        .orderBy(userPins.sortOrder),

      db
        .select({
          actionKey: usageEvents.actionKey,
          usageCount: count(),
        })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.actorUserId, userId),
            eq(usageEvents.surface, "mobile"),
            gte(usageEvents.occurredAt, cutoff),
          ),
        )
        .groupBy(usageEvents.actionKey),
    ]);

  const pinOrder =
    new Map<string, number>(
      pins.map((pin, index) => [
        pin.itemKey,
        index,
      ]),
    );

  const usageMap =
    new Map<string, number>(
      usageRows.map((row) => [
        row.actionKey,
        Number(row.usageCount),
      ]),
    );

  return [...capabilities]
    .sort((a, b) => {
      const aPinned =
        pinOrder.has(a.key);
      const bPinned =
        pinOrder.has(b.key);

      if (aPinned !== bPinned) {
        return aPinned ? -1 : 1;
      }

      if (aPinned && bPinned) {
        return (
          (pinOrder.get(a.key) ?? 0) -
          (pinOrder.get(b.key) ?? 0)
        );
      }

      const usageDelta =
        (usageMap.get(b.key) ?? 0) -
        (usageMap.get(a.key) ?? 0);

      if (usageDelta !== 0) {
        return usageDelta;
      }

      return (
        a.sortOrder - b.sortOrder ||
        a.title.localeCompare(b.title)
      );
    })
    .map((capability) => ({
      ...capability,
      adaptive: {
        pinned:
          pinOrder.has(capability.key),
        usageCount:
          usageMap.get(
            capability.key,
          ) ?? 0,
      },
    }));
}