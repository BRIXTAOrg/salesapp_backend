import {
  and,
  eq,
  ne,
  sql,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../../db/db";

import {
  dynamicSubmissions,
} from "../../db/applianceSchema";

import {
  mobileCapabilities,
} from "../../db/schema";

import {
  dataSources,
  entityRecords,
  entityTypes,
} from "../../db/platformVNextSchema";

export type RuntimeFilter = {
  field: string;
  operator?: string;
  value?: unknown;
};

export type RuntimeDataRow = {
  id: string;
  label: string;
  data: Record<string, unknown>;
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

function stringList(
  value: unknown,
) {
  return Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean)
    : [];
}

function safeIdentifier(
  value: string,
) {
  return /^[a-z_][a-z0-9_]*$/i.test(value);
}

function readPath(
  value: unknown,
  path: string,
): unknown {
  if (!path) return value;

  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, segment) => {
      if (
        current &&
        typeof current === "object" &&
        !Array.isArray(current)
      ) {
        return (current as Record<string, unknown>)[segment];
      }
      return undefined;
    }, value);
}

function matchesFilter(
  row: Record<string, unknown>,
  filter: RuntimeFilter,
) {
  const actual =
    readPath(row, filter.field);
  const expected =
    filter.value;

  switch (filter.operator ?? "eq") {
    case "neq":
      return actual !== expected;
    case "contains":
      if (Array.isArray(actual)) {
        return actual.includes(expected);
      }
      return String(actual ?? "")
        .toLowerCase()
        .includes(
          String(expected ?? "").toLowerCase(),
        );
    case "in":
      return Array.isArray(expected) &&
        expected.includes(actual);
    case "exists":
      return actual !== null &&
        actual !== undefined &&
        actual !== "";
    case "not_exists":
      return actual === null ||
        actual === undefined ||
        actual === "";
    default:
      return actual === expected;
  }
}

function displayLabel(
  row: Record<string, unknown>,
  displayField: string | null,
  id: string,
) {
  const candidates = [
    displayField,
    "name",
    "title",
    "label",
    "displayName",
    "display_name",
    "username",
    "code",
  ].filter((value): value is string => Boolean(value));

  for (const key of candidates) {
    const value =
      readPath(row, key);
    if (
      value !== null &&
      value !== undefined &&
      String(value).trim()
    ) {
      return String(value);
    }
  }

  return id;
}

function searchMatches(
  row: Record<string, unknown>,
  q: string,
  searchableFields: string[],
) {
  if (!q) return true;

  const needle =
    q.toLowerCase();
  const fields =
    searchableFields.length
      ? searchableFields
      : Object.keys(row).slice(0, 12);

  return fields.some((field) =>
    String(
      readPath(row, field) ?? "",
    )
      .toLowerCase()
      .includes(needle),
  );
}

export async function getDataSourceByKey(
  db: AppDatabase,
  key: string,
) {
  const [source] = await db
    .select()
    .from(dataSources)
    .where(
      and(
        eq(dataSources.key, key),
        eq(dataSources.isActive, true),
      ),
    )
    .limit(1);

  return source ?? null;
}

async function entityRows(
  db: AppDatabase,
  sourceRef: string,
) {
  const [type] = await db
    .select()
    .from(entityTypes)
    .where(
      and(
        eq(entityTypes.key, sourceRef),
        eq(entityTypes.isActive, true),
      ),
    )
    .limit(1);

  if (!type) return [];

  const rows = await db
    .select()
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.entityTypeId, type.id),
        ne(entityRecords.status, "deleted"),
      ),
    )
    .limit(1000);

  return rows.map((row) => ({
    id: String(row.id),
    status: row.status,
    externalKey: row.externalKey,
    ...objectValue(row.data),
  }));
}

async function responsibilityRows(
  db: AppDatabase,
  sourceRef: string,
) {
  const [responsibility] = await db
    .select({ id: mobileCapabilities.id })
    .from(mobileCapabilities)
    .where(
      and(
        eq(mobileCapabilities.key, sourceRef),
        eq(mobileCapabilities.isActive, true),
      ),
    )
    .limit(1);

  if (!responsibility) return [];

  const rows = await db
    .select()
    .from(dynamicSubmissions)
    .where(
      and(
        eq(dynamicSubmissions.capabilityId, responsibility.id),
        ne(dynamicSubmissions.status, "deleted"),
      ),
    )
    .limit(1000);

  return rows.map((row) => ({
    id: String(row.id),
    userId: row.userId,
    status: row.status,
    submittedAt: row.submittedAt,
    updatedAt: row.updatedAt,
    ...objectValue(row.payload),
  }));
}

async function tableRows(
  db: AppDatabase,
  sourceRef: string,
  allowedFields: string[],
) {
  if (!safeIdentifier(sourceRef)) {
    throw new Error("Unsafe Data Source table name.");
  }

  const fields =
    allowedFields
      .filter(safeIdentifier)
      .slice(0, 40);

  if (!fields.length) {
    throw new Error(
      "Registered table Data Source has no allowedFields; refusing to expose the table.",
    );
  }

  const projection =
    fields.map((field) => `"${field}"`).join(", ");

  const result = await db.execute(
    sql.raw(
      `SELECT ${projection} FROM "${sourceRef}" LIMIT 1000`,
    ),
  );

  return (result.rows ?? []).map((row) =>
    objectValue(row),
  );
}

export async function queryRuntimeDataSource(
  db: AppDatabase,
  input: {
    key: string;
    q?: string;
    limit?: number;
    filters?: RuntimeFilter[];
  },
) {
  const source =
    await getDataSourceByKey(
      db,
      input.key,
    );

  if (!source) {
    return {
      ok: false as const,
      status: 404,
      code: "DATA_SOURCE_NOT_FOUND",
      error: "Data Source not found or disabled.",
    };
  }

  const allowedFields =
    stringList(source.allowedFields);
  const searchableFields =
    stringList(source.searchableFields);

  let rows: Record<string, unknown>[];

  if (source.sourceType === "entity_store") {
    rows = await entityRows(db, source.sourceRef);
  } else if (source.sourceType === "responsibility_records") {
    rows = await responsibilityRows(db, source.sourceRef);
  } else if (source.sourceType === "table") {
    try {
      rows = await tableRows(
        db,
        source.sourceRef,
        allowedFields,
      );
    } catch (error) {
      return {
        ok: false as const,
        status: 409,
        code: "DATA_SOURCE_TABLE_NOT_READY",
        error:
          error instanceof Error
            ? error.message
            : "Registered table Data Source is not safe/ready for runtime use.",
      };
    }
  } else {
    return {
      ok: false as const,
      status: 501,
      code: "DATA_SOURCE_ADAPTER_REQUIRED",
      error: `Data Source type ${source.sourceType} needs a runtime adapter.`,
    };
  }

  const defaultFilters =
    Array.isArray(source.defaultFilters)
      ? source.defaultFilters
          .map((value) => objectValue(value))
          .map((value) => ({
            field: String(value.field ?? ""),
            operator: String(value.operator ?? "eq"),
            value: value.value,
          }))
          .filter((value) => value.field)
      : [];

  const filters = [
    ...defaultFilters,
    ...(input.filters ?? []),
  ].slice(0, 20);

  const q =
    String(input.q ?? "").trim();
  const limit = Math.min(
    Math.max(Number(input.limit) || 50, 1),
    500,
  );

  const filtered = rows
    .filter((row) =>
      filters.every((filter) =>
        matchesFilter(row, filter),
      ),
    )
    .filter((row) =>
      searchMatches(
        row,
        q,
        searchableFields,
      ),
    )
    .slice(0, limit);

  const valueField =
    source.valueField || "id";
  const displayField =
    source.displayField;

  const data: RuntimeDataRow[] = filtered.map((row, index) => {
    const id = String(
      readPath(row, valueField) ??
        readPath(row, "id") ??
        index,
    );

    const projected =
      allowedFields.length
        ? Object.fromEntries(
            allowedFields
              .filter((key) =>
                Object.prototype.hasOwnProperty.call(row, key),
              )
              .map((key) => [key, row[key]]),
          )
        : row;

    return {
      id,
      label:
        displayLabel(
          row,
          displayField,
          id,
        ),
      data:
        projected,
    };
  });

  return {
    ok: true as const,
    value: {
      source: {
        key: source.key,
        title: source.title,
        sourceType: source.sourceType,
        displayField: source.displayField,
        valueField: source.valueField,
        searchableFields,
        allowedFields,
        offlinePolicy:
          objectValue(source.offlinePolicy),
      },
      rows: data,
    },
  };
}

export async function getRuntimeDataSourceRecord(
  db: AppDatabase,
  input: {
    key: string;
    id: string;
  },
) {
  const result = await queryRuntimeDataSource(
    db,
    {
      key: input.key,
      limit: 500,
    },
  );

  if (!result.ok) {
    return result;
  }

  const row = result.value.rows.find(
    (item) => item.id === input.id,
  );

  if (!row) {
    return {
      ok: false as const,
      status: 404,
      code: "DATA_SOURCE_RECORD_NOT_FOUND",
      error: "Data Source record not found.",
    };
  }

  return {
    ok: true as const,
    value: {
      source: result.value.source,
      row,
    },
  };
}
