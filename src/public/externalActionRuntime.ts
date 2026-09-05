import {
  randomUUID,
} from "node:crypto";

import {
  eq,
  sql,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../db/db";

import {
  workspaceSettings,
} from "../db/applianceSchema";

import {
  getResponsibilityByKey,
} from "../platform/responsibility";

import {
  getPublishedRuntimeManifest,
} from "../platform/vnext/runtimeManifest";

import {
  queryRuntimeDataSource,
} from "../platform/vnext/dataSourceRuntime";

import {
  evaluateConditionGroup,
  resolveValueRef,
} from "../platform/kernel/evaluator";

import type {
  KernelEffect,
  KernelEvaluationWorld,
  ResponsibilityKernel,
} from "../platform/kernel/types";

import {
  normalizePixelLogicProgram,
  PIXEL_LOGIC_METADATA_KEY,
  type PixelLogicEffect,
} from "../platform/pixelLogic/types";

import {
  runPixelLogic,
} from "../platform/pixelLogic/runtime";

import {
  enqueueServiceRequest,
  listPublishedCapabilities,
} from "../platform/integrations/serviceRuntime";


function objectValue(
  value: unknown,
): Record<string, unknown> {
  return (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(value)
  )
    ? value as
        Record<string, unknown>
    : {};
}


function arrayValue(
  value: unknown,
) {
  return Array.isArray(value)
    ? value
    : [];
}


type ExternalRecord = {
  id: string;
  responsibilityId: number;
  responsibilityKey: string;
  externalSessionId: string;
  status: string;
  payload: Record<string, unknown>;
  manifestVersion: number | null;
  manifestHash: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};


export type ExternalRuntimeDefinition = {
  responsibility: {
    id: number;
    key: string;
    title: string;
  };

  published: {
    version: number;
    manifestHash: string;
    source: unknown;
    manifest: Record<string, unknown>;
  };

  kernel:
    ResponsibilityKernel;

  delivery:
    Record<string, unknown>;

  allowedActionIds:
    string[];

  allowedCapabilities:
    string[];
};


function initialState(
  kernel:
    ResponsibilityKernel,
) {
  const result:
    Record<string, string> =
    {};

  for (
    const state of
    kernel.runtimeWorld.states
  ) {
    if (
      state.initial &&
      !result[state.dimension]
    ) {
      result[state.dimension] =
        state.id;
    }
  }

  if (!result.process) {
    const first =
      kernel.runtimeWorld.states
        .find(
          (item) =>
            item.dimension ===
            "process",
        );

    result.process =
      first?.id ??
      "draft";
  }

  return result;
}


export async function loadExternalRuntimeDefinition(
  db: AppDatabase,
  tenant: string,
  responsibilityKey: string,
): Promise<
  ExternalRuntimeDefinition | null
> {
  const responsibility =
    await getResponsibilityByKey(
      db,
      responsibilityKey,
    );

  if (
    !responsibility
  ) {
    return null;
  }

  const published =
    await getPublishedRuntimeManifest(
      db,
      responsibility.id,
    );

  if (
    !published?.kernel
  ) {
    return null;
  }

  const metadata =
    objectValue(
      published.kernel
        .metadata,
    );

  const targets =
    objectValue(
      metadata.deliveryTargets,
    );

  const external =
    objectValue(
      targets.externalWeb,
    );

  if (
    external.enabled !==
      true ||
    String(
      external.tenantKey ??
      "",
    ) !==
      tenant
  ) {
    return null;
  }

  const access =
    String(
      external.access ??
      "",
    );

  if (
    ![
      "public",
      "optional_auth",
      "required_auth",
    ].includes(
      access,
    )
  ) {
    return null;
  }

  const requestedCapabilities =
    Array.isArray(
      external.allowedCapabilities,
    )
      ? external.allowedCapabilities
          .map(String)
          .filter(Boolean)
      : [];

  const publishedCapabilities =
    await listPublishedCapabilities(
      db,
    );

  const builtIns =
    new Set([
      "qrReward.resolve",
      "qrReward.preflight",
      "entity.listEligible",
      "upi.validate",
      "voucher.claimPublic",
      "payout.request",
      "payout.getStatus",
    ]);

  const allowedCapabilities =
    requestedCapabilities
      .filter(
        (capability) =>
          builtIns.has(
            capability,
          ) ||
          publishedCapabilities.includes(
            capability,
          ),
      );

  const allowedActionIds =
    Array.isArray(
      external.allowedActionIds,
    )
      ? external.allowedActionIds
          .map(String)
          .filter(Boolean)
      : [];

  return {
    responsibility: {
      id:
        responsibility.id,

      key:
        responsibility.key,

      title:
        responsibility.title,
    },

    published: {
      version:
        published.version,

      manifestHash:
        published.manifestHash,

      source:
        published.source,

      manifest:
        published.manifest,
    },

    kernel:
      published.kernel,

    delivery:
      external,

    allowedActionIds,

    allowedCapabilities,
  };
}


export function publicRuntimeContract(
  definition:
    ExternalRuntimeDefinition,
) {
  const captures =
    definition.kernel
      .possibilities
      .filter(
        (item) =>
          item.type ===
          "capture",
      )
      .map(
        (item) =>
          item.type ===
          "capture"
            ? item.capture
            : null,
      )
      .filter(
        Boolean,
      );

  const actions =
    definition.kernel
      .possibilities
      .filter(
        (item) =>
          item.type ===
            "action" &&
          definition
            .allowedActionIds
            .includes(
              item.action.id,
            ),
      )
      .map(
        (item) =>
          item.type ===
          "action"
            ? item.action
            : null,
      )
      .filter(
        Boolean,
      );

  const metadata =
    objectValue(
      definition.kernel
        .metadata,
    );

  const ui =
    objectValue(
      metadata.ui,
    );

  const manifest =
    objectValue(
      definition.published
        .manifest,
    );

  const extension =
    objectValue(
      manifest.extension,
    );

  const extensionMetadata =
    objectValue(
      extension.metadata,
    );

  return {
    responsibility:
      definition.responsibility,

    manifest: {
      version:
        definition.published
          .version,

      hash:
        definition.published
          .manifestHash,

      source:
        definition.published
          .source,
    },

    delivery: {
      ...definition.delivery,

      allowedActionIds:
        definition
          .allowedActionIds,

      allowedCapabilities:
        definition
          .allowedCapabilities,
    },

    uiDocument:
      ui.uiDocument ??
      null,

    captures,

    actions,

    pixelLogic:
      extensionMetadata[
        PIXEL_LOGIC_METADATA_KEY
      ] ??
      null,
  };
}


async function loadExternalRecord(
  db: AppDatabase,
  input: {
    responsibilityId: number;
    sessionId: string;
    recordId?: string | null;
  },
): Promise<
  ExternalRecord | null
> {
  if (
    !input.recordId
  ) {
    return null;
  }

  const result =
    await db.execute(sql`
      SELECT
        id,

        responsibility_id
          AS "responsibilityId",

        responsibility_key
          AS "responsibilityKey",

        external_session_id
          AS "externalSessionId",

        status,

        payload,

        manifest_version
          AS "manifestVersion",

        manifest_hash
          AS "manifestHash",

        created_at
          AS "createdAt",

        updated_at
          AS "updatedAt"

      FROM
        external_runtime_records

      WHERE
        id =
          ${input.recordId}::uuid

        AND
        responsibility_id =
          ${input.responsibilityId}

        AND
        external_session_id =
          ${input.sessionId}

      LIMIT 1
    `);

  const row =
    result.rows[0] as
      | ExternalRecord
      | undefined;

  if (!row) {
    return null;
  }

  return {
    ...row,

    payload:
      objectValue(
        row.payload,
      ),
  };
}


async function buildExternalWorld(
  db: AppDatabase,
  input: {
    definition:
      ExternalRuntimeDefinition;

    sessionId:
      string;

    record:
      ExternalRecord | null;

    captures:
      Record<string, unknown>;

    device?:
      Record<string, unknown>;
  },
): Promise<
  KernelEvaluationWorld
> {
  const stored =
    objectValue(
      input.record
        ?.payload,
    );

  const history =
    arrayValue(
      stored.__history,
    );

  const storedContext =
    objectValue(
      stored.__context,
    );

  const storedState =
    objectValue(
      stored.__state,
    );

  const state =
    initialState(
      input.definition
        .kernel,
    );

  if (
    input.record?.status
  ) {
    state.process =
      input.record.status;
  }

  for (
    const [
      key,
      value,
    ] of
    Object.entries(
      storedState,
    )
  ) {
    if (
      typeof value ===
        "string" &&
      value
    ) {
      state[key] =
        value;
    }
  }

  const world:
    KernelEvaluationWorld = {
    state,

    captures: {
      ...stored,

      ...input.captures,
    },

    context: {
      ...storedContext,

      current_user:
        null,

      current_manager:
        null,

      current_device:
        input.device ??
        {},

      current_time:
        new Date()
          .toISOString(),

      external_session: {
        id:
          input.sessionId,
      },

      record:
        input.record,

      history,
    },

    objects: {
      current_record:
        input.record,

      external_session: {
        id:
          input.sessionId,
      },
    },

    actors: {
      system: {
        system:
          true,
      },
    },

    queries:
      {},

    computed:
      objectValue(
        stored.__computed,
      ),

    history,
  };

  for (
    const context of
    input.definition
      .kernel
      .runtimeWorld
      .contexts
  ) {
    if (
      Object
        .prototype
        .hasOwnProperty
        .call(
          world.context,
          context.id,
        )
    ) {
      continue;
    }

    switch (
      context.source
    ) {
      case "current_user":
      case "current_manager":
        world.context[
          context.id
        ] =
          null;
        break;

      case "current_device":
        world.context[
          context.id
        ] =
          input.device ??
          {};
        break;

      case "current_time":
        world.context[
          context.id
        ] =
          world.context
            .current_time;
        break;

      case "literal":
        world.context[
          context.id
        ] =
          context.value;
        break;

      case "company_setting": {
        const key =
          String(
            context.sourceKey ??
            context.config?.key ??
            "",
          ).trim();

        if (!key) {
          world.context[
            context.id
          ] =
            null;
          break;
        }

        const [setting] =
          await db
            .select({
              value:
                workspaceSettings
                  .value,
            })
            .from(
              workspaceSettings,
            )
            .where(
              eq(
                workspaceSettings.key,
                key,
              ),
            )
            .limit(1);

        world.context[
          context.id
        ] =
          setting?.value ??
          null;

        break;
      }

      case "native": {
        const device =
          objectValue(
            input.device,
          );

        const metadata =
          objectValue(
            device.metadata,
          );

        const key =
          String(
            context.config
              ?.nativeCapability ??
            context.sourceKey ??
            "",
          ).trim();

        world.context[
          context.id
        ] =
          key
            ? metadata[key] ??
              null
            : device;

        break;
      }

      case "record":
        world.context[
          context.id
        ] =
          input.record;
        break;

      case "history":
        world.context[
          context.id
        ] =
          history;
        break;

      case "session":
      case "external":
        world.context[
          context.id
        ] =
          storedContext[
            context.id
          ] ??
          (
            context.sourceKey
              ? world.context[
                  context.sourceKey
                ]
              : {
                  id:
                    input.sessionId,
                }
          );
        break;

      case "query":
        if (
          context.sourceKey
        ) {
          const result =
            await queryRuntimeDataSource(
              db,
              {
                key:
                  context.sourceKey,

                limit:
                  50,
              },
            );

          if (
            result.ok
          ) {
            world.queries[
              context.id
            ] =
              result.value.rows;

            world.context[
              context.id
            ] =
              result.value.rows;
          }
        }
        break;

      default:
        world.context[
          context.id
        ] =
          storedContext[
            context.id
          ];
    }
  }

  for (
    const object of
    input.definition
      .kernel
      .runtimeWorld
      .objects
  ) {
    if (
      object.id ===
      "current_record"
    ) {
      world.objects[
        object.id
      ] =
        input.record;

      continue;
    }

    if (
      object.kind ===
      "device"
    ) {
      world.objects[
        object.id
      ] =
        input.device ??
        {};

      continue;
    }

    if (
      object.kind ===
        "session" ||
      object.kind ===
        "external"
    ) {
      world.objects[
        object.id
      ] = {
        id:
          input.sessionId,
      };

      continue;
    }

    if (
      object.kind ===
      "employee"
    ) {
      world.objects[
        object.id
      ] =
        null;

      continue;
    }

    world.objects[
      object.id
    ] =
      object.sourceKey
        ? world.captures[
            object.sourceKey
          ] ??
          world.context[
            object.sourceKey
          ] ??
          null
        : null;
  }

  return world;
}


function pixelEffectToKernelEffect(
  effect:
    PixelLogicEffect,
): KernelEffect {
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
      effect.value ===
        undefined
        ? undefined
        : {
            kind:
              "literal",

            value:
              effect.value,
          },

    config: {
      ...effect.config,
    },
  };
}


function requiredCaptureErrors(
  kernel:
    ResponsibilityKernel,
  captureIds:
    string[],
  captures:
    Record<string, unknown>,
) {
  const errors:
    string[] = [];

  for (
    const captureId of
    captureIds
  ) {
    const possibility =
      kernel.possibilities
        .find(
          (item) =>
            item.type ===
              "capture" &&
            item.capture.id ===
              captureId,
        );

    if (
      !possibility ||
      possibility.type !==
        "capture" ||
      !possibility.capture
        .required
    ) {
      continue;
    }

    const key =
      possibility.capture
        .storeAs ??
      possibility.capture.id;

    const value =
      captures[key] ??
      captures[captureId];

    if (
      value === null ||
      value === undefined ||
      value === "" ||
      (
        Array.isArray(
          value,
        ) &&
        value.length ===
          0
      )
    ) {
      errors.push(
        `${possibility.capture.label} is required.`,
      );
    }
  }

  return errors;
}


const CLIENT_EFFECTS =
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


const EXTERNAL_FORBIDDEN_EFFECTS =
  new Set([
    "assign_actor",
    "notify_actor",
    "create_record",
    "trigger_responsibility",
    "trigger_action",
  ]);


async function applyExternalEffect(
  db: AppDatabase,
  input: {
    effect:
      KernelEffect;

    definition:
      ExternalRuntimeDefinition;

    world:
      KernelEvaluationWorld;

    payload:
      Record<string, unknown>;

    state:
      Record<string, string>;

    sessionId:
      string;

    recordId:
      string | null;

    clientMutationId:
      string;
  },
) {
  const effect =
    input.effect;

  const result:
    Record<string, unknown> = {
    id:
      effect.id,

    kind:
      effect.kind,
  };

  if (
    EXTERNAL_FORBIDDEN_EFFECTS
      .has(
        effect.kind,
      )
  ) {
    throw new Error(
      `Public External Runtime cannot execute employee-only effect "${effect.kind}".`,
    );
  }

  switch (
    effect.kind
  ) {
    case "change_state": {
      const dimension =
        effect.targetKey ||
        "process";

      const next =
        resolveValueRef(
          input.world,
          effect.value,
        ) ??
        effect.config.stateId ??
        effect.config.state ??
        effect.config.value;

      if (
        typeof next ===
          "string" &&
        next
      ) {
        input.state[
          dimension
        ] =
          next;

        result.state = {
          dimension,
          value:
            next,
        };
      }

      break;
    }

    case "set_context": {
      const key =
        effect.targetKey ||
        String(
          effect.config.key ??
          "",
        );

      if (key) {
        const context =
          objectValue(
            input.payload
              .__context,
          );

        const value =
          resolveValueRef(
            input.world,
            effect.value,
          ) ??
          effect.config.value;

        context[key] =
          value;

        input.payload
          .__context =
          context;

        input.world
          .context[key] =
          value;

        result.contextKey =
          key;
      }

      break;
    }

    case "remove_context": {
      const key =
        effect.targetKey ||
        String(
          effect.config.key ??
          "",
        );

      if (key) {
        const context =
          objectValue(
            input.payload
              .__context,
          );

        delete context[key];
        delete input.world
          .context[key];

        input.payload
          .__context =
          context;

        result.contextKey =
          key;
      }

      break;
    }

    case "set_computed": {
      const key =
        effect.targetKey ||
        String(
          effect.config.key ??
          "",
        );

      if (key) {
        const value =
          resolveValueRef(
            input.world,
            effect.value,
          ) ??
          effect.config.value;

        const computed =
          objectValue(
            input.payload
              .__computed,
          );

        computed[key] =
          value;

        input.payload
          .__computed =
          computed;

        input.world
          .computed[key] =
          value;

        input.payload[key] =
          value;

        result.computedKey =
          key;
      }

      break;
    }

    case "append_history": {
      const history =
        arrayValue(
          input.payload
            .__history,
        );

      const entry = {
        at:
          new Date()
            .toISOString(),

        externalSessionId:
          input.sessionId,

        label:
          String(
            effect.config.label ??
            "Activity",
          ),

        metadata:
          objectValue(
            effect.config
              .metadata,
          ),
      };

      input.payload
        .__history = [
          ...history,
          entry,
        ];

      input.world
        .history = [
          ...input.world
            .history,
          entry,
        ];

      result.entry =
        entry;

      break;
    }

    case "query_data": {
      const sourceKey =
        String(
          effect.config.sourceKey ??
          effect.targetKey ??
          "",
        ).trim();

      if (sourceKey) {
        const query =
          await queryRuntimeDataSource(
            db,
            {
              key:
                sourceKey,

              q:
                String(
                  effect.config.q ??
                  "",
                ),

              limit:
                Number(
                  effect.config
                    .limit,
                ) ||
                50,

              filters:
                Array.isArray(
                  effect.config
                    .filters,
                )
                  ? effect.config
                      .filters as
                      Array<{
                        field: string;
                        operator?: string;
                        value?: unknown;
                      }>
                  : [],
            },
          );

        if (
          query.ok
        ) {
          const key =
            effect.targetKey ||
            sourceKey;

          input.world
            .queries[key] =
            query.value.rows;

          result.rows =
            query.value.rows
              .length;
        } else {
          result.error =
            query.error;
        }
      }

      break;
    }

    case "freeze_data": {
      const frozen =
        new Set(
          arrayValue(
            input.payload
              .__frozen,
          ).map(String),
        );

      if (
        effect.targetKey
      ) {
        frozen.add(
          effect.targetKey,
        );
      }

      for (
        const key of
        arrayValue(
          effect.config.keys,
        ).map(String)
      ) {
        frozen.add(key);
      }

      input.payload
        .__frozen = [
          ...frozen,
        ];

      result.keys = [
        ...frozen,
      ];

      break;
    }

    case "update_record": {
      const patch =
        objectValue(
          resolveValueRef(
            input.world,
            effect.value,
          ) ??
          effect.config.payload,
        );

      Object.assign(
        input.payload,
        patch,
      );

      result.updatedKeys =
        Object.keys(
          patch,
        );

      break;
    }

    case "delete_record":
      input.state
        .process =
        "deleted";

      result.deleted =
        true;

      break;

    case "service_execute": {
      const capability =
        String(
          effect.config
            .capability ??
          effect.targetKey ??
          "",
        ).trim();

      if (
        !capability ||
        !input.definition
          .allowedCapabilities
          .includes(
            capability,
          )
      ) {
        throw new Error(
          `Public service capability "${capability}" is not allowed by this published External Link.`,
        );
      }

      const raw =
        resolveValueRef(
          input.world,
          effect.value,
        ) ??
        effect.config.input ??
        {};

      const request =
        (
          raw &&
          typeof raw ===
            "object" &&
          !Array.isArray(raw)
        )
          ? raw as
              Record<string, unknown>
          : {
              value:
                raw,
            };

      const idempotencyKey =
        [
          "external",
          input.definition
            .responsibility.id,
          input.sessionId,
          input.clientMutationId,
          effect.id,
        ]
          .join(":")
          .slice(
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
                "external_runtime",

              responsibilityId:
                input.definition
                  .responsibility.id,

              responsibilityKey:
                input.definition
                  .responsibility.key,

              externalSessionId:
                input.sessionId,

              recordId:
                input.recordId,

              effectId:
                effect.id,
            },
          },
        );

      result.capability =
        capability;

      result.serviceRequest =
        queued;

      break;
    }

    default:
      if (
        CLIENT_EFFECTS.has(
          effect.kind,
        )
      ) {
        result.config = {
          ...effect.config,
        };

        result.targetKey =
          effect.targetKey ??
          null;

        break;
      }

      throw new Error(
        `External Runtime effect "${effect.kind}" is not supported.`,
      );
  }

  return result;
}


export async function executeExternalRuntimeAction(
  db: AppDatabase,
  input: {
    definition:
      ExternalRuntimeDefinition;

    sessionId:
      string;

    actionId:
      string;

    recordId?:
      string | null;

    payload?:
      unknown;

    clientMutationId:
      string;

    device?:
      Record<string, unknown>;
  },
) {
  if (
    !input.definition
      .allowedActionIds
      .includes(
        input.actionId,
      )
  ) {
    return {
      ok:
        false as const,

      status:
        403,

      code:
        "EXTERNAL_ACTION_NOT_ALLOWED",

      error:
        "This action is not public for this Responsibility.",
    };
  }

  await db.execute(sql`
    SELECT
      pg_advisory_xact_lock(
        hashtextextended(
          ${
            [
              "external-action",
              input.definition
                .responsibility.id,
              input.sessionId,
              input.clientMutationId,
            ].join(":")
          },
          0
        )
      )
  `);

  const receipt =
    await db.execute(sql`
      SELECT
        response_payload
          AS "responsePayload"

      FROM
        external_runtime_action_receipts

      WHERE
        responsibility_id =
          ${input.definition.responsibility.id}

        AND
        external_session_id =
          ${input.sessionId}

        AND
        client_mutation_id =
          ${input.clientMutationId}

      LIMIT 1
    `);

  const previous =
    receipt.rows[0] as
      | {
          responsePayload?: unknown;
        }
      | undefined;

  if (
    previous
  ) {
    return {
      ok:
        true as const,

      value:
        objectValue(
          previous.responsePayload,
        ),

      idempotent:
        true,
    };
  }

  const record =
    await loadExternalRecord(
      db,
      {
        responsibilityId:
          input.definition
            .responsibility.id,

        sessionId:
          input.sessionId,

        recordId:
          input.recordId,
      },
    );

  if (
    input.recordId &&
    !record
  ) {
    return {
      ok:
        false as const,

      status:
        404,

      code:
        "EXTERNAL_RECORD_NOT_FOUND",

      error:
        "External runtime record not found.",
    };
  }

  const submitted =
    objectValue(
      input.payload,
    );

  const world =
    await buildExternalWorld(
      db,
      {
        definition:
          input.definition,

        sessionId:
          input.sessionId,

        record,

        captures:
          submitted,

        device:
          input.device,
      },
    );

  const possibility =
    input.definition
      .kernel
      .possibilities
      .find(
        (item) =>
          item.type ===
            "action" &&
          item.action.id ===
            input.actionId,
      );

  if (
    !possibility ||
    possibility.type !==
      "action"
  ) {
    return {
      ok:
        false as const,

      status:
        404,

      code:
        "EXTERNAL_ACTION_NOT_FOUND",

      error:
        "Published Responsibility does not define this action.",
    };
  }

  if (
    possibility.action
      .actorId
  ) {
    const actor =
      input.definition
        .kernel
        .runtimeWorld
        .actors
        .find(
          (item) =>
            item.id ===
            possibility.action
              .actorId,
        );

    if (
      !actor ||
      actor.resolver.kind !==
        "system"
    ) {
      return {
        ok:
          false as const,

        status:
          403,

        code:
          "EXTERNAL_EMPLOYEE_ACTOR_FORBIDDEN",

        error:
          "Public actions may not impersonate an employee actor.",
      };
    }
  }

  if (
    !evaluateConditionGroup(
      world,
      possibility.when,
    ) ||
    !evaluateConditionGroup(
      world,
      possibility.action
        .requires,
    )
  ) {
    return {
      ok:
        false as const,

      status:
        409,

      code:
        "EXTERNAL_ACTION_NOT_AVAILABLE",

      error:
        "This action is not available in the current public runtime state.",
    };
  }

  const captureErrors =
    requiredCaptureErrors(
      input.definition
        .kernel,

      possibility.action
        .captureIds,

      world.captures,
    );

  if (
    captureErrors.length
  ) {
    return {
      ok:
        false as const,

      status:
        400,

      code:
        "EXTERNAL_CAPTURE_VALIDATION_FAILED",

      error:
        "Required captures are missing.",

      details:
        captureErrors,
    };
  }

  const nextPayload = {
    ...objectValue(
      record?.payload,
    ),

    ...submitted,
  };

  const nextState = {
    ...world.state,
  };

  const events =
    input.definition
      .kernel
      .events
      .filter(
        (event) =>
          event.actionId ===
            possibility.action.id ||
          (
            !event.actionId &&
            event.kind ===
              "action" &&
            event.sourceKey ===
              possibility.action.id
          ),
      );

  const eventIds =
    new Set(
      events.map(
        (event) =>
          event.id,
      ),
    );

  const rules =
    input.definition
      .kernel
      .rules
      .filter(
        (rule) =>
          rule.enabled &&
          (
            !rule.eventId ||
            eventIds.has(
              rule.eventId,
            )
          ) &&
          evaluateConditionGroup(
            world,
            rule.when,
          ),
      )
      .sort(
        (a, b) =>
          a.priority -
          b.priority,
      );

  const appliedEffects:
    Record<string, unknown>[] =
    [];

  for (
    const rule of
    rules
  ) {
    for (
      const effect of
      rule.effects
    ) {
      const applied =
        await applyExternalEffect(
          db,
          {
            effect,

            definition:
              input.definition,

            world,

            payload:
              nextPayload,

            state:
              nextState,

            sessionId:
              input.sessionId,

            recordId:
              record?.id ??
              null,

            clientMutationId:
              input.clientMutationId,
          },
        );

      appliedEffects.push({
        source:
          "kernel",

        ruleId:
          rule.id,

        ...applied,
      });
    }
  }

  nextPayload.__state =
    nextState;

  let persisted:
    ExternalRecord;

  if (
    record
  ) {
    const updated =
      await db.execute(sql`
        UPDATE
          external_runtime_records

        SET
          status =
            ${
              nextState.process ??
              record.status
            },

          payload =
            ${JSON.stringify(
              nextPayload,
            )}::jsonb,

          manifest_version =
            ${input.definition.published.version},

          manifest_hash =
            ${input.definition.published.manifestHash},

          updated_at =
            now()

        WHERE
          id =
            ${record.id}::uuid

        RETURNING
          id,

          responsibility_id
            AS "responsibilityId",

          responsibility_key
            AS "responsibilityKey",

          external_session_id
            AS "externalSessionId",

          status,
          payload,

          manifest_version
            AS "manifestVersion",

          manifest_hash
            AS "manifestHash",

          created_at
            AS "createdAt",

          updated_at
            AS "updatedAt"
      `);

    persisted =
      updated.rows[0] as
        unknown as
        ExternalRecord;
  } else {
    const id =
      randomUUID();

    const created =
      await db.execute(sql`
        INSERT INTO
          external_runtime_records (
            id,
            responsibility_id,
            responsibility_key,
            external_session_id,
            status,
            payload,
            manifest_version,
            manifest_hash,
            created_at,
            updated_at
          )

        VALUES (
          ${id}::uuid,

          ${input.definition.responsibility.id},

          ${input.definition.responsibility.key},

          ${input.sessionId},

          ${
            nextState.process ??
            "submitted"
          },

          ${JSON.stringify(
            nextPayload,
          )}::jsonb,

          ${input.definition.published.version},

          ${input.definition.published.manifestHash},

          now(),
          now()
        )

        RETURNING
          id,

          responsibility_id
            AS "responsibilityId",

          responsibility_key
            AS "responsibilityKey",

          external_session_id
            AS "externalSessionId",

          status,
          payload,

          manifest_version
            AS "manifestVersion",

          manifest_hash
            AS "manifestHash",

          created_at
            AS "createdAt",

          updated_at
            AS "updatedAt"
      `);

    persisted =
      created.rows[0] as
        unknown as
        ExternalRecord;
  }

  world.objects
    .current_record =
    persisted;

  world.context
    .record =
    persisted;

  const manifest =
    objectValue(
      input.definition
        .published
        .manifest,
    );

  const extension =
    objectValue(
      manifest.extension,
    );

  const metadata =
    objectValue(
      extension.metadata,
    );

  const rawPixel =
    metadata[
      PIXEL_LOGIC_METADATA_KEY
    ];

  if (
    rawPixel
  ) {
    const pixel =
      normalizePixelLogicProgram(
        rawPixel,
        `${input.definition.responsibility.title} Logic`,
      );

    if (
      pixel.enabled
    ) {
      const variables =
        Object.fromEntries(
          pixel.variables.map(
            (variable) => [
              variable.key,
              variable.initialValue,
            ],
          ),
        );

      const result =
        runPixelLogic(
          pixel,
          {
            event: {
              name:
                "responsibility.action",

              actionId:
                possibility.action.id,

              at:
                new Date()
                  .toISOString(),

              payload: {
                record:
                  persisted,

                captures:
                  submitted,

                externalSessionId:
                  input.sessionId,

                responsibilityId:
                  input.definition
                    .responsibility.id,

                responsibilityKey:
                  input.definition
                    .responsibility.key,
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
                variables,
            },
          },
        );

      for (
        const pixelEffect of
        result.effects
      ) {
        const applied =
          await applyExternalEffect(
            db,
            {
              effect:
                pixelEffectToKernelEffect(
                  pixelEffect,
                ),

              definition:
                input.definition,

              world,

              payload:
                nextPayload,

              state:
                nextState,

              sessionId:
                input.sessionId,

              recordId:
                persisted.id,

              clientMutationId:
                input.clientMutationId,
            },
          );

        appliedEffects.push({
          source:
            "pixel_logic",

          nodeId:
            pixelEffect
              .nodeId,

          ...applied,
        });
      }
    }
  }

  nextPayload.__state =
    nextState;

  await db.execute(sql`
    UPDATE
      external_runtime_records

    SET
      status =
        ${
          nextState.process ??
          persisted.status
        },

      payload =
        ${JSON.stringify(
          nextPayload,
        )}::jsonb,

      updated_at =
        now()

    WHERE
      id =
        ${persisted.id}::uuid
  `);

  const response = {
    record: {
      id:
        persisted.id,

      status:
        nextState.process ??
        persisted.status,

      payload:
        nextPayload,
    },

    effects:
      appliedEffects,

    eventIds: [
      ...eventIds,
    ],
  };

  await db.execute(sql`
    INSERT INTO
      external_runtime_action_receipts (
        id,
        responsibility_id,
        external_session_id,
        client_mutation_id,
        response_payload,
        created_at,
        updated_at
      )

    VALUES (
      gen_random_uuid(),

      ${input.definition.responsibility.id},

      ${input.sessionId},

      ${input.clientMutationId},

      ${JSON.stringify(
        response,
      )}::jsonb,

      now(),
      now()
    )

    ON CONFLICT (
      responsibility_id,
      external_session_id,
      client_mutation_id
    )
    DO NOTHING
  `);

  return {
    ok:
      true as const,

    value:
      response,

    idempotent:
      false,
  };
}
