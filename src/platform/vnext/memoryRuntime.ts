import {
  and,
  eq,
  gt,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../../db/db";

import {
  entityFieldMemory,
} from "../../db/platformVNextSchema";

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function getEntityMemory(
  db: AppDatabase,
  input: {
    sourceKey: string;
    entityId: string;
    fieldKey?: string | null;
  },
) {
  const now = new Date();
  const where = [
    eq(entityFieldMemory.sourceKey, input.sourceKey),
    eq(entityFieldMemory.entityId, input.entityId),
    or(
      isNull(entityFieldMemory.validUntil),
      gt(entityFieldMemory.validUntil, now),
    )!,
  ];

  if (input.fieldKey) {
    where.push(
      eq(entityFieldMemory.fieldKey, input.fieldKey),
    );
  }

  const rows = await db
    .select()
    .from(entityFieldMemory)
    .where(and(...where));

  return rows.map((row) => ({
    fieldKey: row.fieldKey,
    value: row.value,
    validUntil: row.validUntil,
    useCount: row.useCount,
    lastConfirmedAt: row.lastConfirmedAt,
    metadata: objectValue(row.metadata),
  }));
}

export async function confirmEntityMemory(
  db: AppDatabase,
  input: {
    userId: number;
    sourceKey: string;
    entityId: string;
    fieldKey: string;
    value: unknown;
    ttlDays?: number | null;
    metadata?: unknown;
  },
) {
  const now = new Date();
  const ttlDays = Number(input.ttlDays);
  const validUntil =
    Number.isFinite(ttlDays) &&
    ttlDays > 0
      ? new Date(
          now.getTime() +
            ttlDays * 86_400_000,
        )
      : null;

  const [row] = await db
    .insert(entityFieldMemory)
    .values({
      sourceKey: input.sourceKey,
      entityId: input.entityId,
      fieldKey: input.fieldKey,
      value: input.value,
      validUntil,
      useCount: 1,
      lastConfirmedByUserId: input.userId,
      lastConfirmedAt: now,
      metadata: objectValue(input.metadata),
    })
    .onConflictDoUpdate({
      target: [
        entityFieldMemory.sourceKey,
        entityFieldMemory.entityId,
        entityFieldMemory.fieldKey,
      ],
      set: {
        value: input.value,
        validUntil,
        useCount:
          sql`${entityFieldMemory.useCount} + 1`,
        lastConfirmedByUserId: input.userId,
        lastConfirmedAt: now,
        metadata: objectValue(input.metadata),
      },
    })
    .returning();

  return row;
}
