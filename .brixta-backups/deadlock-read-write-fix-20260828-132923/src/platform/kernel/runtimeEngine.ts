import { runPixelLogic } from "../pixelLogic/runtime";
import crypto from "node:crypto";

import {
  and,
  desc,
  eq,
  inArray,
  ne,
  sql,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../../db/db";

import {
  dynamicSubmissions,
  workItems,
} from "../../db/applianceSchema";

import {
  users,
} from "../../db/schema";

import {
  platformAuditEvents,
} from "../../db/platformVNextSchema";

import {
  authorizeAction,
} from "../../services/actionAuthorization";

import {
  getResolvedCapabilitiesForUser,
} from "../../services/capabilityResolver";

import {
  resolveReportingManager,
} from "../../services/reportingResolver";

import {
  recordCompletedWorkflowAction,
} from "../../services/workflowEngine";

import {
  ensureResponsibilityActions,
  getResponsibilityByKey,
  responsibilityActionKey,
} from "../responsibility";

import {
  getPublishedRuntimeManifest,
} from "../vnext/runtimeManifest";

import {
  normalizePixelLogicProgram,
  PIXEL_LOGIC_METADATA_KEY,
  type PixelLogicEffect,
} from "../pixelLogic/types";

import {
  queryRuntimeDataSource,
} from "../vnext/dataSourceRuntime";

import {
  actorCanAct,
  evaluateConditionGroup,
  readPath,
  resolveActorUserIds,
  resolveValueRef,
} from "./evaluator";

import type {
  KernelAction,
  KernelDeviceContext,
  KernelEffect,
  KernelRuntimeWorld,
  ResponsibilityKernel,
} from "./types";

export type KernelRuntimeError = {
  ok: false;
  status: number;
  code: string;
  error: string;
  details?: unknown;
};

export type KernelRuntimeSuccess<T> = {
  ok: true;
  value: T;
};

export type KernelRuntimeResult<T> =
  | KernelRuntimeSuccess<T>
  | KernelRuntimeError;

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayValue(
  value: unknown,
) {
  return Array.isArray(value)
    ? value
    : [];
}


/*
 * BRIXTA_PIXEL_LOGIC_MANIFEST_HELPERS_V2
 *
 * Pixel Logic is published as part of the same immutable
 * Responsibility manifest consumed by the Kernel runtime.
 */
function pixelProgramFromPublishedManifest(
  manifest: Record<string, unknown>,
  fallbackName: string,
) {
  const extension =
    objectValue(
      manifest.extension,
    );

  const metadata =
    objectValue(
      extension.metadata,
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
      fallbackName,
    );

  if (!program.enabled) {
    return null;
  }

  return program;
}

function pixelEffectToKernelEffect(
  effect: PixelLogicEffect,
): KernelEffect {
  const config = {
    ...effect.config,
  };

  if (
    effect.kind === "notify_actor" &&
    config.message === undefined &&
    effect.value !== undefined
  ) {
    config.message =
      String(effect.value);
  }

  return {
    id:
      `pixel:${effect.nodeId}`,
    kind:
      effect.kind,
    targetKey:
      effect.targetKey,
    actorId:
      effect.actorId,
    value:
      effect.value === undefined
        ? undefined
        : {
            kind: "literal",
            value: effect.value,
          },
    config,
  };
}

function initialState(
  kernel: ResponsibilityKernel,
) {
  const state: Record<string, string> = {};

  for (const item of kernel.runtimeWorld.states) {
    if (item.initial && !state[item.dimension]) {
      state[item.dimension] = item.id;
    }
  }

  if (!state.process) {
    const firstProcess = kernel.runtimeWorld.states.find(
      (item) => item.dimension === "process",
    );
    state.process = firstProcess?.id ?? "draft";
  }

  return state;
}

function stateFromRecord(
  kernel: ResponsibilityKernel,
  record: typeof dynamicSubmissions.$inferSelect | null,
) {
  const state = initialState(kernel);

  if (record?.status) {
    state.process = record.status;
  }

  const stored = objectValue(
    objectValue(record?.payload).__state,
  );

  for (const [key, value] of Object.entries(stored)) {
    if (typeof value === "string" && value) {
      state[key] = value;
    }
  }

  return state;
}

async function userSummary(
  db: AppDatabase,
  userId: number,
) {
  const [row] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
      employeeCode: users.salesmanLoginId,
      department: users.department,
      designation: users.designation,
      area: users.area,
      zone: users.zone,
      reportsToId: users.reportsToId,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row ?? null;
}

async function resolveResponsibilityForActor(
  db: AppDatabase,
  userId: number,
  key: string,
  options: {
    allowUnassigned?: boolean;
  } = {},
) {
  const responsibility =
    await getResponsibilityByKey(
      db,
      key,
    );

  if (!responsibility) {
    return {
      ok: false as const,
      status: 404,
      code: "RESPONSIBILITY_NOT_FOUND",
      error: "Responsibility not found or disabled.",
    };
  }

  const assigned =
    await getResolvedCapabilitiesForUser(
      db,
      userId,
    );

  const isAssigned =
    assigned.some(
      (item) =>
        item.id ===
        responsibility.id,
    );

  if (
    !isAssigned &&
    !options.allowUnassigned
  ) {
    return {
      ok: false as const,
      status: 403,
      code: "RESPONSIBILITY_NOT_ASSIGNED",
      error: "This Responsibility is not assigned to the current employee/role.",
    };
  }

  await ensureResponsibilityActions(
    db,
    responsibility,
  );

  const published =
    await getPublishedRuntimeManifest(
      db,
      responsibility.id,
    );

  if (!published?.kernel) {
    return {
      ok: false as const,
      status: 409,
      code: "KERNEL_NOT_PUBLISHED",
      error: "This Responsibility has no published Kernel v3+ runtime world.",
    };
  }

  return {
    ok: true as const,
    responsibility,
    published,
    kernel: published.kernel,
    assigned:
      isAssigned,
  };
}

async function loadRecord(
  db: AppDatabase,
  responsibilityId: number,
  recordId?: string | null,
) {
  if (recordId) {
    const [record] = await db
      .select()
      .from(dynamicSubmissions)
      .where(
        and(
          eq(dynamicSubmissions.id, recordId),
          eq(dynamicSubmissions.capabilityId, responsibilityId),
          ne(dynamicSubmissions.status, "deleted"),
        ),
      )
      .limit(1);

    return record ?? null;
  }

  return null;
}

async function buildWorld(
  db: AppDatabase,
  input: {
    kernel: ResponsibilityKernel;
    actorUserId: number;
    responsibilityId: number;
    responsibilityKey: string;
    record: typeof dynamicSubmissions.$inferSelect | null;
    captures?: Record<string, unknown>;
    device?: KernelDeviceContext;
  },
): Promise<KernelRuntimeWorld> {
  const subjectUserId =
    input.record?.userId ??
    input.actorUserId;

  const [actorUser, subjectUser] = await Promise.all([
    userSummary(db, input.actorUserId),
    userSummary(db, subjectUserId),
  ]);

  const managerResolution =
    await resolveReportingManager(
      db,
      subjectUserId,
    );

  const manager =
    (
      managerResolution.status ===
        "resolved" &&
      managerResolution.managerId
    )
      ? await userSummary(
          db,
          managerResolution.managerId,
        )
      : null;

  const payload =
    objectValue(input.record?.payload);
  const captures = {
    ...payload,
    ...(input.captures ?? {}),
  };
  const history =
    arrayValue(payload.__history);
  const storedContext =
    objectValue(payload.__context);

  const world: KernelRuntimeWorld = {
    actorUserId: input.actorUserId,
    subjectUserId,
    responsibilityId: input.responsibilityId,
    responsibilityKey: input.responsibilityKey,
    recordId: input.record?.id ?? null,
    state:
      stateFromRecord(
        input.kernel,
        input.record,
      ),
    captures,
    context: {
      ...storedContext,
      current_employee: subjectUser,
      current_user: actorUser,
      current_manager: manager,
      current_device: input.device ?? {},
      current_time: new Date().toISOString(),
      record: input.record,
      session: payload.__session ?? null,
      history,
    },
    objects: {
      current_record: input.record,
    },
    actors: {
      current_employee: subjectUser,
      current_user: actorUser,
      current_manager: manager,
      system: { system: true },
    },
    queries: {},
    computed: objectValue(payload.__computed),
    history,
    device: input.device ?? {},
    now: new Date().toISOString(),
  };

  for (const contextDefinition of input.kernel.runtimeWorld.contexts) {
    if (
      Object.prototype.hasOwnProperty.call(
        world.context,
        contextDefinition.id,
      )
    ) {
      continue;
    }

    switch (contextDefinition.source) {
      case "current_user":
        world.context[contextDefinition.id] = subjectUser;
        break;
      case "current_manager":
        world.context[contextDefinition.id] = manager;
        break;
      case "current_device":
        world.context[contextDefinition.id] = input.device ?? {};
        break;
      case "current_time":
        world.context[contextDefinition.id] = world.now;
        break;
      case "record":
        world.context[contextDefinition.id] = input.record;
        break;
      case "history":
        world.context[contextDefinition.id] = history;
        break;
      case "session":
        world.context[contextDefinition.id] = payload.__session ?? null;
        break;
      case "query":
        if (contextDefinition.sourceKey) {
          const result = await queryRuntimeDataSource(
            db,
            {
              key: contextDefinition.sourceKey,
              limit: 50,
            },
          );
          if (result.ok) {
            world.queries[contextDefinition.id] = result.value.rows;
            world.context[contextDefinition.id] = result.value.rows;
          }
        }
        break;
      default:
        world.context[contextDefinition.id] =
          storedContext[contextDefinition.id];
    }
  }

  for (const actor of input.kernel.runtimeWorld.actors) {
    if (world.actors[actor.id] !== undefined) {
      continue;
    }

    const ids = await resolveActorUserIds(
      db,
      input.kernel,
      actor.id,
      world,
    );

    world.actors[actor.id] =
      ids.length === 1
        ? await userSummary(db, ids[0])
        : ids;
  }

  for (const object of input.kernel.runtimeWorld.objects) {
    if (object.id === "current_record") {
      world.objects[object.id] = input.record;
    } else if (object.kind === "employee") {
      world.objects[object.id] = subjectUser;
    } else if (object.kind === "device") {
      world.objects[object.id] = input.device ?? {};
    } else if (object.kind === "session") {
      world.objects[object.id] = payload.__session ?? null;
    } else if (object.sourceKey) {
      world.objects[object.id] =
        captures[object.sourceKey] ??
        world.context[object.sourceKey] ??
        null;
    } else {
      world.objects[object.id] = null;
    }
  }

  return world;
}

const DEFAULT_DECISION_KINDS =
  new Set([
    "approve",
    "reject",
    "return",
    "acknowledge",
    "sign",
    "complete",
    "cancel",
  ]);

function isDecisionActionKind(
  kind: string,
) {
  return DEFAULT_DECISION_KINDS.has(
    kind,
  );
}

function actionAvailableInState(
  action: KernelAction,
  world: KernelRuntimeWorld,
) {
  const currentStates =
    Object.values(
      world.state,
    );

  const availableState =
    String(
      action.config
        .availableState ??
      "",
    ).trim();

  if (
    availableState &&
    !currentStates.includes(
      availableState,
    )
  ) {
    return false;
  }

  const rawStates =
    action.config
      .availableStates;

  if (
    Array.isArray(
      rawStates,
    )
  ) {
    const allowed =
      rawStates
        .map(String)
        .filter(Boolean);

    if (
      allowed.length &&
      !allowed.some(
        (state) =>
          currentStates.includes(
            state,
          ),
      )
    ) {
      return false;
    }
  }

  return true;
}

/*
 * AUTHORITY PRECEDENCE
 *
 * 1. Explicit actorId authored by Pixel Reality / Kernel:
 *      use it.
 *
 * 2. Decision-class action with NO actor:
 *      use the record owner's Employee default reporting policy.
 *
 * 3. Non-decision actorless action:
 *      preserve existing behavior.
 */
async function actionActorCanAct(
  db: AppDatabase,
  kernel: ResponsibilityKernel,
  action: KernelAction,
  world: KernelRuntimeWorld,
) {
  if (action.actorId) {
    return actorCanAct(
      db,
      kernel,
      action.actorId,
      world,
    );
  }

  if (
    !isDecisionActionKind(
      action.kind,
    )
  ) {
    return true;
  }

  const reporting =
    await resolveReportingManager(
      db,
      world.subjectUserId,
    );

  return (
    reporting.status ===
      "resolved" &&
    reporting.managerId ===
      world.actorUserId
  );
}

async function availablePossibilities(
  db: AppDatabase,
  kernel: ResponsibilityKernel,
  world: KernelRuntimeWorld,
) {
  const captures = [];
  const actions = [];
  const outputs = [];

  for (const possibility of kernel.possibilities) {
    if (
      !evaluateConditionGroup(
        world,
        possibility.when,
      )
    ) {
      continue;
    }

    if (possibility.type === "capture") {
      captures.push(possibility.capture);
      continue;
    }

    if (possibility.type === "action") {
      if (
        !evaluateConditionGroup(
          world,
          possibility.action.requires,
        )
      ) {
        continue;
      }

      if (
        actionAvailableInState(
          possibility.action,
          world,
        ) &&
        await actionActorCanAct(
          db,
          kernel,
          possibility.action,
          world,
        )
      ) {
        actions.push(
          possibility.action,
        );
      }
      continue;
    }

    const actorAllowed =
      possibility.output.actorIds.length === 0 ||
      (
        await Promise.all(
          possibility.output.actorIds.map((actorId) =>
            actorCanAct(
              db,
              kernel,
              actorId,
              world,
            ),
          ),
        )
      ).some(Boolean);

    const stateAllowed =
      possibility.output.stateIds.length === 0 ||
      possibility.output.stateIds.some((stateId) =>
        Object.values(world.state).includes(stateId),
      );

    if (actorAllowed && stateAllowed) {
      outputs.push(possibility.output);
    }
  }

  return {
    captures,
    actions,
    outputs,
  };
}

export async function getKernelRuntime(
  db: AppDatabase,
  input: {
    userId: number;
    responsibilityKey: string;
    recordId?: string | null;
    device?: KernelDeviceContext;
  },
): Promise<KernelRuntimeResult<Record<string, unknown>>> {
  const resolved =
    await resolveResponsibilityForActor(
      db,
      input.userId,
      input.responsibilityKey,
      {
        allowUnassigned:
          Boolean(
            input.recordId,
          ),
      },
    );

  if (!resolved.ok) return resolved;

  const record = await loadRecord(
    db,
    resolved.responsibility.id,
    input.recordId,
  );

  if (input.recordId && !record) {
    return {
      ok: false,
      status: 404,
      code: "RECORD_NOT_FOUND",
      error: "Responsibility record not found.",
    };
  }

  const world = await buildWorld(
    db,
    {
      kernel: resolved.kernel,
      actorUserId: input.userId,
      responsibilityId: resolved.responsibility.id,
      responsibilityKey: resolved.responsibility.key,
      record,
      device: input.device,
    },
  );

  const possibilities = await availablePossibilities(
    db,
    resolved.kernel,
    world,
  );

  const hasExplicitActorOutput =
    possibilities.outputs.some(
      (output) =>
        Array.isArray(
          output.actorIds,
        ) &&
        output.actorIds.length > 0,
    );

  if (
    record &&
    record.userId !==
      input.userId &&
    possibilities.actions.length ===
      0 &&
    (
      resolved.assigned
        ? possibilities.outputs.length ===
          0
        : !hasExplicitActorOutput
    )
  ) {
    return {
      ok: false,
      status: 403,
      code: "KERNEL_RECORD_NOT_VISIBLE",
      error: "This record has no actor-projected action/output available to the current user.",
    };
  }

  return {
    ok: true,
    value: {
      responsibility: {
        id: resolved.responsibility.id,
        key: resolved.responsibility.key,
        title: resolved.responsibility.title,
      },
      manifest: {
        version: resolved.published.version,
        hash: resolved.published.manifestHash,
        source: resolved.published.source,
      },
      kernelVersion: resolved.kernel.kernelVersion,
      world,
      possibilities,
      record,
    },
  };
}

function crudOperationForAction(
  actionKind: string,
  hasRecord: boolean,
): "create" | "read" | "update" | "delete" {
  if (actionKind === "read") return "read";
  if (actionKind === "delete") return "delete";
  if (!hasRecord) return "create";
  return "update";
}

function requiredCaptureErrors(
  kernel: ResponsibilityKernel,
  captureIds: string[],
  captures: Record<string, unknown>,
) {
  const errors: string[] = [];

  for (const captureId of captureIds) {
    const possibility = kernel.possibilities.find(
      (item) =>
        item.type === "capture" &&
        item.capture.id === captureId,
    );

    if (!possibility || possibility.type !== "capture") {
      continue;
    }

    if (!possibility.capture.required) {
      continue;
    }

    const key =
      possibility.capture.storeAs ??
      possibility.capture.id;
    const value = captures[key] ?? captures[captureId];

    if (
      value === null ||
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    ) {
      errors.push(`${possibility.capture.label} is required.`);
    }
  }

  return errors;
}

async function applyEffect(
  db: AppDatabase,
  input: {
    effect: KernelEffect;
    kernel: ResponsibilityKernel;
    world: KernelRuntimeWorld;
    payload: Record<string, unknown>;
    state: Record<string, string>;
    responsibilityId: number;
    responsibilityKey: string;
    recordId: string | null;
  },
) {
  const effect = input.effect;
  const result: Record<string, unknown> = {
    id: effect.id,
    kind: effect.kind,
  };

  switch (effect.kind) {
    case "change_state": {
      const dimension = effect.targetKey || "process";
      const next = resolveValueRef(input.world, effect.value) ??
        effect.config.stateId ??
        effect.config.value;

      if (typeof next === "string" && next) {
        input.state[dimension] = next;
        result.state = { dimension, value: next };
      }
      break;
    }

    case "set_context": {
      const key = effect.targetKey || String(effect.config.key ?? "");
      if (key) {
        const context = objectValue(input.payload.__context);
        const value = resolveValueRef(input.world, effect.value) ?? effect.config.value;
        context[key] = value;
        input.payload.__context = context;
        input.world.context[key] = value;
        result.contextKey = key;
      }
      break;
    }

    case "remove_context": {
      const key = effect.targetKey || String(effect.config.key ?? "");
      if (key) {
        const context = objectValue(input.payload.__context);
        delete context[key];
        delete input.world.context[key];
        input.payload.__context = context;
        result.contextKey = key;
      }
      break;
    }

    case "set_computed": {
      const key = effect.targetKey || String(effect.config.key ?? "");
      if (key) {
        const value = resolveValueRef(input.world, effect.value) ?? effect.config.value;
        const computed = objectValue(input.payload.__computed);
        computed[key] = value;
        input.payload.__computed = computed;
        input.world.computed[key] = value;
        input.payload[key] = value;
        result.computedKey = key;
      }
      break;
    }

    case "append_history": {
      const history = arrayValue(input.payload.__history);
      const entry = {
        at: new Date().toISOString(),
        actorUserId: input.world.actorUserId,
        action:
          String(effect.config.action ?? ""),
        label:
          String(effect.config.label ?? "Activity"),
        metadata:
          objectValue(effect.config.metadata),
      };
      input.payload.__history = [...history, entry];
      input.world.history = [...input.world.history, entry];
      result.entry = entry;
      break;
    }

    case "assign_actor": {
      if (!effect.actorId) break;
      const userIds = await resolveActorUserIds(
        db,
        input.kernel,
        effect.actorId,
        input.world,
      );
      const assignments = objectValue(input.payload.__assignments);
      assignments[effect.actorId] = userIds;
      input.payload.__assignments = assignments;

      for (const userId of userIds.slice(0, 20)) {
        await db.insert(workItems).values({
          capabilityId: input.responsibilityId,
          assigneeUserId: userId,
          createdByUserId: input.world.actorUserId,
          title:
            String(effect.config.title ?? `Action required: ${input.responsibilityKey}`),
          description:
            String(effect.config.description ?? "") || null,
          status: "assigned",
          payload: {
            kind: "kernel_assignment",
            responsibilityKey: input.responsibilityKey,
            recordId: input.recordId,
            actorId: effect.actorId,
          },
        });
      }
      result.userIds = userIds;
      break;
    }

    case "notify_actor": {
      if (!effect.actorId) break;
      const userIds = await resolveActorUserIds(
        db,
        input.kernel,
        effect.actorId,
        input.world,
      );

      for (const userId of userIds.slice(0, 20)) {
        await db.insert(workItems).values({
          capabilityId: input.responsibilityId,
          assigneeUserId: userId,
          createdByUserId: input.world.actorUserId,
          title:
            String(effect.config.title ?? effect.config.message ?? "New notification"),
          description:
            String(effect.config.body ?? "") || null,
          status: "assigned",
          payload: {
            kind: "kernel_notification",
            responsibilityKey: input.responsibilityKey,
            recordId: input.recordId,
            actorId: effect.actorId,
            channel: effect.config.channel ?? "app_inbox",
          },
        });
      }

      result.userIds = userIds;
      result.channel = effect.config.channel ?? "app_inbox";

      // BRIXTA_NOTIFY_ACTOR_MESSAGE_V1
      result.message = String(
        effect.config.message ??
        effect.config.title ??
        "New notification",
      );

      break;
    }

    case "query_data": {
      const sourceKey = String(
        effect.config.sourceKey ??
        effect.targetKey ??
        "",
      );
      if (sourceKey) {
        const query = await queryRuntimeDataSource(
          db,
          {
            key: sourceKey,
            q: String(effect.config.q ?? ""),
            limit: Number(effect.config.limit) || 50,
            filters: Array.isArray(effect.config.filters)
              ? effect.config.filters as Array<{
                  field: string;
                  operator?: string;
                  value?: unknown;
                }>
              : [],
          },
        );

        if (query.ok) {
          const key = effect.targetKey || sourceKey;
          input.world.queries[key] = query.value.rows;
          const context = objectValue(input.payload.__context);
          context[key] = query.value.rows;
          input.payload.__context = context;
          result.rows = query.value.rows.length;
        } else {
          result.error = query.error;
        }
      }
      break;
    }

    case "freeze_data": {
      const frozen = new Set(
        arrayValue(input.payload.__frozen).map(String),
      );
      if (effect.targetKey) frozen.add(effect.targetKey);
      for (const key of arrayValue(effect.config.keys).map(String)) {
        frozen.add(key);
      }
      input.payload.__frozen = [...frozen];
      result.keys = [...frozen];
      break;
    }

    case "update_record": {
      const patch = objectValue(
        resolveValueRef(input.world, effect.value) ??
        effect.config.payload,
      );
      Object.assign(input.payload, patch);
      result.updatedKeys = Object.keys(patch);
      break;
    }

    case "delete_record":
      input.state.process = "deleted";
      result.deleted = true;
      break;

    case "create_record": {
      const responsibilityKey = String(
        effect.config.responsibilityKey ??
        effect.targetKey ??
        "",
      );
      if (!responsibilityKey) break;
      const target = await getResponsibilityByKey(db, responsibilityKey);
      if (!target) {
        result.error = "Target Responsibility not found.";
        break;
      }
      const payload = objectValue(
        resolveValueRef(input.world, effect.value) ??
        effect.config.payload,
      );
      const [created] = await db
        .insert(dynamicSubmissions)
        .values({
          clientMutationId: crypto.randomUUID(),
          userId: input.world.subjectUserId,
          capabilityId: target.id,
          status: String(effect.config.status ?? "submitted"),
          payload,
        })
        .returning({ id: dynamicSubmissions.id });
      result.createdRecordId = created?.id ?? null;
      break;
    }

    case "trigger_responsibility": {
      const responsibilityKey = String(
        effect.config.responsibilityKey ??
        effect.targetKey ??
        "",
      );
      const target = responsibilityKey
        ? await getResponsibilityByKey(db, responsibilityKey)
        : null;
      if (!target) {
        result.error = "Target Responsibility not found.";
        break;
      }

      const userIds = effect.actorId
        ? await resolveActorUserIds(
            db,
            input.kernel,
            effect.actorId,
            input.world,
          )
        : [input.world.subjectUserId];

      for (const userId of userIds.slice(0, 20)) {
        await db.insert(workItems).values({
          capabilityId: target.id,
          assigneeUserId: userId,
          createdByUserId: input.world.actorUserId,
          title: String(effect.config.title ?? target.title),
          description: String(effect.config.description ?? "") || null,
          status: "assigned",
          payload: {
            kind: "kernel_trigger",
            sourceResponsibilityKey: input.responsibilityKey,
            sourceRecordId: input.recordId,
            responsibilityKey,
          },
        });
      }
      result.userIds = userIds;
      result.responsibilityKey = responsibilityKey;
      break;
    }

    case "trigger_action":
      // Triggering arbitrary actions recursively can create cycles. The
      // backend emits a deterministic trigger instruction instead; the app or
      // a future queue worker can execute it with the same authorization path.
      result.trigger = {
        actionId: effect.config.actionId ?? effect.targetKey ?? null,
        responsibilityKey:
          effect.config.responsibilityKey ?? input.responsibilityKey,
      };
      break;

    default:
      result.skipped = true;
      result.reason = "Effect adapter not implemented; definition preserved.";
  }

  return result;
}

export async function executeKernelAction(
  db: AppDatabase,
  input: {
    userId: number;
    responsibilityKey: string;
    actionId: string;
    recordId?: string | null;
    payload?: unknown;
    clientMutationId?: string | null;
    clientCreatedAt?: string | null;
    workflowInstanceId?: string | null;
    device?: KernelDeviceContext;
  },
): Promise<KernelRuntimeResult<Record<string, unknown>>> {
  const resolved = await resolveResponsibilityForActor(
    db,
    input.userId,
    input.responsibilityKey,
    {
      allowUnassigned:
        Boolean(
          input.recordId,
        ),
    },
  );

  if (!resolved.ok) return resolved;

  let record = await loadRecord(
    db,
    resolved.responsibility.id,
    input.recordId,
  );

  if (input.recordId && !record) {
    return {
      ok: false,
      status: 404,
      code: "RECORD_NOT_FOUND",
      error: "Responsibility record not found.",
    };
  }

  const possibility = resolved.kernel.possibilities.find(
    (item) =>
      item.type === "action" &&
      item.action.id === input.actionId,
  );

  if (!possibility || possibility.type !== "action") {
    return {
      ok: false,
      status: 404,
      code: "KERNEL_ACTION_NOT_FOUND",
      error: "Published Responsibility does not define this action.",
    };
  }

  const submittedPayload = objectValue(input.payload);
  const world = await buildWorld(
    db,
    {
      kernel: resolved.kernel,
      actorUserId: input.userId,
      responsibilityId: resolved.responsibility.id,
      responsibilityKey: resolved.responsibility.key,
      record,
      captures: submittedPayload,
      device: input.device,
    },
  );

  if (
    !evaluateConditionGroup(
      world,
      possibility.when,
    ) ||
    !evaluateConditionGroup(
      world,
      possibility.action.requires,
    ) ||
    !actionAvailableInState(
      possibility.action,
      world,
    ) ||
    !(
      await actionActorCanAct(
        db,
        resolved.kernel,
        possibility.action,
        world,
      )
    )
  ) {
    return {
      ok: false,
      status: 409,
      code: "KERNEL_ACTION_NOT_AVAILABLE",
      error: "This action is not possible for the current actor/world/state.",
    };
  }

  const captureErrors = requiredCaptureErrors(
    resolved.kernel,
    possibility.action.captureIds,
    world.captures,
  );

  if (captureErrors.length) {
    return {
      ok: false,
      status: 400,
      code: "KERNEL_CAPTURE_VALIDATION_FAILED",
      error: "Required action captures are missing.",
      details: captureErrors,
    };
  }

  const crudOperation = crudOperationForAction(
    possibility.action.kind,
    Boolean(record),
  );
  const actionKey = responsibilityActionKey(
    resolved.responsibility.key,
    crudOperation,
  );

  const authorization = await authorizeAction(
    db,
    {
      actorUserId: input.userId,
      subjectUserId: world.subjectUserId,
      actionKey,
      workflowInstanceId: input.workflowInstanceId,
      contextType: record ? "responsibility_record" : null,
      contextId: record?.id ?? null,
      allowCompleted:
        crudOperation ===
        "read",

      /*
       * Kernel actor resolution above has already proven this user
       * may perform THIS action on THIS concrete record.
       */
      allowDynamicParticipation:
        resolved.assigned ===
          false &&
        Boolean(record),
    },
  );

  if (!authorization.allowed) {
    return {
      ok: false,
      status: authorization.status,
      code: authorization.code,
      error: authorization.reason ?? "Workflow blocks this action.",
    };
  }

  if (crudOperation === "read") {
    return getKernelRuntime(
      db,
      {
        userId: input.userId,
        responsibilityKey: input.responsibilityKey,
        recordId: record?.id ?? null,
        device: input.device,
      },
    );
  }

  const nextPayload = {
    ...objectValue(record?.payload),
    ...submittedPayload,
  };
  const nextState = {
    ...world.state,
  };

  const events = resolved.kernel.events.filter(
    (event) =>
      event.actionId === possibility.action.id ||
      (
        !event.actionId &&
        event.kind === "action" &&
        event.sourceKey === possibility.action.id
      ),
  );

  const eventIds = new Set(
    events.map((event) => event.id),
  );

  const rules = resolved.kernel.rules
    .filter((rule) =>
      rule.enabled &&
      (
        !rule.eventId ||
        eventIds.has(rule.eventId)
      ) &&
      evaluateConditionGroup(world, rule.when),
    )
    .sort((a, b) => a.priority - b.priority);

  const appliedEffects: Record<string, unknown>[] = [];
  const deferredEffects: Array<{
    ruleId: string;
    ruleLabel: string;
    effect: KernelEffect;
  }> = [];
  const deferredKinds = new Set([
    "assign_actor",
    "notify_actor",
    "trigger_responsibility",
    "create_record",
    "trigger_action",
  ]);

  for (const rule of rules) {
    for (const effect of rule.effects) {
      if (deferredKinds.has(effect.kind)) {
        deferredEffects.push({
          ruleId: rule.id,
          ruleLabel: rule.label,
          effect,
        });
        continue;
      }

      const applied = await applyEffect(
        db,
        {
          effect,
          kernel: resolved.kernel,
          world,
          payload: nextPayload,
          state: nextState,
          responsibilityId: resolved.responsibility.id,
          responsibilityKey: resolved.responsibility.key,
          recordId: record?.id ?? null,
        },
      );
      appliedEffects.push({
        ruleId: rule.id,
        ruleLabel: rule.label,
        ...applied,
      });
    }
  }

  nextPayload.__state = nextState;

  if (crudOperation === "delete") {
    if (!record) {
      return {
        ok: false,
        status: 404,
        code: "RECORD_NOT_FOUND",
        error: "Delete action requires an existing record.",
      };
    }

    const [updated] = await db
      .update(dynamicSubmissions)
      .set({
        status: "deleted",
        payload: nextPayload,
        serverVersion: sql`${dynamicSubmissions.serverVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(dynamicSubmissions.id, record.id))
      .returning();
    record = updated;
  } else if (record) {
    const [updated] = await db
      .update(dynamicSubmissions)
      .set({
        status: nextState.process ?? record.status,
        payload: nextPayload,
        serverVersion: sql`${dynamicSubmissions.serverVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(dynamicSubmissions.id, record.id))
      .returning();
    record = updated;
  } else {
    const mutationId =
      input.clientMutationId &&
      /^[0-9a-f-]{36}$/i.test(input.clientMutationId)
        ? input.clientMutationId
        : crypto.randomUUID();

    const [existing] = await db
      .select()
      .from(dynamicSubmissions)
      .where(
        and(
          eq(dynamicSubmissions.clientMutationId, mutationId),
          eq(dynamicSubmissions.capabilityId, resolved.responsibility.id),
          eq(dynamicSubmissions.userId, world.subjectUserId),
        ),
      )
      .limit(1);

    if (existing) {
      record = existing;
    } else {
      const [created] = await db
        .insert(dynamicSubmissions)
        .values({
          clientMutationId: mutationId,
          userId: world.subjectUserId,
          capabilityId: resolved.responsibility.id,
          status: nextState.process ?? "submitted",
          payload: nextPayload,
          clientCreatedAt:
            input.clientCreatedAt
              ? new Date(input.clientCreatedAt)
              : null,
        })
        .returning();
      record = created;
    }
  }

  if (!record) {
    return {
      ok: false,
      status: 500,
      code: "KERNEL_RECORD_PERSIST_FAILED",
      error: "Kernel action completed but its record was not persisted.",
    };
  }

  world.recordId = record.id;
  world.objects.current_record = record;
  world.context.record = record;

  /*
   * BRIXTA_PIXEL_LOGIC_MANIFEST_RUNTIME_V2
   *
   * CANONICAL EXECUTION:
   *
   * Responsibility Action
   *        ↓
   * executeKernelAction()
   *        ↓
   * Published Manifest
   *        ↓
   * Pixel Logic graph
   *        ↓
   * Pixel effects
   *        ↓
   * existing Kernel applyEffect()
   */
  const pixelProgram =
    pixelProgramFromPublishedManifest(
      resolved.published.manifest,
      `${resolved.responsibility.title} Logic`,
    );

  if (pixelProgram) {
    const variableValues =
      Object.fromEntries(
        pixelProgram.variables.map(
          (variable) => [
            variable.key,
            variable.initialValue,
          ],
        ),
      );

    const pixelResult =
      runPixelLogic(
        pixelProgram,
        {
          event: {
            name:
              "responsibility.action",

            actionId:
              possibility.action.id,

            at:
              new Date().toISOString(),

            payload: {
              record,

              captures:
                submittedPayload,

              responsibilityId:
                resolved.responsibility.id,

              responsibilityKey:
                resolved.responsibility.key,

              actionId:
                possibility.action.id,
            },
          },

          values: {
            context:
              world.context,

            capture:
              world.captures,

            actor:
              world.actors,

            state:
              nextState,

            history: {
              entries:
                world.history,
            },

            computed:
              world.computed,

            query:
              world.queries,

            object:
              world.objects,

            variable:
              variableValues,
          },
        },
      );

    for (
      const pixelEffect
      of pixelResult.effects
    ) {
      const kernelEffect =
        pixelEffectToKernelEffect(
          pixelEffect,
        );

      const applied =
        await applyEffect(
          db,
          {
            effect:
              kernelEffect,

            kernel:
              resolved.kernel,

            world,

            payload:
              nextPayload,

            state:
              nextState,

            responsibilityId:
              resolved.responsibility.id,

            responsibilityKey:
              resolved.responsibility.key,

            recordId:
              record.id,
          },
        );

      appliedEffects.push({
        source:
          "pixel_logic",

        program:
          pixelProgram.name,

        nodeId:
          pixelEffect.nodeId,

        ...applied,
      });
    }

    await db
      .insert(
        platformAuditEvents,
      )
      .values({
        actorUserId:
          input.userId,

        eventType:
          "responsibility.pixel_logic",

        subjectType:
          "responsibility_record",

        subjectId:
          record.id,

        payload: {
          responsibilityId:
            resolved.responsibility.id,

          responsibilityKey:
            resolved.responsibility.key,

          actionId:
            possibility.action.id,

          program:
            pixelProgram.name,

          matched:
            pixelResult.matched,

          effects:
            pixelResult.effects.map(
              (effect) => ({
                nodeId:
                  effect.nodeId,

                kind:
                  effect.kind,
              }),
            ),

          trace:
            pixelResult.trace,
        },
      });
  }

  for (const deferred of deferredEffects) {
    const applied = await applyEffect(
      db,
      {
        effect: deferred.effect,
        kernel: resolved.kernel,
        world,
        payload: nextPayload,
        state: nextState,
        responsibilityId: resolved.responsibility.id,
        responsibilityKey: resolved.responsibility.key,
        recordId: record.id,
      },
    );
    appliedEffects.push({
      ruleId: deferred.ruleId,
      ruleLabel: deferred.ruleLabel,
      ...applied,
    });
  }

  // Deferred effects can add assignments/notification metadata after the
  // first insert, so persist the final payload once more without changing the
  // already-decided process state.
  const [finalRecord] = await db
    .update(dynamicSubmissions)
    .set({
      payload: nextPayload,
      status: nextState.process ?? record.status,
      updatedAt: new Date(),
    })
    .where(eq(dynamicSubmissions.id, record.id))
    .returning();

  record = finalRecord ?? record;

  const transition = await recordCompletedWorkflowAction(
    db,
    {
      actionKey,
      subjectUserId: world.subjectUserId,
      actorUserId: input.userId,
      workflowInstanceId:
        authorization.workflowInstanceId ??
        input.workflowInstanceId ??
        null,
      contextType: "responsibility_record",
      contextId: record.id,
      context: {
        responsibilityId: resolved.responsibility.id,
        responsibilityKey: resolved.responsibility.key,
        recordId: record.id,
        kernelActionId: possibility.action.id,
        kernelActionKind: possibility.action.kind,
      },
      sourceType: "kernel_action",
      sourceId: record.id,
    },
  );

  await db.insert(platformAuditEvents).values({
    actorUserId: input.userId,
    eventType: "responsibility.kernel_action",
    subjectType: "responsibility_record",
    subjectId: record.id,
    payload: {
      responsibilityKey: resolved.responsibility.key,
      actionId: possibility.action.id,
      actionKind: possibility.action.kind,
      manifestVersion: resolved.published.version,
      manifestHash: resolved.published.manifestHash,
      effects: appliedEffects,
    },
  });

  const refreshed = await getKernelRuntime(
    db,
    {
      userId: input.userId,
      responsibilityKey: input.responsibilityKey,
      recordId: record.id,
      device: input.device,
    },
  );

  return {
    ok: true,
    value: {
      record,
      eventIds: [...eventIds],
      effects: appliedEffects,
      workflowInstanceIds:
        transition.startedWorkflowInstanceIds.length
          ? transition.startedWorkflowInstanceIds
          : authorization.workflowInstanceId
            ? [authorization.workflowInstanceId]
            : [],
      runtime:
        refreshed.ok
          ? refreshed.value
          : null,
    },
  };
}
