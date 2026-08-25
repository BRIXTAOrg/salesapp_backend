import crypto from "node:crypto";

import {
  and,
  desc,
  eq,
  inArray,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../../db/db";

import {
  mobileCapabilities,
} from "../../db/schema";

import {
  compiledResponsibilityManifests,
  responsibilityExtensions,
} from "../../db/platformVNextSchema";

import {
  workflowDefinitions,
  workflowVersions,
} from "../../db/workflowSchema";

import {
  extractResponsibilityKernel,
} from "../kernel/parser";

export type PublishedRuntimeManifest = {
  responsibilityId: number;
  version: number;
  manifestHash: string;
  manifest: Record<string, unknown>;
  kernel: ReturnType<typeof extractResponsibilityKernel>;
  source:
    | "compiled_manifest"
    | "published_extension"
    | "legacy_capability";
};

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stableHash(
  value: unknown,
) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

export async function getPublishedRuntimeManifest(
  db: AppDatabase,
  responsibilityId: number,
): Promise<PublishedRuntimeManifest | null> {
  const [compiled] = await db
    .select()
    .from(compiledResponsibilityManifests)
    .where(
      eq(
        compiledResponsibilityManifests.responsibilityId,
        responsibilityId,
      ),
    )
    .orderBy(
      desc(compiledResponsibilityManifests.version),
    )
    .limit(1);

  if (compiled) {
    const manifest =
      objectValue(compiled.manifest);

    return {
      responsibilityId,
      version:
        compiled.version,
      manifestHash:
        compiled.manifestHash,
      manifest,
      kernel:
        extractResponsibilityKernel(manifest),
      source:
        "compiled_manifest",
    };
  }

  const [extension] = await db
    .select()
    .from(responsibilityExtensions)
    .where(
      eq(
        responsibilityExtensions.responsibilityId,
        responsibilityId,
      ),
    )
    .limit(1);

  if (
    extension &&
    extension.publishedVersion > 0
  ) {
    const manifest = {
      manifestVersion: 2,
      responsibilityId,
      version:
        extension.publishedVersion,
      extension:
        objectValue(
          extension.publishedConfig,
        ),
    } satisfies Record<string, unknown>;

    return {
      responsibilityId,
      version:
        extension.publishedVersion,
      manifestHash:
        extension.compiledHash ??
        stableHash(manifest),
      manifest,
      kernel:
        extractResponsibilityKernel(manifest),
      source:
        "published_extension",
    };
  }

  const [capability] = await db
    .select({
      id:
        mobileCapabilities.id,
      config:
        mobileCapabilities.config,
      updatedAt:
        mobileCapabilities.updatedAt,
    })
    .from(mobileCapabilities)
    .where(
      and(
        eq(
          mobileCapabilities.id,
          responsibilityId,
        ),
        eq(
          mobileCapabilities.isActive,
          true,
        ),
      ),
    )
    .limit(1);

  if (!capability) {
    return null;
  }

  const manifest = {
    manifestVersion: 1,
    responsibilityId,
    version: 0,
    baseDefinition:
      objectValue(capability.config),
  } satisfies Record<string, unknown>;

  return {
    responsibilityId,
    version: 0,
    manifestHash:
      stableHash({
        config:
          capability.config,
        updatedAt:
          capability.updatedAt,
      }),
    manifest,
    kernel:
      extractResponsibilityKernel(
        capability.config,
      ),
    source:
      "legacy_capability",
  };
}

export async function getPublishedRuntimeManifests(
  db: AppDatabase,
  responsibilityIds: number[],
) {
  if (!responsibilityIds.length) {
    return new Map<number, PublishedRuntimeManifest>();
  }

  const rows = await db
    .select()
    .from(compiledResponsibilityManifests)
    .where(
      inArray(
        compiledResponsibilityManifests.responsibilityId,
        responsibilityIds,
      ),
    )
    .orderBy(
      compiledResponsibilityManifests.responsibilityId,
      desc(compiledResponsibilityManifests.version),
    );

  const result =
    new Map<number, PublishedRuntimeManifest>();

  for (const row of rows) {
    if (result.has(row.responsibilityId)) {
      continue;
    }

    const manifest =
      objectValue(row.manifest);

    result.set(
      row.responsibilityId,
      {
        responsibilityId:
          row.responsibilityId,
        version:
          row.version,
        manifestHash:
          row.manifestHash,
        manifest,
        kernel:
          extractResponsibilityKernel(manifest),
        source:
          "compiled_manifest",
      },
    );
  }

  for (const responsibilityId of responsibilityIds) {
    if (result.has(responsibilityId)) {
      continue;
    }

    const fallback =
      await getPublishedRuntimeManifest(
        db,
        responsibilityId,
      );

    if (fallback) {
      result.set(
        responsibilityId,
        fallback,
      );
    }
  }

  return result;
}

export async function computeWorkspaceRevision(
  db: AppDatabase,
  responsibilityIds: number[],
) {
  const manifests =
    await getPublishedRuntimeManifests(
      db,
      responsibilityIds,
    );

  const workflows = await db
    .select({
      workflowId:
        workflowDefinitions.id,
      workflowUpdatedAt:
        workflowDefinitions.updatedAt,
      version:
        workflowVersions.version,
      publishedAt:
        workflowVersions.publishedAt,
    })
    .from(workflowDefinitions)
    .leftJoin(
      workflowVersions,
      and(
        eq(
          workflowVersions.workflowId,
          workflowDefinitions.id,
        ),
        eq(
          workflowVersions.status,
          "published",
        ),
      ),
    )
    .where(
      eq(
        workflowDefinitions.isActive,
        true,
      ),
    );

  return stableHash({
    responsibilities:
      [...manifests.values()]
        .map((manifest) => ({
          id:
            manifest.responsibilityId,
          version:
            manifest.version,
          hash:
            manifest.manifestHash,
        }))
        .sort((a, b) => a.id - b.id),
    workflows:
      workflows.map((row) => ({
        id:
          row.workflowId,
        updatedAt:
          row.workflowUpdatedAt,
        version:
          row.version,
        publishedAt:
          row.publishedAt,
      })),
  });
}

function objectReferencesDataSource(
  value: unknown,
  sourceKey: string,
  depth = 0,
): boolean {
  if (depth > 12 || value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) =>
      objectReferencesDataSource(
        item,
        sourceKey,
        depth + 1,
      ),
    );
  }

  if (typeof value !== "object") {
    return false;
  }

  const raw = value as Record<string, unknown>;
  const directKeys = [
    "sourceKey",
    "dataSourceKey",
    "referenceSourceKey",
    "source",
    "from",
  ];

  if (
    directKeys.some(
      (key) =>
        String(raw[key] ?? "") === sourceKey,
    )
  ) {
    return true;
  }

  return Object.values(raw).some((child) =>
    objectReferencesDataSource(
      child,
      sourceKey,
      depth + 1,
    ),
  );
}

export function manifestReferencesDataSource(
  manifest: PublishedRuntimeManifest,
  sourceKey: string,
) {
  return objectReferencesDataSource(
    manifest.manifest,
    sourceKey,
  );
}
