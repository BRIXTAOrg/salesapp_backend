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

  const payload =
    objectValue(input.payload);

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
        workflowInstanceIds:
          authorization.workflowInstanceId
            ? [
                authorization.workflowInstanceId,
              ]
            : [],
      },
    };
  }

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
        typeof input.status ===
          "string" &&
        input.status.trim()
          ? input.status.trim()
          : "submitted",
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

  const [record] = await db
    .update(
      dynamicSubmissions,
    )
    .set({
      payload:
        mergedPayload,
      status:
        typeof input.status ===
          "string" &&
        input.status.trim()
          ? input.status.trim()
          : existing.status,
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
