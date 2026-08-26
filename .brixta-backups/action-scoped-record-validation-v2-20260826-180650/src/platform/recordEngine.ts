import crypto from "node:crypto";

import {
  and,
  desc,
  eq,
  ne,
  sql,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../db/db";

import {
  dynamicSubmissions,
} from "../db/applianceSchema";

import {
  getResolvedCapabilitiesForUser,
} from "../services/capabilityResolver";

import {
  authorizeAction,
} from "../services/actionAuthorization";

import {
  recordCompletedWorkflowAction,
} from "../services/workflowEngine";

import {
  ensureResponsibilityActions,
  getResponsibilityByKey,
  normalizeResponsibilityConfig,
  responsibilityActionKey,
  validateResponsibilityPayload,
} from "./responsibility";

import type {
  CrudOperation,
} from "./primitives";

export type RecordEngineError = {
  ok: false;
  status: number;
  code: string;
  error: string;
  details?: unknown;
};

export type RecordEngineSuccess<T> = {
  ok: true;
  value: T;
};

export type RecordEngineResult<T> =
  | RecordEngineSuccess<T>
  | RecordEngineError;

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function validUuid(
  value: string,
) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function resolveAssignedResponsibility(
  db: AppDatabase,
  userId: number,
  responsibilityKey: string,
) {
  const responsibility =
    await getResponsibilityByKey(
      db,
      responsibilityKey,
    );

  if (!responsibility) {
    return {
      ok: false as const,
      status: 404,
      code:
        "RESPONSIBILITY_NOT_FOUND",
      error:
        "Responsibility not found or disabled.",
    };
  }

  const resolved =
    await getResolvedCapabilitiesForUser(
      db,
      userId,
    );

  if (
    !resolved.some(
      (item) =>
        item.id ===
        responsibility.id,
    )
  ) {
    return {
      ok: false as const,
      status: 403,
      code:
        "RESPONSIBILITY_NOT_ASSIGNED",
      error:
        "This Responsibility is not assigned to the employee.",
    };
  }

  await ensureResponsibilityActions(
    db,
    responsibility,
  );

  return {
    ok: true as const,
    responsibility,
    config:
      normalizeResponsibilityConfig(
        responsibility.config,
      ),
  };
}

function crudDisabled(
  operation: CrudOperation,
) {
  return {
    ok: false as const,
    status: 403,
    code:
      "CRUD_OPERATION_DISABLED",
    error:
      `${operation} is disabled for this Responsibility.`,
  };
}

type ResponsibilityAppAction = {
  key: string;
  operation: "create" | "update";
  status: string;
  fieldKeys: string[];
  requiredFieldKeys: string[];
  visibility: {
    mode:
      | "always"
      | "no_record"
      | "latest_status_is"
      | "latest_status_is_not";
    status?: string;
  };
  target?: {
    mode?: string;
    status?: string;
  };
  capture?: {
    location?: {
      fieldKey?: string;
      required?: boolean;
    };
  };
};

function stringList(
  value: unknown,
) {
  return Array.isArray(value)
    ? value
        .map((item) =>
          String(item ?? "").trim(),
        )
        .filter(Boolean)
    : [];
}

function responsibilityAppActions(
  config: ReturnType<
    typeof normalizeResponsibilityConfig
  >,
): ResponsibilityAppAction[] {
  const rawActions =
    config.app.actions;

  return rawActions
    .map((value): ResponsibilityAppAction | null => {
      const raw = objectValue(value);
      const key = String(
        raw.key ?? "",
      ).trim();
      const operation =
        String(
          raw.operation ??
            "create",
        ).trim() === "update"
          ? "update"
          : "create";

      if (!key) {
        return null;
      }

      const visibilityRaw =
        objectValue(
          raw.visibility,
        );
      const visibilityMode =
        String(
          visibilityRaw.mode ??
            "always",
        ).trim();

      const allowedModes =
        new Set([
          "always",
          "no_record",
          "latest_status_is",
          "latest_status_is_not",
        ]);

      const captureRaw =
        objectValue(raw.capture);
      const locationRaw =
        objectValue(
          captureRaw.location,
        );

      return {
        key,
        operation,
        status:
          String(
            raw.status ??
              "submitted",
          ).trim() ||
          "submitted",
        fieldKeys:
          stringList(
            raw.fieldKeys,
          ),
        requiredFieldKeys:
          stringList(
            raw.requiredFieldKeys,
          ),
        visibility: {
          mode:
            allowedModes.has(
              visibilityMode,
            )
              ? visibilityMode as
                  ResponsibilityAppAction["visibility"]["mode"]
              : "always",
          status:
            String(
              visibilityRaw.status ??
                "",
            ).trim() ||
            undefined,
        },
        target: {
          mode:
            String(
              objectValue(
                raw.target,
              ).mode ?? "",
            ).trim() ||
            undefined,
          status:
            String(
              objectValue(
                raw.target,
              ).status ?? "",
            ).trim() ||
            undefined,
        },
        capture:
          Object.keys(
            locationRaw,
          ).length
            ? {
                location: {
                  fieldKey:
                    String(
                      locationRaw.fieldKey ??
                        "",
                    ).trim() ||
                    undefined,
                  required:
                    locationRaw.required ===
                    true,
                },
              }
            : undefined,
      } satisfies ResponsibilityAppAction;
    })
    .filter(
      (
        action,
      ): action is ResponsibilityAppAction =>
        Boolean(action),
    );
}

function emptyAppValue(
  value: unknown,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return true;
  }

  if (typeof value === "string") {
    return !value.trim();
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (
    typeof value === "object"
  ) {
    return Object.keys(
      value as Record<
        string,
        unknown
      >,
    ).length === 0;
  }

  return false;
}

async function latestResponsibilityRecord(
  db: AppDatabase,
  input: {
    userId: number;
    responsibilityId: number;
  },
) {
  const [record] = await db
    .select()
    .from(
      dynamicSubmissions,
    )
    .where(
      and(
        eq(
          dynamicSubmissions.userId,
          input.userId,
        ),
        eq(
          dynamicSubmissions.capabilityId,
          input.responsibilityId,
        ),
        ne(
          dynamicSubmissions.status,
          "deleted",
        ),
      ),
    )
    .orderBy(
      desc(
        dynamicSubmissions.updatedAt,
      ),
    )
    .limit(1);

  return record ?? null;
}

function responsibilityInitialStatus(
  config: ReturnType<typeof normalizeResponsibilityConfig>,
) {
  const value = config.app.config.initialState;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function appActionVisibilityAllowed(
  action: ResponsibilityAppAction,
  latestStatus: string | null,
  hasRecord: boolean,
) {
  const expected =
    action.visibility.status;

  switch (
    action.visibility.mode
  ) {
    case "no_record":
      return !hasRecord;
    case "latest_status_is":
      return Boolean(expected) &&
        latestStatus === expected;
    case "latest_status_is_not":
      return Boolean(expected) &&
        latestStatus !== expected;
    default:
      return true;
  }
}

async function enforceAppAction(
  db: AppDatabase,
  input: {
    config: ReturnType<
      typeof normalizeResponsibilityConfig
    >;
    userId: number;
    responsibilityId: number;
    operation: "create" | "update";
    appActionKey?: unknown;
    payload: Record<string, unknown>;
    existingRecord?:
      typeof dynamicSubmissions.$inferSelect |
      null;
  },
): Promise<
  | {
      ok: true;
      action: ResponsibilityAppAction | null;
      status: string | null;
    }
  | RecordEngineError
> {
  const actions =
    responsibilityAppActions(
      input.config,
    );

  if (!actions.length) {
    return {
      ok: true,
      action: null,
      status: null,
    };
  }

  const actionKey =
    typeof input.appActionKey ===
      "string"
      ? input.appActionKey.trim()
      : "";

  if (!actionKey) {
    return {
      ok: false,
      status: 400,
      code:
        "APP_ACTION_REQUIRED",
      error:
        "This Responsibility must be executed through one of its configured app actions.",
    };
  }

  const action =
    actions.find(
      (candidate) =>
        candidate.key ===
        actionKey,
    );

  if (!action) {
    return {
      ok: false,
      status: 400,
      code:
        "APP_ACTION_NOT_FOUND",
      error:
        "The requested app action is not defined by this Responsibility.",
    };
  }

  if (
    action.operation !==
    input.operation
  ) {
    return {
      ok: false,
      status: 409,
      code:
        "APP_ACTION_OPERATION_MISMATCH",
      error:
        `App action ${action.key} requires ${action.operation}, not ${input.operation}.`,
    };
  }

  const allowedKeys =
    new Set(
      action.fieldKeys,
    );

  const capturedLocationKey =
    action.capture?.location
      ?.fieldKey;

  if (capturedLocationKey) {
    allowedKeys.add(
      capturedLocationKey,
    );
  }

  for (const key of Object.keys(
    input.payload,
  )) {
    if (!allowedKeys.has(key)) {
      return {
        ok: false,
        status: 400,
        code:
          "APP_ACTION_FIELD_NOT_ALLOWED",
        error:
          `${key} is not accepted by the ${action.key} app action.`,
      };
    }
  }

  const requiredKeys =
    new Set(
      action.requiredFieldKeys,
    );

  if (
    action.capture?.location
      ?.required &&
    capturedLocationKey
  ) {
    requiredKeys.add(
      capturedLocationKey,
    );
  }

  for (const key of requiredKeys) {
    if (
      emptyAppValue(
        input.payload[key],
      )
    ) {
      return {
        ok: false,
        status: 400,
        code:
          "APP_ACTION_REQUIRED_FIELD",
        error:
          `${key} is required by the ${action.key} app action.`,
      };
    }
  }

  const latest =
    await latestResponsibilityRecord(
      db,
      {
        userId:
          input.userId,
        responsibilityId:
          input.responsibilityId,
      },
    );

  if (
    !appActionVisibilityAllowed(
      action,
      latest?.status ?? responsibilityInitialStatus(input.config),
      Boolean(latest),
    )
  ) {
    return {
      ok: false,
      status: 409,
      code:
        "APP_ACTION_NOT_AVAILABLE",
      error:
        "This app action is not available in the current Responsibility state.",
    };
  }

  if (
    input.operation ===
      "update" &&
    action.target?.status &&
    input.existingRecord?.status !==
      action.target.status
  ) {
    return {
      ok: false,
      status: 409,
      code:
        "APP_ACTION_TARGET_MISMATCH",
      error:
        "The selected record does not match this app action's target state.",
    };
  }

  return {
    ok: true,
    action,
    status:
      action.status,
  };
}

export async function listOwnRecords(
  db: AppDatabase,
  input: {
    userId: number;
    responsibilityKey: string;
    limit?: number;
  },
): Promise<RecordEngineResult<{
  responsibility: unknown;
  definition: unknown;
  records: Array<
    typeof dynamicSubmissions.$inferSelect
  >;
}>> {
  const resolved =
    await resolveAssignedResponsibility(
      db,
      input.userId,
      input.responsibilityKey,
    );

  if (!resolved.ok) {
    return resolved;
  }

  if (!resolved.config.crud.read) {
    return crudDisabled("read");
  }

  const limit = Math.min(
    Math.max(
      Number(input.limit) ||
        100,
      1,
    ),
    500,
  );

  const records = await db
    .select()
    .from(
      dynamicSubmissions,
    )
    .where(
      and(
        eq(
          dynamicSubmissions.userId,
          input.userId,
        ),
        eq(
          dynamicSubmissions.capabilityId,
          resolved.responsibility.id,
        ),
        ne(
          dynamicSubmissions.status,
          "deleted",
        ),
      ),
    )
    .orderBy(
      desc(
        dynamicSubmissions.updatedAt,
      ),
    )
    .limit(limit);

  const readActionKey =
    responsibilityActionKey(
      resolved.responsibility.key,
      "read",
    );

  const visibleRecords: Array<
    typeof dynamicSubmissions.$inferSelect
  > = [];

  for (const record of records) {
    const authorization =
      await authorizeAction(
        db,
        {
          actorUserId:
            input.userId,
          actionKey:
            readActionKey,
          contextType:
            "responsibility_record",
          contextId:
            record.id,
          allowCompleted:
            true,
        },
      );

    if (authorization.allowed) {
      visibleRecords.push(
        record,
      );
    }
  }

  return {
    ok: true,
    value: {
      responsibility:
        resolved.responsibility,
      definition:
        resolved.config,
      records:
        visibleRecords,
    },
  };
}

export async function getOwnRecord(
  db: AppDatabase,
  input: {
    userId: number;
    responsibilityKey: string;
    recordId: string;
  },
): Promise<RecordEngineResult<{
  responsibility: unknown;
  definition: unknown;
  record:
    typeof dynamicSubmissions.$inferSelect;
}>> {
  const resolved =
    await resolveAssignedResponsibility(
      db,
      input.userId,
      input.responsibilityKey,
    );

  if (!resolved.ok) {
    return resolved;
  }

  if (!resolved.config.crud.read) {
    return crudDisabled("read");
  }

  const [record] = await db
    .select()
    .from(
      dynamicSubmissions,
    )
    .where(
      and(
        eq(
          dynamicSubmissions.id,
          input.recordId,
        ),
        eq(
          dynamicSubmissions.userId,
          input.userId,
        ),
        eq(
          dynamicSubmissions.capabilityId,
          resolved.responsibility.id,
        ),
        ne(
          dynamicSubmissions.status,
          "deleted",
        ),
      ),
    )
    .limit(1);

  if (!record) {
    return {
      ok: false,
      status: 404,
      code:
        "RECORD_NOT_FOUND",
      error:
        "Record not found.",
    };
  }

  const actionKey =
    responsibilityActionKey(
      resolved.responsibility.key,
      "read",
    );

  const authorization =
    await authorizeAction(
      db,
      {
        actorUserId:
          input.userId,
        actionKey,
        contextType:
          "responsibility_record",
        contextId:
          record.id,
        allowCompleted:
          true,
      },
    );

  if (!authorization.allowed) {
    return {
      ok: false,
      status:
        authorization.status,
      code:
        authorization.code,
      error:
        authorization.reason ??
        "This record is not viewable in the current Workflow state.",
    };
  }

  if (
    authorization.code ===
    "OK"
  ) {
    await recordCompletedWorkflowAction(
      db,
      {
        actionKey,
        subjectUserId:
          input.userId,
        actorUserId:
          input.userId,
        workflowInstanceId:
          authorization.workflowInstanceId,
        contextType:
          "responsibility_record",
        contextId:
          record.id,
        context: {
          responsibilityId:
            resolved.responsibility.id,
          responsibilityKey:
            resolved.responsibility.key,
          recordId:
            record.id,
        },
        sourceType:
          "responsibility_record_view",
        sourceId:
          record.id,
      },
    );
  }

  return {
    ok: true,
    value: {
      responsibility:
        resolved.responsibility,
      definition:
        resolved.config,
      record,
    },
  };
}

export async function createRecord(
  db: AppDatabase,
  input: {
    userId: number;
    responsibilityKey: string;
    payload: unknown;
    status?: unknown;
    appActionKey?: unknown;
    clientMutationId?: unknown;
    clientCreatedAt?: unknown;
    workflowInstanceId?: unknown;
  },
): Promise<RecordEngineResult<{
  record:
    typeof dynamicSubmissions.$inferSelect;
  idempotent: boolean;
  workflowInstanceIds: string[];
}>> {
  const resolved =
    await resolveAssignedResponsibility(
      db,
      input.userId,
      input.responsibilityKey,
    );

  if (!resolved.ok) {
    return resolved;
  }

  if (!resolved.config.crud.create) {
    return crudDisabled("create");
  }

  const suppliedClientMutationId =
    typeof input.clientMutationId ===
      "string"
      ? input.clientMutationId.trim()
      : "";

  if (
    suppliedClientMutationId &&
    !validUuid(
      suppliedClientMutationId,
    )
  ) {
    return {
      ok: false,
      status: 400,
      code:
        "INVALID_CLIENT_MUTATION_ID",
      error:
        "clientMutationId must be a UUID when supplied.",
    };
  }

  const clientMutationId =
    suppliedClientMutationId ||
    crypto.randomUUID();

  // Idempotency must run before app-state/workflow checks. A mobile client may
  // retry after the original request committed but its response was lost; the
  // committed record itself may already have changed the action visibility.
  if (suppliedClientMutationId) {
    const [existing] = await db
      .select()
      .from(
        dynamicSubmissions,
      )
      .where(
        and(
          eq(
            dynamicSubmissions.clientMutationId,
            clientMutationId,
          ),
          eq(
            dynamicSubmissions.userId,
            input.userId,
          ),
          eq(
            dynamicSubmissions.capabilityId,
            resolved.responsibility.id,
          ),
        ),
      )
      .limit(1);

    if (existing) {
      return {
        ok: true,
        value: {
          record:
            existing,
          idempotent: true,
          workflowInstanceIds: [],
        },
      };
    }
  }

  const payload =
    objectValue(input.payload);

  const appAction =
    await enforceAppAction(
      db,
      {
        config:
          resolved.config,
        userId:
          input.userId,
        responsibilityId:
          resolved.responsibility.id,
        operation:
          "create",
        appActionKey:
          input.appActionKey,
        payload,
      },
    );

  if (!appAction.ok) {
    return appAction;
  }

  const validationErrors =
    validateResponsibilityPayload(
      resolved.config,
      payload,
      "create",
    );

  if (validationErrors.length) {
    return {
      ok: false,
      status: 400,
      code:
        "RECORD_VALIDATION_FAILED",
      error:
        "Record payload does not match the Responsibility definition.",
      details:
        validationErrors,
    };
  }

  const actionKey =
    responsibilityActionKey(
      resolved.responsibility.key,
      "create",
    );

  const workflowInstanceId =
    typeof input.workflowInstanceId ===
      "string" &&
    input.workflowInstanceId.trim()
      ? input.workflowInstanceId.trim()
      : null;

  const authorization =
    await authorizeAction(
      db,
      {
        actorUserId:
          input.userId,
        actionKey,
        workflowInstanceId,
      },
    );

  if (!authorization.allowed) {
    return {
      ok: false,
      status:
        authorization.status,
      code:
        authorization.code,
      error:
        authorization.reason ??
        "Workflow action is blocked.",
    };
  }

  const effectiveStatus =
    appAction.status ??
    (typeof input.status ===
        "string" &&
      input.status.trim()
      ? input.status.trim()
      : "submitted");

  const [record] = await db
    .insert(
      dynamicSubmissions,
    )
    .values({
      clientMutationId,
      userId:
        input.userId,
      capabilityId:
        resolved.responsibility.id,
      status:
        effectiveStatus,
      payload,
      clientCreatedAt:
        input.clientCreatedAt
          ? new Date(
              String(
                input.clientCreatedAt,
              ),
            )
          : null,
    })
    .returning();

  const transition =
    await recordCompletedWorkflowAction(
      db,
      {
        actionKey,
        subjectUserId:
          input.userId,
        actorUserId:
          input.userId,
        workflowInstanceId:
          authorization.workflowInstanceId ??
          workflowInstanceId,
        contextType:
          "responsibility_record",
        contextId:
          record.id,
        context: {
          responsibilityId:
            resolved.responsibility.id,
          responsibilityKey:
            resolved.responsibility.key,
          recordId:
            record.id,
          appActionKey:
            appAction.action?.key ??
            null,
        },
        sourceType:
          "responsibility_record",
        sourceId:
          record.id,
      },
    );

  return {
    ok: true,
    value: {
      record,
      idempotent: false,
      workflowInstanceIds:
        transition.startedWorkflowInstanceIds.length
          ? transition.startedWorkflowInstanceIds
          : authorization.workflowInstanceId
            ? [
                authorization.workflowInstanceId,
              ]
            : [],
    },
  };
}

export async function updateRecord(
  db: AppDatabase,
  input: {
    userId: number;
    responsibilityKey: string;
    recordId: string;
    payload: unknown;
    status?: unknown;
    appActionKey?: unknown;
    workflowInstanceId?: unknown;
  },
): Promise<RecordEngineResult<{
  record:
    typeof dynamicSubmissions.$inferSelect;
}>> {
  const resolved =
    await resolveAssignedResponsibility(
      db,
      input.userId,
      input.responsibilityKey,
    );

  if (!resolved.ok) {
    return resolved;
  }

  if (!resolved.config.crud.update) {
    return crudDisabled("update");
  }

  const [existing] = await db
    .select()
    .from(
      dynamicSubmissions,
    )
    .where(
      and(
        eq(
          dynamicSubmissions.id,
          input.recordId,
        ),
        eq(
          dynamicSubmissions.userId,
          input.userId,
        ),
        eq(
          dynamicSubmissions.capabilityId,
          resolved.responsibility.id,
        ),
        ne(
          dynamicSubmissions.status,
          "deleted",
        ),
      ),
    )
    .limit(1);

  if (!existing) {
    return {
      ok: false,
      status: 404,
      code:
        "RECORD_NOT_FOUND",
      error:
        "Record not found.",
    };
  }

  const patch =
    objectValue(input.payload);

  const appAction =
    await enforceAppAction(
      db,
      {
        config:
          resolved.config,
        userId:
          input.userId,
        responsibilityId:
          resolved.responsibility.id,
        operation:
          "update",
        appActionKey:
          input.appActionKey,
        payload:
          patch,
        existingRecord:
          existing,
      },
    );

  if (!appAction.ok) {
    return appAction;
  }

  const validationErrors =
    validateResponsibilityPayload(
      resolved.config,
      patch,
      "update",
    );

  if (validationErrors.length) {
    return {
      ok: false,
      status: 400,
      code:
        "RECORD_VALIDATION_FAILED",
      error:
        "Record payload does not match the Responsibility definition.",
      details:
        validationErrors,
    };
  }

  const actionKey =
    responsibilityActionKey(
      resolved.responsibility.key,
      "update",
    );

  const workflowInstanceId =
    typeof input.workflowInstanceId ===
      "string" &&
    input.workflowInstanceId.trim()
      ? input.workflowInstanceId.trim()
      : null;

  const authorization =
    await authorizeAction(
      db,
      {
        actorUserId:
          input.userId,
        actionKey,
        workflowInstanceId,
        contextType:
          "responsibility_record",
        contextId:
          existing.id,
      },
    );

  if (!authorization.allowed) {
    return {
      ok: false,
      status:
        authorization.status,
      code:
        authorization.code,
      error:
        authorization.reason ??
        "Workflow action is blocked.",
    };
  }

  const mergedPayload = {
    ...objectValue(
      existing.payload,
    ),
    ...patch,
  };

  const effectiveStatus =
    appAction.status ??
    (typeof input.status ===
        "string" &&
      input.status.trim()
      ? input.status.trim()
      : existing.status);

  const [record] = await db
    .update(
      dynamicSubmissions,
    )
    .set({
      payload:
        mergedPayload,
      status:
        effectiveStatus,
      updatedAt:
        new Date(),
      serverVersion:
        sql`${dynamicSubmissions.serverVersion} + 1`,
    })
    .where(
      eq(
        dynamicSubmissions.id,
        existing.id,
      ),
    )
    .returning();

  await recordCompletedWorkflowAction(
    db,
    {
      actionKey,
      subjectUserId:
        input.userId,
      actorUserId:
        input.userId,
      workflowInstanceId:
        authorization.workflowInstanceId ??
        workflowInstanceId,
      contextType:
        "responsibility_record",
      contextId:
        record.id,
      context: {
        responsibilityId:
          resolved.responsibility.id,
        responsibilityKey:
          resolved.responsibility.key,
        recordId:
          record.id,
        appActionKey:
          appAction.action?.key ??
          null,
      },
      sourceType:
        "responsibility_record",
      sourceId:
        record.id,
    },
  );

  return {
    ok: true,
    value: {
      record,
    },
  };
}

export async function deleteRecord(
  db: AppDatabase,
  input: {
    userId: number;
    responsibilityKey: string;
    recordId: string;
    workflowInstanceId?: unknown;
  },
): Promise<RecordEngineResult<{
  deletedId: string;
}>> {
  const resolved =
    await resolveAssignedResponsibility(
      db,
      input.userId,
      input.responsibilityKey,
    );

  if (!resolved.ok) {
    return resolved;
  }

  if (!resolved.config.crud.delete) {
    return crudDisabled("delete");
  }

  const [existing] = await db
    .select()
    .from(
      dynamicSubmissions,
    )
    .where(
      and(
        eq(
          dynamicSubmissions.id,
          input.recordId,
        ),
        eq(
          dynamicSubmissions.userId,
          input.userId,
        ),
        eq(
          dynamicSubmissions.capabilityId,
          resolved.responsibility.id,
        ),
        ne(
          dynamicSubmissions.status,
          "deleted",
        ),
      ),
    )
    .limit(1);

  if (!existing) {
    return {
      ok: false,
      status: 404,
      code:
        "RECORD_NOT_FOUND",
      error:
        "Record not found.",
    };
  }

  const actionKey =
    responsibilityActionKey(
      resolved.responsibility.key,
      "delete",
    );

  const workflowInstanceId =
    typeof input.workflowInstanceId ===
      "string" &&
    input.workflowInstanceId.trim()
      ? input.workflowInstanceId.trim()
      : null;

  const authorization =
    await authorizeAction(
      db,
      {
        actorUserId:
          input.userId,
        actionKey,
        workflowInstanceId,
        contextType:
          "responsibility_record",
        contextId:
          existing.id,
      },
    );

  if (!authorization.allowed) {
    return {
      ok: false,
      status:
        authorization.status,
      code:
        authorization.code,
      error:
        authorization.reason ??
        "Workflow action is blocked.",
    };
  }

  await db
    .update(
      dynamicSubmissions,
    )
    .set({
      status:
        "deleted",
      updatedAt:
        new Date(),
      serverVersion:
        sql`${dynamicSubmissions.serverVersion} + 1`,
    })
    .where(
      eq(
        dynamicSubmissions.id,
        existing.id,
      ),
    );

  await recordCompletedWorkflowAction(
    db,
    {
      actionKey,
      subjectUserId:
        input.userId,
      actorUserId:
        input.userId,
      workflowInstanceId:
        authorization.workflowInstanceId ??
        workflowInstanceId,
      contextType:
        "responsibility_record",
      contextId:
        existing.id,
      context: {
        responsibilityId:
          resolved.responsibility.id,
        responsibilityKey:
          resolved.responsibility.key,
        recordId:
          existing.id,
        deleted: true,
      },
      sourceType:
        "responsibility_record",
      sourceId:
        existing.id,
    },
  );

  return {
    ok: true,
    value: {
      deletedId:
        existing.id,
    },
  };
}
