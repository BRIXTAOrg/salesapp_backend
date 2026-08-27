import { eq } from "drizzle-orm";

import type {
  AppDatabase,
} from "../../db/db";

import {
  platformMeta,
  responsibilityExtensions,
} from "../../db/platformVNextSchema";

import {
  normalizePixelLogicProgram,
  PIXEL_LOGIC_METADATA_KEY,
  type PixelLogicProgram,
} from "./types";

const ASSIGNMENT_PREFIX =
  "pixel_logic_assignments_employee_";

function asObject(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeIds(
  value: unknown,
) {
  const raw =
    Array.isArray(value)
      ? value
      : value &&
          typeof value === "object" &&
          Array.isArray(
            (
              value as {
                responsibilityIds?: unknown;
              }
            ).responsibilityIds,
          )
        ? (
            value as {
              responsibilityIds: unknown[];
            }
          ).responsibilityIds
        : [];

  return [
    ...new Set(
      raw
        .map(Number)
        .filter(
          (id) =>
            Number.isInteger(id) &&
            id > 0,
        ),
    ),
  ];
}

async function isPixelLogicAssigned(
  db: AppDatabase,
  employeeId: number,
  responsibilityId: number,
) {
  const key =
    `${ASSIGNMENT_PREFIX}${employeeId}`;

  const [row] = await db
    .select({
      value: platformMeta.value,
    })
    .from(platformMeta)
    .where(
      eq(
        platformMeta.key,
        key,
      ),
    )
    .limit(1);

  return normalizeIds(
    row?.value,
  ).includes(
    responsibilityId,
  );
}

export async function getPublishedPixelLogic(
  db: AppDatabase,
  input: {
    employeeId: number;
    responsibilityId: number;
  },
): Promise<PixelLogicProgram | null> {
  const assigned =
    await isPixelLogicAssigned(
      db,
      input.employeeId,
      input.responsibilityId,
    );

  if (!assigned) {
    return null;
  }

  const [extension] = await db
    .select({
      publishedConfig:
        responsibilityExtensions.publishedConfig,
      publishedVersion:
        responsibilityExtensions.publishedVersion,
    })
    .from(
      responsibilityExtensions,
    )
    .where(
      eq(
        responsibilityExtensions.responsibilityId,
        input.responsibilityId,
      ),
    )
    .limit(1);

  if (!extension) {
    return null;
  }

  const published =
    asObject(
      extension.publishedConfig,
    );

  const metadata =
    asObject(
      published.metadata,
    );

  const rawProgram =
    metadata[
      PIXEL_LOGIC_METADATA_KEY
    ];

  if (!rawProgram) {
    return null;
  }

  const program =
    normalizePixelLogicProgram(
      rawProgram,
    );

  if (!program.enabled) {
    return null;
  }

  return program;
}
