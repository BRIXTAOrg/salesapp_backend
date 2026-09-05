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
  enqueueServiceRequest,
} from "../integrations/serviceRuntime";

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

import {
  evaluatePolicyExpressionBoolean,
} from "./policyExpression";

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

  /*
   * IMPORTANT:
   * Runtime resolution is a READ path.
   *
   * CRUD action definitions are synchronized when a Responsibility
   * is created/updated/published. Performing UPSERTs here causes
   * concurrent runtime/Admin GET requests to deadlock on
   * action_definitions.
   */
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

  /*
   * BRIXTA_KERNEL_USER_DEDUP_V1
   *
   * Normal employee runtime has actor === subject. Do not SELECT the same
   * employee twice.
   */
  const actorUser =
    await userSummary(
      db,
      input.actorUserId,
    );

  const subjectUser =
    subjectUserId ===
    input.actorUserId
      ? actorUser
      : await userSummary(
          db,
          subjectUserId,
        );

  const managerResolution =
    await resolveReportingManager(
      db,
      subjectUserId,
      undefined,
      {
        preloadedSubject:
          subjectUser
            ? {
                id:
                  subjectUser.id,
                department:
                  subjectUser.department,
                area:
                  subjectUser.area,
                zone:
                  subjectUser.zone,
                reportsToId:
                  subjectUser.reportsToId,
              }
            : null,
      },
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
 * BRIXTA_KERNEL_PROJECTED_ACTOR_AUTH_V1
 *
 * buildWorld() has already resolved every authored actor server-side and
 * stored the result in world.actors. Re-querying roles/participants/
 * reporting policy for every button and output is redundant.
 *
 * This helper does NOT trust the client. It only reads the server-built
 * runtime world created immediately above this availability calculation.
 */
function projectedActorAllowsUser(
  value: unknown,
  userId: number,
) {
  if (
    Array.isArray(
      value,
    )
  ) {
    return value.some(
      (item) => {
        if (
          Number(item) ===
          userId
        ) {
          return true;
        }

        const raw =
          objectValue(
            item,
          );

        return (
          Number(
            raw.id ??
            raw.userId,
          ) ===
          userId
        );
      },
    );
  }

  const raw =
    objectValue(
      value,
    );

  return (
    Number(
      raw.id ??
      raw.userId,
    ) ===
    userId
  );
}

function projectedActionActorCanAct(
  action: KernelAction,
  world: KernelRuntimeWorld,
) {
  if (action.actorId) {
    return projectedActorAllowsUser(
      world.actors[
        action.actorId
      ],
      world.actorUserId,
    );
  }

  if (
    !isDecisionActionKind(
      action.kind,
    )
  ) {
    return true;
  }

  return projectedActorAllowsUser(
    world.actors
      .current_manager,
    world.actorUserId,
  );
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
        ) ||
        !actionAvailableInState(
          possibility.action,
          world,
        )
      ) {
        continue;
      }

      /*
       * SERVER-AUTHORITATIVE AVAILABILITY.
       *
       * Pure state/condition checks above run first so an unavailable state
       * never pays for a database-backed business guard.
       */
      const availabilityGuardFailure =
        await enforceSubmissionGuards(
          db,
          {
            action:
              possibility.action,

            responsibilityId:
              world.responsibilityId,

            subjectUserId:
              world.subjectUserId,

            recordId:
              world.recordId,

            captures:
              world.captures,

            world,

            phase:
              "availability",
          },
        );

      if (
        availabilityGuardFailure
      ) {
        continue;
      }

      if (
        projectedActionActorCanAct(
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
      possibility.output.actorIds.some(
        (actorId) =>
          projectedActorAllowsUser(
            world.actors[
              actorId
            ],
            world.actorUserId,
          ),
      );

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

    /*
     * BRIXTA_PRESENTATION_EFFECT_BUS_V2
     *
     * These effects intentionally do NOT mutate business payload/state.
     * They are returned to the requesting client as transient presentation
     * instructions.
     */
    case "ui_animate": {
      const targetBlockId =
        String(
          effect.config.targetBlockId ??
          effect.targetKey ??
          "",
        );

      if (!targetBlockId) {
        result.error =
          "ui_animate requires targetBlockId.";
        break;
      }

      result.targetBlockId =
        targetBlockId;

      result.preset =
        String(
          effect.config.preset ??
          "pulse",
        );

      result.durationMs =
        Math.max(
          50,
          Math.min(
            10_000,
            Number(
              effect.config.durationMs,
            ) || 400,
          ),
        );

      break;
    }

    case "ui_show":
    case "ui_hide":
    case "ui_play": {
      const targetBlockId =
        String(
          effect.config.targetBlockId ??
          effect.targetKey ??
          "",
        );

      if (!targetBlockId) {
        result.error =
          `${effect.kind} requires targetBlockId.`;
        break;
      }

      result.targetBlockId =
        targetBlockId;

      break;
    }

    case "haptic": {
      result.preset =
        String(
          effect.config.preset ??
          "light",
        );

      break;
    }

    case "device_sound": {
      const allowed = new Set([
        "action",
        "notice",
        "decision",
        "select",
        "success",
      ]);
      const requested = String(effect.config.preset ?? "notice");
      result.preset = allowed.has(requested) ? requested : "notice";
      result.volume = Math.max(0, Math.min(1, Number(effect.config.volume) || 1));
      result.deliveryScope = "current_action_response_device";
      break;
    }

    case "device_ring": {
      const requested = String(effect.config.preset ?? "decision");
      result.preset = requested === "notice" ? "notice" : "decision";
      result.durationMs = Math.max(250, Math.min(8_000, Number(effect.config.durationMs) || 3_000));
      result.vibrate = effect.config.vibrate !== false;
      result.deliveryScope = "current_action_response_device";
      break;
    }

    case "device_notification": {
      const sound = String(effect.config.sound ?? "none");
      const allowedSound = new Set(["none", "notice", "decision", "success"]);
      result.title = String(effect.config.title ?? "BRIXTA").slice(0, 120);
      result.body = String(effect.config.body ?? effect.config.message ?? "").slice(0, 500);
      result.sound = allowedSound.has(sound) ? sound : "none";
      result.vibrate = effect.config.vibrate === true;
      result.deliveryScope = "current_action_response_device";
      result.backgroundPush = false;
      break;
    }

    /*
     * BRIXTA_SERVICE_EXECUTION_EFFECT_V1
     *
     * Pixel decides WHEN a service should run.
     *
     * Integration Runtime decides HOW the provider is called.
     *
     * Provider HTTP is deliberately asynchronous relative to
     * this business transaction.
     */
    case "service_execute": {
      const capability =
        String(
          effect.config.capability ??
          effect.targetKey ??
          "",
        ).trim();

      if (
        !capability
      ) {
        result.error =
          "service_execute requires a capability.";

        break;
      }

      const resolved =
        resolveValueRef(
          input.world,
          effect.value,
        );

      const rawRequest =
        resolved ??
        effect.config.input ??
        {};

      const request =
        rawRequest &&
        typeof rawRequest ===
          "object" &&
        !Array.isArray(
          rawRequest,
        )
          ? rawRequest as
              Record<string, unknown>
          : {
              value:
                rawRequest,
            };

      const authoredIdempotency =
        String(
          request.idempotencyKey ??
          effect.config.idempotencyKey ??
          "",
        ).trim();

      const idempotencyKey =
        (
          authoredIdempotency ||
          [
            "pixel",
            input.responsibilityId,
            input.recordId ??
              "new",
            effect.id,
          ].join(":")
        ).slice(
          0,
          220,
        );

      const queued =
        await enqueueServiceRequest(
          db,
          {
            capability,

            request,

            idempotencyKey,

            source: {
              type:
                "pixel_logic",

              responsibilityId:
                input.responsibilityId,

              responsibilityKey:
                input.responsibilityKey,

              recordId:
                input.recordId,

              pixelEffectId:
                effect.id,
            },
          },
        );

      result.capability =
        capability;

      result.serviceRequest =
        queued;

      const resultKey =
        String(
          effect.config.resultKey ??
          "",
        ).trim();

      if (
        resultKey
      ) {
        const computed =
          objectValue(
            input.payload
              .__computed,
          );

        computed[
          resultKey
        ] =
          queued;

        input.payload
          .__computed =
          computed;

        input.world
          .computed[
          resultKey
        ] =
          queued;

        result.computedKey =
          resultKey;
      }

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


/*
 * BRIXTA_SUBMISSION_GUARDS_V1
 *
 * Generic pre-action business invariants authored through
 * Responsibility / Pixel Reality action.config.
 *
 * Guards execute SERVER-SIDE before any state transition/effect/record
 * mutation. Flutter is therefore not the authority for these rules.
 *
 * Supported v1 guard:
 *
 *   {
 *     kind: "date_range_no_overlap",
 *     scope: "current_employee",
 *     fromField: "from_date",
 *     toField: "to_date",
 *     ignoreCurrentRecord: true,
 *     conflictStatuses: ["pending_manager", "approved", "returned"],
 *     message: "..."
 *   }
 *
 * This is generic. Nothing here knows what "Leave" means.
 */

function submissionGuardDate(
  value: unknown,
) {
  const raw =
    String(
      value ?? "",
    ).trim();

  if (!raw) {
    return null;
  }

  /*
   * Date captures are normally YYYY-MM-DD. Interpret those explicitly as
   * UTC calendar days so server timezone cannot shift the comparison.
   */
  const normalized =
    /^\d{4}-\d{2}-\d{2}$/.test(
      raw,
    )
      ? `${raw}T00:00:00.000Z`
      : raw;

  const milliseconds =
    Date.parse(
      normalized,
    );

  if (
    !Number.isFinite(
      milliseconds,
    )
  ) {
    return null;
  }

  return Math.floor(
    milliseconds /
      86_400_000,
  );
}

/*
 * Convert an instant into a YYYY-MM-DD calendar key in a requested timezone.
 *
 * This lets Responsibilities express:
 *
 *   "once per employee per business day"
 *
 * without cron jobs or destructive midnight resets.
 */
function submissionGuardCalendarDay(
  value: unknown,
  timezone: string,
) {
  const raw =
    String(
      value ?? "",
    ).trim();

  if (!raw) {
    return null;
  }

  const date =
    new Date(raw);

  if (
    !Number.isFinite(
      date.getTime(),
    )
  ) {
    return null;
  }

  try {
    const parts =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone:
            timezone,
          year:
            "numeric",
          month:
            "2-digit",
          day:
            "2-digit",
        },
      ).formatToParts(
        date,
      );

    const values =
      Object.fromEntries(
        parts.map(
          (part) => [
            part.type,
            part.value,
          ],
        ),
      );

    return [
      values.year,
      values.month,
      values.day,
    ].join("-");
  } catch {
    return null;
  }
}

function submissionGuardStringArray(
  value: unknown,
) {
  return Array.isArray(
    value,
  )
    ? value
        .map(String)
        .map(
          (item) =>
            item.trim(),
        )
        .filter(Boolean)
    : [];
}


/*
 * BRIXTA_COMPOSITE_CALENDAR_DAY_UNIQUE_V1
 *
 * Canonicalize business capture values for duplicate matching.
 *
 * Common reference captures are scalar IDs, but this intentionally
 * understands { id: ... } as well so future richer reference payloads
 * do not break dedupe semantics.
 */
function submissionGuardComparable(
  value: unknown,
): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "null";
  }

  if (
    typeof value ===
      "string"
  ) {
    return (
      `string:${value
        .trim()
        .toLowerCase()}`
    );
  }

  if (
    typeof value ===
      "number" ||
    typeof value ===
      "boolean"
  ) {
    return (
      `${typeof value}:${String(value)}`
    );
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return (
      "array:[" +
      value
        .map(
          submissionGuardComparable,
        )
        .join(",") +
      "]"
    );
  }

  if (
    typeof value ===
      "object"
  ) {
    const object =
      objectValue(
        value,
      );

    if (
      object.id !==
        undefined
    ) {
      return (
        `id:${String(
          object.id,
        )
          .trim()
          .toLowerCase()}`
      );
    }

    const keys =
      Object.keys(
        object,
      ).sort();

    return (
      "object:{" +
      keys
        .map(
          (key) =>
            `${key}:${submissionGuardComparable(
              object[key],
            )}`,
        )
        .join(",") +
      "}"
    );
  }

  return (
    `${typeof value}:${String(
      value,
    )}`
  );
}


async function enforceSubmissionGuards(
  db: AppDatabase,
  input: {
    action: KernelAction;
    responsibilityId: number;
    subjectUserId: number;
    recordId?: string | null;
    captures: Record<string, unknown>;
    world: KernelRuntimeWorld;
    phase?: "availability" | "submission";
  },
): Promise<KernelRuntimeError | null> {
  const rawGuards =
    input.action.config
      .submissionGuards;

  if (
    !Array.isArray(
      rawGuards,
    ) ||
    rawGuards.length === 0
  ) {
    return null;
  }

  for (
    const rawGuard
    of rawGuards
  ) {
    const guard =
      objectValue(
        rawGuard,
      );

    const kind =
      String(
        guard.kind ?? "",
      ).trim();

    if (!kind) {
      continue;
    }

    if (
      kind !==
        "date_range_no_overlap" &&
      kind !==
        "calendar_day_unique" &&
      kind !==
        "expression"
    ) {
      return {
        ok: false,
        status: 409,
        code:
          "KERNEL_SUBMISSION_GUARD_UNSUPPORTED",
        error:
          `Published Responsibility uses unsupported submission guard "${kind}".`,
      };
    }

    /*
     * BRIXTA_GENERIC_PRE_ACTION_POLICY_V1
     *
     * Safe expression policies can affect:
     *
     * availability
     * submission
     * or both.
     *
     * All are rechecked by SERVER before persistence.
     */
    if (
      kind ===
      "expression"
    ) {
      const authoredPhase =
        String(
          guard.phase ??
            "both",
        ).trim();

      if (
        ![
          "availability",
          "submission",
          "both",
        ].includes(
          authoredPhase,
        )
      ) {
        return {
          ok: false,
          status: 409,
          code:
            "KERNEL_SUBMISSION_GUARD_INVALID",
          error:
            `Invalid expression guard phase "${authoredPhase}".`,
        };
      }

      if (
        (
          input.phase ??
          "submission"
        ) ===
          "availability" &&
        authoredPhase ===
          "submission"
      ) {
        continue;
      }

      const placement =
        String(
          guard.placement ??
            "server",
        ).trim();

      if (
        placement !==
          "auto" &&
        placement !==
          "server"
      ) {
        return {
          ok: false,
          status: 409,
          code:
            "KERNEL_SUBMISSION_GUARD_INVALID",
          error:
            "Authoritative expression guards may use only auto or server placement.",
        };
      }

      let allowed =
        false;

      try {
        allowed =
          evaluatePolicyExpressionBoolean(
            guard.expression,
            input.world,
          );
      } catch (
        error
      ) {
        return {
          ok: false,
          status: 409,
          code:
            "KERNEL_SUBMISSION_GUARD_INVALID",
          error:
            error instanceof Error
              ? `Invalid expression guard: ${error.message}`
              : "Invalid expression guard.",
        };
      }

      if (
        !allowed
      ) {
        return {
          ok: false,
          status: 409,
          code:
            String(
              guard.code ??
                "KERNEL_ACTION_POLICY_FAILED",
            ),
          error:
            String(
              guard.message ??
                "This action is not available under the current business policy.",
            ),
          details: [
            {
              kind,
              phase:
                authoredPhase,
              placement:
                placement ===
                  "auto"
                  ? "server"
                  : placement,
            },
          ],
        };
      }

      continue;
    }

    const scope =
      String(
        guard.scope ??
          "current_employee",
      ).trim();

    if (
      scope !==
      "current_employee"
    ) {
      return {
        ok: false,
        status: 409,
        code:
          "KERNEL_SUBMISSION_GUARD_UNSUPPORTED",
        error:
          `${kind} currently requires scope "current_employee".`,
      };
    }

    /*
     * CALENDAR_DAY_UNIQUE
     *
     * Generic rule:
     *
     *   same Responsibility
     *   + same employee
     *   + same local calendar day
     *   = conflict
     *
     * There is deliberately NO midnight job.
     *
     * At midnight in the configured timezone, the day key naturally
     * changes and a fresh record becomes legal.
     */
    if (
      kind ===
      "calendar_day_unique"
    ) {
      const field =
        String(
          guard.field ??
            "attendance_time",
        ).trim();

      const timezone =
        String(
          guard.timezone ??
            "UTC",
        ).trim();

      const daySource =
        String(
          guard.daySource ??
            "capture",
        ).trim();

      const guardPhase =
        input.phase ??
        "submission";

      if (
        daySource !==
          "capture" &&
        daySource !==
          "server_time"
      ) {
        return {
          ok: false,
          status: 409,
          code:
            "KERNEL_SUBMISSION_GUARD_INVALID",
          error:
            `calendar_day_unique daySource must be "capture" or "server_time", not "${daySource}".`,
        };
      }

      const matchFields =
        submissionGuardStringArray(
          guard.matchFields,
        );

      /*
       * For GET/runtime availability:
       *
       * calendar_day_unique can hide an action immediately
       * when the day is based on authoritative server time.
       *
       * Capture-dependent composite dedupe remains submit-time
       * unless all matching values are already known.
       */
      if (
        guardPhase ===
        "availability"
      ) {
        if (
          daySource !==
          "server_time"
        ) {
          continue;
        }

        const complete =
          matchFields.every(
            (key) =>
              Object.prototype.hasOwnProperty.call(
                input.captures,
                key,
              ) &&
              input.captures[
                key
              ] !== null &&
              input.captures[
                key
              ] !== undefined &&
              input.captures[
                key
              ] !== "",
          );

        if (
          !complete
        ) {
          continue;
        }
      }

      /*
       * server_time is appropriate for:
       *
       *   "same salesman cannot add the same dealer twice TODAY"
       *
       * It does not trust an editable client datetime.
       *
       * capture preserves backwards compatibility with the existing
       * attendance/date-field guard.
       */
      const requestedRaw =
        daySource ===
          "server_time"
          ? new Date()
              .toISOString()
          : input.captures[
              field
            ];

      for (
        const matchField
        of matchFields
      ) {
        if (
          !Object.prototype.hasOwnProperty.call(
            input.captures,
            matchField,
          ) ||
          input.captures[
            matchField
          ] === null ||
          input.captures[
            matchField
          ] === undefined ||
          input.captures[
            matchField
          ] === ""
        ) {
          return {
            ok: false,
            status: 400,
            code:
              "KERNEL_SUBMISSION_GUARD_FAILED",
            error:
              `Duplicate-prevention field "${matchField}" is required.`,
            details: [
              {
                kind,
                matchField,
              },
            ],
          };
        }
      }

      const requestedDay =
        submissionGuardCalendarDay(
          requestedRaw,
          timezone,
        );

      if (!requestedDay) {
        return {
          ok: false,
          status: 400,
          code:
            "KERNEL_SUBMISSION_GUARD_FAILED",
          error:
            String(
              guard.invalidMessage ??
                "A valid date/time is required.",
            ),
          details: [
            {
              kind,
              field,
              timezone,
              daySource,
              matchFields,
            },
          ],
        };
      }

      const conflictStatuses =
        submissionGuardStringArray(
          guard.conflictStatuses,
        );

      const ignoreCurrentRecord =
        guard.ignoreCurrentRecord !==
        false;

      const existingRows =
        await db
          .select({
            id:
              dynamicSubmissions.id,
            status:
              dynamicSubmissions.status,
            payload:
              dynamicSubmissions.payload,
            createdAt:
              dynamicSubmissions.createdAt,
          })
          .from(
            dynamicSubmissions,
          )
          .where(
            and(
              eq(
                dynamicSubmissions.capabilityId,
                input.responsibilityId,
              ),
              eq(
                dynamicSubmissions.userId,
                input.subjectUserId,
              ),
              ne(
                dynamicSubmissions.status,
                "deleted",
              ),
            ),
          );

      for (
        const existing
        of existingRows
      ) {
        if (
          ignoreCurrentRecord &&
          input.recordId &&
          String(
            existing.id,
          ) ===
            String(
              input.recordId,
            )
        ) {
          continue;
        }

        if (
          conflictStatuses.length >
            0 &&
          !conflictStatuses.includes(
            String(
              existing.status,
            ),
          )
        ) {
          continue;
        }

        const payload =
          objectValue(
            existing.payload,
          );

        /*
         * Optional composite duplicate key.
         *
         * Example:
         *
         *   current employee
         *   + dealer
         *   + local day
         */
        let fieldsMatch =
          true;

        for (
          const matchField
          of matchFields
        ) {
          if (
            !Object.prototype.hasOwnProperty.call(
              payload,
              matchField,
            )
          ) {
            fieldsMatch =
              false;
            break;
          }

          if (
            submissionGuardComparable(
              input.captures[
                matchField
              ],
            ) !==
            submissionGuardComparable(
              payload[
                matchField
              ],
            )
          ) {
            fieldsMatch =
              false;
            break;
          }
        }

        if (
          !fieldsMatch
        ) {
          continue;
        }

        const existingRaw =
          daySource ===
            "server_time"
            ? existing.createdAt
            : payload[
                field
              ];

        const existingDay =
          submissionGuardCalendarDay(
            existingRaw,
            timezone,
          );

        if (
          !existingDay ||
          existingDay !==
            requestedDay
        ) {
          continue;
        }

        return {
          ok: false,
          status: 409,
          code:
            "KERNEL_SUBMISSION_GUARD_FAILED",
          error:
            String(
              guard.message ??
                "You have already completed this action for today.",
            ),
          details: [
            {
              kind,
              field,
              timezone,
              daySource,
              matchFields,
              matchedValues:
                Object.fromEntries(
                  matchFields.map(
                    (matchField) => [
                      matchField,
                      input.captures[
                        matchField
                      ],
                    ],
                  ),
                ),
              calendarDay:
                requestedDay,
              conflictRecordId:
                existing.id,
              conflictStatus:
                existing.status,
            },
          ],
        };
      }

      continue;
    }

    /*
     * CALENDAR_DAY_UNIQUE
     *
     * Generic invariant:
     *
     * same Responsibility
     * + same employee
     * + same calendar day in configured timezone
     * = reject another creation.
     *
     * Requested day is derived from SERVER TIME.
     * Existing day is derived from the persisted DB created_at.
     *
     * This is stronger than trusting a client-provided datetime capture.
     */

    /*
     * Date-range guards require employee-supplied fields.
     * Do not hide the action before those values exist;
     * always enforce it on submission.
     */
    if (
      (
        input.phase ??
        "submission"
      ) ===
        "availability"
    ) {
      continue;
    }

    const fromField =
      String(
        guard.fromField ?? "",
      ).trim();

    const toField =
      String(
        guard.toField ?? "",
      ).trim();

    if (
      !fromField ||
      !toField
    ) {
      return {
        ok: false,
        status: 409,
        code:
          "KERNEL_SUBMISSION_GUARD_INVALID",
        error:
          "date_range_no_overlap requires fromField and toField.",
      };
    }

    const requestedFromRaw =
      input.captures[
        fromField
      ];

    const requestedToRaw =
      input.captures[
        toField
      ];

    const requestedFrom =
      submissionGuardDate(
        requestedFromRaw,
      );

    const requestedTo =
      submissionGuardDate(
        requestedToRaw,
      );

    if (
      requestedFrom === null ||
      requestedTo === null
    ) {
      return {
        ok: false,
        status: 400,
        code:
          "KERNEL_SUBMISSION_GUARD_FAILED",
        error:
          "Choose a valid date range.",
        details: [
          {
            kind,
            fromField,
            toField,
          },
        ],
      };
    }

    if (
      requestedFrom >
      requestedTo
    ) {
      return {
        ok: false,
        status: 400,
        code:
          "KERNEL_SUBMISSION_GUARD_FAILED",
        error:
          "The end date cannot be before the start date.",
        details: [
          {
            kind,
            fromField,
            toField,
            from:
              requestedFromRaw,
            to:
              requestedToRaw,
          },
        ],
      };
    }

    const conflictStatuses =
      submissionGuardStringArray(
        guard.conflictStatuses,
      );

    const ignoreCurrentRecord =
      guard.ignoreCurrentRecord !==
      false;

    /*
     * Only inspect records belonging to:
     *
     *   same Responsibility
     *   +
     *   same employee
     *
     * This keeps the guard tenant-safe and Responsibility-local.
     */
    const existingRows =
      await db
        .select({
          id:
            dynamicSubmissions.id,
          status:
            dynamicSubmissions.status,
          payload:
            dynamicSubmissions.payload,
        })
        .from(
          dynamicSubmissions,
        )
        .where(
          and(
            eq(
              dynamicSubmissions.capabilityId,
              input.responsibilityId,
            ),
            eq(
              dynamicSubmissions.userId,
              input.subjectUserId,
            ),
            ne(
              dynamicSubmissions.status,
              "deleted",
            ),
          ),
        );

    for (
      const existing
      of existingRows
    ) {
      if (
        ignoreCurrentRecord &&
        input.recordId &&
        String(
          existing.id,
        ) ===
          String(
            input.recordId,
          )
      ) {
        continue;
      }

      if (
        conflictStatuses.length >
          0 &&
        !conflictStatuses.includes(
          String(
            existing.status,
          ),
        )
      ) {
        continue;
      }

      const payload =
        objectValue(
          existing.payload,
        );

      const existingFromRaw =
        payload[
          fromField
        ];

      const existingToRaw =
        payload[
          toField
        ];

      const existingFrom =
        submissionGuardDate(
          existingFromRaw,
        );

      const existingTo =
        submissionGuardDate(
          existingToRaw,
        );

      /*
       * Historical records created before this rule may not contain the
       * configured date fields. They are not considered conflicts.
       */
      if (
        existingFrom === null ||
        existingTo === null
      ) {
        continue;
      }

      /*
       * Inclusive overlap:
       *
       * existing: 28 Aug -> 31 Aug
       *
       * BLOCK:
       *   28 Aug
       *   29 Aug
       *   27 Aug -> 28 Aug
       *   30 Aug -> 2 Sep
       *
       * ALLOW:
       *   27 Aug
       *   1 Sep onward
       */
      const overlaps =
        requestedFrom <=
          existingTo &&
        existingFrom <=
          requestedTo;

      if (!overlaps) {
        continue;
      }

      const message =
        String(
          guard.message ??
            "The requested date range overlaps an existing record.",
        ).trim();

      return {
        ok: false,
        status: 409,
        code:
          "KERNEL_SUBMISSION_GUARD_FAILED",
        error:
          message ||
          "The requested date range overlaps an existing record.",
        details: [
          {
            kind,
            conflictRecordId:
              existing.id,
            conflictStatus:
              existing.status,
            requested: {
              from:
                requestedFromRaw,
              to:
                requestedToRaw,
            },
            existing: {
              from:
                existingFromRaw,
              to:
                existingToRaw,
            },
          },
        ],
      };
    }
  }

  return null;
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

    clientExecutedPixelNodeIds?: string[];

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

  /*
   * BRIXTA_SUBMISSION_GUARDS_V1
   *
   * Business invariants run before state transitions, Pixel effects and
   * dynamic_submissions writes.
   */
  const submissionGuardFailure =
    await enforceSubmissionGuards(
      db,
      {
        action:
          possibility.action,

        responsibilityId:
          resolved.responsibility.id,

        subjectUserId:
          world.subjectUserId,

        recordId:
          record?.id ??
          input.recordId ??
          null,

        captures:
          world.captures,

        world,

        phase:
          "submission",
      },
    );

  if (
    submissionGuardFailure
  ) {
    return submissionGuardFailure;
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

  const clientSafeResponseKinds =
    new Set([
      "ui_animate",
      "ui_show",
      "ui_hide",
      "ui_play",
      "haptic",
      "device_sound",
      "device_ring",
      "device_notification",
    ]);

  const alreadyExecutedOnDevice =
    new Set(
      (
        input.clientExecutedPixelNodeIds ??
        []
      ).map(
        String,
      ),
    );

  /*
   * The complete published Pixel graph has already
   * been evaluated by the backend above.
   *
   * Only transient feedback already performed by
   * this requesting phone is removed from the
   * response to prevent duplicate playback.
   *
   * Business effects are NEVER skipped.
   */
  const responseEffects =
    appliedEffects.filter(
      (
        effect,
      ) => {
        if (
          effect.source !==
          "pixel_logic"
        ) {
          return true;
        }

        const nodeId =
          String(
            effect.nodeId ??
            "",
          );

        const kind =
          String(
            effect.kind ??
            "",
          );

        return !(
          alreadyExecutedOnDevice.has(
            nodeId,
          ) &&
          clientSafeResponseKinds.has(
            kind,
          )
        );
      },
    );

  return {
    ok: true,
    value: {
      record,
      eventIds: [...eventIds],
      effects: responseEffects,
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
