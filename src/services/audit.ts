import type { AppDatabase } from "../db/db";
import { applianceAuditLog } from "../db/applianceSchema";

export async function writeAudit(
  db: AppDatabase,
  input: {
    actorUserId?: number | null;
    actorType?: string;
    action: string;
    entityType: string;
    entityId?: string | number | null;
    beforeState?: unknown;
    afterState?: unknown;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await db.insert(applianceAuditLog).values({
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorType ?? "admin",
      action: input.action,
      entityType: input.entityType,
      entityId:
        input.entityId === undefined || input.entityId === null
          ? null
          : String(input.entityId),
      beforeState: input.beforeState === undefined ? null : input.beforeState,
      afterState: input.afterState === undefined ? null : input.afterState,
      metadata: input.metadata ?? {},
    });
  } catch (error) {
    console.warn("Audit write failed:", error);
  }
}