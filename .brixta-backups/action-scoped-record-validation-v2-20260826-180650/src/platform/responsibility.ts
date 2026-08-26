import {
  and,
  eq,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../db/db";

import {
  mobileCapabilities,
} from "../db/schema";

import {
  actionDefinitions,
  workflowSteps,
} from "../db/workflowSchema";

import type {
  CrudOperation,
} from "./primitives";

export type ResponsibilityField = {
  key: string;
  label: string;
  inputType: string;
  dataType: string;
  required: boolean;
  config: Record<string, unknown>;
};

export type ResponsibilityConfig = {
  schemaVersion: number;
  input: {
    renderer: string;
    fields: ResponsibilityField[];
    strict: boolean;
  };
  app: {
    renderer: string;
    actions: Record<string, unknown>[];
    config: Record<string, unknown>;
  };
  output: {
    renderer: string;
    config: Record<string, unknown>;
  };
  crud: Record<CrudOperation, boolean>;
  raw: Record<string, unknown>;
};

export type ResponsibilityRow =
  typeof mobileCapabilities.$inferSelect;

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function inferDataType(
  inputType: string,
) {
  switch (inputType) {
    case "number":
    case "currency":
      return "number";
    case "integer":
      return "integer";
    case "toggle":
    case "checkbox":
      return "boolean";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "multi_select":
    case "location_route":
      return "array";
    case "location_point":
      return "geo_point";
    case "photo":
    case "file":
    case "signature":
    case "audio":
      return "media";
    default:
      return "string";
  }
}

function normalizeField(
  value: unknown,
  index: number,
): ResponsibilityField | null {
  const raw = objectValue(value);

  const key = String(
    raw.key ??
      raw.name ??
      `field_${index + 1}`,
  )
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!key) {
    return null;
  }

  const inputType = String(
    raw.inputType ??
      raw.type ??
      "text",
  ).trim() || "text";

  return {
    key,
    label:
      String(
        raw.label ??
          raw.title ??
          key,
      ).trim() || key,
    inputType,
    dataType:
      String(
        raw.dataType ??
          inferDataType(inputType),
      ).trim() ||
      inferDataType(inputType),
    required:
      Boolean(raw.required),
    config: objectValue(
      raw.config,
    ),
  };
}

/**
 * Accepts both the old CMS `{ fields: [...] }` shape and the new
 * `{ input, output, crud }` shape. This lets the backend be cleaned up
 * before the CMS follow-up patch lands.
 */
export function normalizeResponsibilityConfig(
  value: unknown,
): ResponsibilityConfig {
  const raw = objectValue(value);
  const inputRaw = objectValue(
    raw.input,
  );
  const appRaw = objectValue(
    raw.app,
  );
  const outputRaw = objectValue(
    raw.output,
  );
  const crudRaw = objectValue(
    raw.crud,
  );

  const rawFields =
    Array.isArray(inputRaw.fields)
      ? inputRaw.fields
      : Array.isArray(raw.fields)
        ? raw.fields
        : [];

  const fields = rawFields
    .map(normalizeField)
    .filter(
      (
        field,
      ): field is ResponsibilityField =>
        Boolean(field),
    );

  return {
    schemaVersion:
      Number(
        raw.schemaVersion ??
          1,
      ) || 1,

    input: {
      renderer:
        String(
          inputRaw.renderer ??
            raw.renderer ??
            "form",
        ).trim() || "form",
      fields,
      strict:
        Boolean(
          inputRaw.strict ??
            raw.strict ??
            false,
        ),
    },

    app: {
      renderer:
        String(
          appRaw.renderer ??
            "action_form_v1",
        ).trim() ||
        "action_form_v1",
      actions:
        Array.isArray(
          appRaw.actions,
        )
          ? appRaw.actions
              .map(objectValue)
              .filter(
                (action) =>
                  Object.keys(
                    action,
                  ).length > 0,
              )
          : [],
      config:
        objectValue(
          appRaw.config,
        ),
    },

    output: {
      renderer:
        String(
          outputRaw.renderer ??
            "table",
        ).trim() || "table",
      config:
        objectValue(
          outputRaw.config,
        ),
    },

    crud: {
      create:
        crudRaw.create === undefined
          ? true
          : Boolean(
              crudRaw.create,
            ),
      read:
        crudRaw.read === undefined
          ? true
          : Boolean(
              crudRaw.read,
            ),
      update:
        crudRaw.update === undefined
          ? true
          : Boolean(
              crudRaw.update,
            ),
      delete:
        crudRaw.delete === undefined
          ? false
          : Boolean(
              crudRaw.delete,
            ),
    },

    raw,
  };
}

export function responsibilityActionKey(
  responsibilityKey: string,
  operation: CrudOperation,
) {
  return `responsibility.${responsibilityKey}.${operation}`;
}

export async function getResponsibilityByKey(
  db: AppDatabase,
  key: string,
) {
  const normalizedKey = key
    .trim()
    .toLowerCase();

  const [responsibility] = await db
    .select()
    .from(mobileCapabilities)
    .where(
      and(
        eq(
          mobileCapabilities.key,
          normalizedKey,
        ),
        eq(
          mobileCapabilities.isActive,
          true,
        ),
      ),
    )
    .limit(1);

  return responsibility ?? null;
}

/**
 * Every Responsibility gets the same four CRUD action definitions.
 * The workflow engine references these stable keys; no domain route names
 * are baked into the workflow definition.
 */
export async function ensureResponsibilityActions(
  db: AppDatabase,
  responsibility: Pick<
    ResponsibilityRow,
    "id" | "key" | "title"
  >,
) {
  const operations: CrudOperation[] = [
    "create",
    "read",
    "update",
    "delete",
  ];

  for (const operation of operations) {
    const key = responsibilityActionKey(
      responsibility.key,
      operation,
    );

    await db
      .insert(actionDefinitions)
      .values({
        key,
        title:
          `${operation[0].toUpperCase()}${operation.slice(1)} ${responsibility.title}`,
        permissionKey:
          `responsibility.${responsibility.key}.${operation}`,
        entitlementKey: null,
        handlerKey:
          `record.${operation}`,
        capabilityId:
          responsibility.id,
        isActive: true,
        config: {
          origin:
            "responsibility_crud",
          responsibilityKey:
            responsibility.key,
          operation,
        },
      })
      .onConflictDoUpdate({
        target:
          actionDefinitions.key,
        set: {
          title:
            `${operation[0].toUpperCase()}${operation.slice(1)} ${responsibility.title}`,
          permissionKey:
            `responsibility.${responsibility.key}.${operation}`,
          handlerKey:
            `record.${operation}`,
          capabilityId:
            responsibility.id,
          isActive: true,
          updatedAt:
            new Date(),
        },
      });

    // Migration bridge for action keys created before the platform CRUD
    // contract. This DOES NOT keep the old HTTP routes. It only rewires
    // stored Workflow definitions to the generic Responsibility action.
    //
    // Examples:
    //   journey_plan.create          -> responsibility.journey_plan.create
    //   capability.stock_check.submit -> responsibility.stock_check.create
    const legacyKeys = [
      `${responsibility.key}.${operation}`,
      ...(operation === "create"
        ? [
            `capability.${responsibility.key}.submit`,
          ]
        : []),
    ];

    const [genericAction] = await db
      .select({ id: actionDefinitions.id })
      .from(actionDefinitions)
      .where(eq(actionDefinitions.key, key))
      .limit(1);

    if (genericAction) {
      for (const legacyKey of legacyKeys) {
        const [legacyAction] = await db
          .select({ id: actionDefinitions.id })
          .from(actionDefinitions)
          .where(eq(actionDefinitions.key, legacyKey))
          .limit(1);

        if (
          legacyAction &&
          legacyAction.id !== genericAction.id
        ) {
          await db
            .update(workflowSteps)
            .set({
              actionDefinitionId:
                genericAction.id,
            })
            .where(
              eq(
                workflowSteps.actionDefinitionId,
                legacyAction.id,
              ),
            );
        }
      }
    }
  }
}

function validDateString(
  value: unknown,
) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(
      value,
    );
}

function validDateTime(
  value: unknown,
) {
  return typeof value === "string" &&
    !Number.isNaN(
      Date.parse(value),
    );
}

function validGeoPoint(
  value: unknown,
) {
  const point = objectValue(value);
  const lat = Number(
    point.lat ??
      point.latitude,
  );
  const lng = Number(
    point.lng ??
      point.longitude,
  );

  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180;
}

function validMedia(
  value: unknown,
) {
  if (
    typeof value === "string"
  ) {
    return Boolean(
      value.trim(),
    );
  }

  const media = objectValue(value);
  return typeof media.url === "string" &&
    Boolean(
      media.url.trim(),
    );
}

function validDataType(
  dataType: string,
  value: unknown,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return true;
  }

  switch (dataType) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" &&
        Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return validDateString(value);
    case "datetime":
      return validDateTime(value);
    case "object":
      return typeof value === "object" &&
        value !== null &&
        !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "geo_point":
      return validGeoPoint(value);
    case "media":
      return validMedia(value);
    case "any":
      return true;
    default:
      // Unknown storage types are accepted deliberately so adding a new
      // renderer does not force a backend deploy. Use a known dataType when
      // strict server validation is required.
      return true;
  }
}

export function validateResponsibilityPayload(
  config: ResponsibilityConfig,
  payload: Record<string, unknown>,
  mode: "create" | "update",
) {
  const errors: string[] = [];
  const fieldMap = new Map(
    config.input.fields.map(
      (field) => [
        field.key,
        field,
      ],
    ),
  );

  for (const field of config.input.fields) {
    const hasValue =
      Object.prototype.hasOwnProperty.call(
        payload,
        field.key,
      );

    if (
      mode === "create" &&
      field.required &&
      !hasValue
    ) {
      errors.push(
        `${field.key} is required.`,
      );
      continue;
    }

    if (!hasValue) {
      continue;
    }

    if (
      !validDataType(
        field.dataType,
        payload[field.key],
      )
    ) {
      errors.push(
        `${field.key} must be ${field.dataType}.`,
      );
    }
  }

  if (config.input.strict) {
    for (const key of Object.keys(payload)) {
      if (!fieldMap.has(key)) {
        errors.push(
          `${key} is not defined by this Responsibility.`,
        );
      }
    }
  }

  return errors;
}
