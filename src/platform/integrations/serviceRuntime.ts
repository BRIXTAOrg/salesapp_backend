import {
  lookup,
} from "node:dns/promises";

import {
  isIP,
} from "node:net";

import {
  eq,
  sql,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../../db/db";

import {
  pool,
  withTenantSchema,
} from "../../db/db";

import {
  platformMeta,
} from "../../db/platformVNextSchema";

import {
  decryptSecretBox,
  requiredSecret,
} from "../security/secretBox";


const REGISTRY_KEY =
  "api_integration_registry_v1";


type CredentialField = {
  key: string;
  label?: string;

  kind:
    | "header"
    | "bearer";

  headerName?: string;

  required?: boolean;
};


type IntegrationOperation = {
  id: string;
  label?: string;

  capability:
    string;

  method:
    | "GET"
    | "POST"
    | "PUT"
    | "PATCH"
    | "DELETE";

  path:
    string;

  staticHeaders?:
    Record<string, string>;

  /*
   * These are backend-ready optional fields.
   *
   * CMS Integration V1 can add them next without changing
   * this runtime contract.
   */
  requestTemplate?:
    unknown;

  queryTemplate?:
    Record<string, unknown>;

  responseMapping?:
    Record<string, string>;

  idempotencyHeader?:
    string;
};


type StoredIntegration = {
  id: string;
  key: string;
  name: string;

  baseUrl:
    string;

  status:
    string;

  auth?: {
    credentialFields?:
      CredentialField[];
  };

  operations?:
    IntegrationOperation[];

  encryptedCredentials?:
    Record<string, string>;
};


type IntegrationRegistry = {
  version?:
    number;

  integrations?:
    StoredIntegration[];
};


export type PublishedServiceBinding = {
  integrationId:
    string;

  integrationKey:
    string;

  integrationName:
    string;

  baseUrl:
    string;

  operation:
    IntegrationOperation;

  credentialFields:
    CredentialField[];

  credentials:
    Record<string, string>;
};


export type ServiceResult = {
  ok:
    true;

  capability:
    string;

  provider:
    string;

  integrationId?:
    string;

  operationId?:
    string;

  httpStatus:
    number;

  data:
    unknown;

  mapped:
    Record<string, unknown>;
};


export type ServiceQueueRecord = {
  id:
    string;

  capability:
    string;

  status:
    string;

  idempotencyKey:
    string;
};


export class ProviderExecutionError
extends Error {
  readonly retryable:
    boolean;

  readonly status?:
    number;

  constructor(
    message: string,
    options: {
      retryable?: boolean;
      status?: number;
    } = {},
  ) {
    super(message);

    this.name =
      "ProviderExecutionError";

    this.retryable =
      options.retryable ===
      true;

    this.status =
      options.status;
  }
}


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


function readPath(
  value: unknown,
  path: string,
) {
  if (
    !path
  ) {
    return value;
  }

  let current =
    value;

  for (
    const part of
    path
      .split(".")
      .filter(Boolean)
  ) {
    if (
      !current ||
      typeof current !==
        "object"
    ) {
      return undefined;
    }

    current =
      (
        current as
        Record<string, unknown>
      )[
        part
      ];
  }

  return current;
}


async function readRegistry(
  db: AppDatabase,
): Promise<
  IntegrationRegistry
> {
  const rows =
    await db
      .select({
        value:
          platformMeta.value,
      })
      .from(
        platformMeta,
      )
      .where(
        eq(
          platformMeta.key,
          REGISTRY_KEY,
        ),
      )
      .limit(1);

  const raw =
    objectValue(
      rows[0]
        ?.value,
    );

  return {
    version:
      Number(
        raw.version ??
        1,
      ),

    integrations:
      Array.isArray(
        raw.integrations,
      )
        ? raw.integrations as
            StoredIntegration[]
        : [],
  };
}


export async function listPublishedCapabilities(
  db: AppDatabase,
) {
  const registry =
    await readRegistry(
      db,
    );

  return [
    ...new Set(
      (
        registry.integrations ??
        []
      )
        .filter(
          (integration) =>
            integration.status ===
            "published",
        )
        .flatMap(
          (integration) =>
            integration.operations ??
            [],
        )
        .map(
          (operation) =>
            String(
              operation.capability ??
              "",
            ).trim(),
        )
        .filter(Boolean),
    ),
  ].sort();
}


export async function resolvePublishedCapability(
  db: AppDatabase,
  capability: string,
): Promise<
  PublishedServiceBinding | null
> {
  const wanted =
    capability.trim();

  const registry =
    await readRegistry(
      db,
    );

  const matches:
    Array<{
      integration:
        StoredIntegration;

      operation:
        IntegrationOperation;
    }> = [];


  for (
    const integration of
    registry.integrations ??
    []
  ) {
    if (
      integration.status !==
      "published"
    ) {
      continue;
    }

    for (
      const operation of
      integration.operations ??
      []
    ) {
      if (
        String(
          operation.capability,
        ).trim() ===
        wanted
      ) {
        matches.push({
          integration,
          operation,
        });
      }
    }
  }


  if (
    matches.length ===
    0
  ) {
    return null;
  }

  if (
    matches.length >
    1
  ) {
    throw new Error(
      `Capability "${wanted}" has multiple published provider bindings.`,
    );
  }


  const {
    integration,
    operation,
  } =
    matches[0];

  const credentialFields =
    integration.auth
      ?.credentialFields ??
    [];

  const credentials:
    Record<string, string> =
    {};


  if (
    credentialFields.length
  ) {
    /*
     * Deliberately NO JWT_SECRET fallback.
     *
     * CMS + backend must share this dedicated Integration key.
     */
    const material =
      requiredSecret(
        "BRIXTA_INTEGRATION_SECRET_KEY",
      );

    for (
      const field of
      credentialFields
    ) {
      const encrypted =
        integration
          .encryptedCredentials
          ?.[field.key];

      if (
        !encrypted
      ) {
        if (
          field.required !==
          false
        ) {
          throw new Error(
            `Integration credential "${field.label ?? field.key}" is missing.`,
          );
        }

        continue;
      }

      credentials[
        field.key
      ] =
        decryptSecretBox(
          encrypted,
          material,
        );
    }
  }


  return {
    integrationId:
      integration.id,

    integrationKey:
      integration.key,

    integrationName:
      integration.name,

    baseUrl:
      integration.baseUrl,

    operation,

    credentialFields,

    credentials,
  };
}


function isPrivateIp(
  address: string,
) {
  const version =
    isIP(
      address,
    );

  if (
    version === 4
  ) {
    const [
      a,
      b,
    ] =
      address
        .split(".")
        .map(Number);

    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (
        a === 100 &&
        b >= 64 &&
        b <= 127
      ) ||
      (
        a === 169 &&
        b === 254
      ) ||
      (
        a === 172 &&
        b >= 16 &&
        b <= 31
      ) ||
      (
        a === 192 &&
        b === 168
      ) ||
      a >= 224
    );
  }


  if (
    version === 6
  ) {
    const lower =
      address
        .toLowerCase();

    return (
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80:")
    );
  }


  return false;
}


async function validateBaseUrl(
  raw: string,
) {
  const url =
    new URL(
      raw,
    );


  if (
    ![
      "https:",
      "http:",
    ].includes(
      url.protocol,
    )
  ) {
    throw new Error(
      "Integration URL must use HTTP or HTTPS.",
    );
  }


  if (
    process.env.NODE_ENV ===
      "production" &&
    url.protocol !==
      "https:"
  ) {
    throw new Error(
      "Production integrations must use HTTPS.",
    );
  }


  if (
    url.username ||
    url.password
  ) {
    throw new Error(
      "Integration URL must not contain embedded credentials.",
    );
  }


  if (
    process.env
      .BRIXTA_ALLOW_PRIVATE_INTEGRATIONS ===
    "1"
  ) {
    return url;
  }


  const hostname =
    url.hostname
      .replace(
        /^\[|\]$/g,
        "",
      )
      .toLowerCase();


  if (
    hostname ===
      "localhost" ||
    hostname.endsWith(
      ".local",
    )
  ) {
    throw new Error(
      "Private integration host blocked.",
    );
  }


  const addresses =
    isIP(
      hostname,
    )
      ? [
          {
            address:
              hostname,
          },
        ]
      : await lookup(
          hostname,
          {
            all:
              true,
          },
        );


  if (
    addresses.some(
      (item) =>
        isPrivateIp(
          item.address,
        ),
    )
  ) {
    throw new Error(
      "Integration host resolves to a private/internal IP.",
    );
  }


  return url;
}


function templateExpression(
  expression: string,
  input: unknown,
  idempotencyKey: string,
) {
  const clean =
    expression.trim();

  if (
    clean ===
    "idempotencyKey"
  ) {
    return idempotencyKey;
  }

  if (
    clean ===
    "input"
  ) {
    return input;
  }

  if (
    clean.startsWith(
      "input.",
    )
  ) {
    return readPath(
      input,
      clean.slice(
        "input.".length,
      ),
    );
  }

  /*
   * Convenience:
   *
   * {transferId}
   *
   * resolves from:
   *
   * input.transferId
   * input.pathParams.transferId
   */
  return (
    readPath(
      input,
      clean,
    ) ??
    readPath(
      input,
      `pathParams.${clean}`,
    )
  );
}


function renderTemplate(
  value: unknown,
  input: unknown,
  idempotencyKey: string,
): unknown {
  if (
    typeof value ===
    "string"
  ) {
    const exact =
      value.match(
        /^\{\{\s*([^}]+)\s*\}\}$/,
      );

    if (
      exact
    ) {
      return templateExpression(
        exact[1],
        input,
        idempotencyKey,
      );
    }


    return value.replace(
      /\{\{\s*([^}]+)\s*\}\}/g,
      (
        _match,
        expression,
      ) => {
        const result =
          templateExpression(
            String(
              expression,
            ),
            input,
            idempotencyKey,
          );

        return result ===
          undefined ||
          result ===
          null
          ? ""
          : String(
              result,
            );
      },
    );
  }


  if (
    Array.isArray(
      value,
    )
  ) {
    return value.map(
      (item) =>
        renderTemplate(
          item,
          input,
          idempotencyKey,
        ),
    );
  }


  if (
    value &&
    typeof value ===
      "object"
  ) {
    return Object.fromEntries(
      Object.entries(
        value as
          Record<string, unknown>,
      ).map(
        (
          [
            key,
            child,
          ],
        ) => [
          key,
          renderTemplate(
            child,
            input,
            idempotencyKey,
          ),
        ],
      ),
    );
  }


  return value;
}


function operationPath(
  path: string,
  input: unknown,
  idempotencyKey: string,
) {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("://")
  ) {
    throw new Error(
      "Integration operation path must be relative and begin with '/'.",
    );
  }


  let rendered =
    path.replace(
      /\{\{\s*([^}]+)\s*\}\}/g,
      (
        _match,
        expression,
      ) => {
        const value =
          templateExpression(
            String(
              expression,
            ),
            input,
            idempotencyKey,
          );

        if (
          value ===
          undefined ||
          value ===
          null
        ) {
          throw new Error(
            `Missing path value: ${String(expression)}`,
          );
        }

        return encodeURIComponent(
          String(
            value,
          ),
        );
      },
    );


  rendered =
    rendered.replace(
      /\{([a-zA-Z0-9_.-]+)\}/g,
      (
        _match,
        expression,
      ) => {
        const value =
          templateExpression(
            String(
              expression,
            ),
            input,
            idempotencyKey,
          );

        if (
          value ===
          undefined ||
          value ===
          null
        ) {
          throw new Error(
            `Missing path parameter: ${String(expression)}`,
          );
        }

        return encodeURIComponent(
          String(
            value,
          ),
        );
      },
    );


  return rendered;
}


const FORBIDDEN_HEADERS =
  new Set([
    "host",
    "connection",
    "content-length",
    "transfer-encoding",
    "cookie",
    "set-cookie",
  ]);


export async function executePublishedService(
  binding:
    PublishedServiceBinding,
  input: unknown,
  idempotencyKey: string,
): Promise<
  ServiceResult
> {
  const base =
    await validateBaseUrl(
      binding.baseUrl,
    );

  const operation =
    binding.operation;

  const path =
    operationPath(
      operation.path,
      input,
      idempotencyKey,
    );

  const url =
    new URL(
      path.replace(
        /^\/+/,
        "",
      ),
      `${base
        .toString()
        .replace(
          /\/+$/,
          "",
        )}/`,
    );


  if (
    operation.queryTemplate
  ) {
    const query =
      objectValue(
        renderTemplate(
          operation.queryTemplate,
          input,
          idempotencyKey,
        ),
      );

    for (
      const [
        key,
        value,
      ] of
      Object.entries(
        query,
      )
    ) {
      if (
        value !==
          undefined &&
        value !==
          null
      ) {
        url.searchParams.set(
          key,
          String(
            value,
          ),
        );
      }
    }
  }


  const headers =
    new Headers();


  for (
    const [
      key,
      value,
    ] of
    Object.entries(
      operation.staticHeaders ??
      {},
    )
  ) {
    if (
      !FORBIDDEN_HEADERS.has(
        key.toLowerCase(),
      )
    ) {
      headers.set(
        key,
        value,
      );
    }
  }


  /*
   * Authentication is applied LAST.
   * Pixel/browser input cannot overwrite it.
   */
  for (
    const field of
    binding.credentialFields
  ) {
    const credential =
      binding.credentials[
        field.key
      ];

    if (
      !credential
    ) {
      continue;
    }

    if (
      field.kind ===
      "bearer"
    ) {
      headers.set(
        "authorization",
        `Bearer ${credential}`,
      );
    } else if (
      field.headerName
    ) {
      headers.set(
        field.headerName,
        credential,
      );
    }
  }


  if (
    operation.idempotencyHeader
  ) {
    headers.set(
      operation.idempotencyHeader,
      idempotencyKey,
    );
  }


  const method =
    operation.method;

  const mayHaveBody =
    ![
      "GET",
      "DELETE",
    ].includes(
      method,
    );


  const providerBody =
    operation.requestTemplate !==
      undefined
      ? renderTemplate(
          operation.requestTemplate,
          input,
          idempotencyKey,
        )
      : input;


  let body:
    string | undefined;


  if (
    mayHaveBody &&
    providerBody !==
      undefined
  ) {
    body =
      typeof providerBody ===
        "string"
        ? providerBody
        : JSON.stringify(
            providerBody,
          );

    if (
      Buffer.byteLength(
        body,
        "utf8",
      ) >
      256 * 1024
    ) {
      throw new Error(
        "Provider request body exceeds 256 KiB.",
      );
    }

    if (
      !headers.has(
        "content-type",
      )
    ) {
      headers.set(
        "content-type",
        "application/json",
      );
    }
  }


  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      20_000,
    );


  try {
    const response =
      await fetch(
        url,
        {
          method,
          headers,
          body,
          signal:
            controller.signal,

          /*
           * A provider redirect is not silently followed.
           */
          redirect:
            "manual",
        },
      );


    const raw =
      (
        await response.text()
      ).slice(
        0,
        256 * 1024,
      );


    let data:
      unknown =
      raw;


    try {
      data =
        raw
          ? JSON.parse(
              raw,
            )
          : null;
    } catch {
      // Preserve text body.
    }


    if (
      !response.ok
    ) {
      throw new ProviderExecutionError(
        `Provider returned HTTP ${response.status}.`,
        {
          status:
            response.status,

          retryable:
            response.status ===
              408 ||
            response.status ===
              409 ||
            response.status ===
              425 ||
            response.status ===
              429 ||
            response.status >=
              500,
        },
      );
    }


    const mapped =
      Object.fromEntries(
        Object.entries(
          operation.responseMapping ??
          {},
        ).map(
          (
            [
              key,
              path,
            ],
          ) => [
            key,
            readPath(
              data,
              path,
            ),
          ],
        ),
      );


    return {
      ok:
        true,

      capability:
        operation.capability,

      provider:
        binding.integrationKey,

      integrationId:
        binding.integrationId,

      operationId:
        operation.id,

      httpStatus:
        response.status,

      data,

      mapped,
    };
  } catch (
    error
  ) {
    if (
      error instanceof
      ProviderExecutionError
    ) {
      throw error;
    }

    const aborted =
      error instanceof
        Error &&
      error.name ===
        "AbortError";

    throw new ProviderExecutionError(
      aborted
        ? "Provider request timed out."
        : error instanceof
            Error
          ? error.message
          : "Provider execution failed.",
      {
        retryable:
          true,
      },
    );
  } finally {
    clearTimeout(
      timer,
    );
  }
}


export async function enqueueServiceRequest(
  db: AppDatabase,
  input: {
    capability:
      string;

    request:
      unknown;

    idempotencyKey:
      string;

    source?:
      Record<string, unknown>;
  },
): Promise<
  ServiceQueueRecord
> {
  const capability =
    input.capability
      .trim();

  const idempotencyKey =
    input.idempotencyKey
      .trim()
      .slice(
        0,
        220,
      );


  if (
    !capability ||
    !idempotencyKey
  ) {
    throw new Error(
      "Service capability and idempotency key are required.",
    );
  }


  const result =
    await db.execute(sql`
      INSERT INTO
        integration_service_requests (
          id,
          capability,
          request_payload,
          source_metadata,
          idempotency_key,
          status,
          attempts,
          next_attempt_at,
          created_at,
          updated_at
        )

      VALUES (
        gen_random_uuid(),
        ${capability},
        ${JSON.stringify(
          input.request ??
          {},
        )}::jsonb,
        ${JSON.stringify(
          input.source ??
          {},
        )}::jsonb,
        ${idempotencyKey},
        'queued',
        0,
        now(),
        now(),
        now()
      )

      ON CONFLICT (
        idempotency_key
      )
      DO UPDATE
      SET
        updated_at =
          integration_service_requests.updated_at

      RETURNING
        id,
        capability,
        status,

        idempotency_key
          AS "idempotencyKey"
    `);


  const row =
    result.rows[0] as
      | ServiceQueueRecord
      | undefined;


  if (
    !row
  ) {
    throw new Error(
      "Unable to enqueue service request.",
    );
  }


  return row;
}


export type ServiceAdapter = {
  prepareInput?: (
    db: AppDatabase,
    input: unknown,
  ) => Promise<unknown>;

  executeInternal?: (
    db: AppDatabase,
    input: unknown,
    idempotencyKey: string,
  ) => Promise<
    ServiceResult
  >;

  /*
   * true:
   *   use internal BRIXTA implementation.
   *
   * false:
   *   external published Integration is REQUIRED.
   *
   * undefined:
   *   external if available, otherwise internal.
   */
  preferInternal?:
    () =>
      boolean;

  applyResult?: (
    db: AppDatabase,
    input: unknown,
    result: ServiceResult,
  ) => Promise<void>;

  applyError?: (
    db: AppDatabase,
    input: unknown,
    error: Error,
    terminal: boolean,
  ) => Promise<void>;
};


const SERVICE_ADAPTERS =
  new Map<
    string,
    ServiceAdapter
  >();


export function registerServiceAdapter(
  capability: string,
  adapter: ServiceAdapter,
) {
  SERVICE_ADAPTERS.set(
    capability,
    adapter,
  );
}


type QueueRow = {
  id:
    string;

  capability:
    string;

  requestPayload:
    unknown;

  idempotencyKey:
    string;

  attempts:
    number;
};


async function queueSchemas() {
  const result =
    await pool.query<{
      schema:
        string;
    }>(`
      SELECT DISTINCT
        table_schema
          AS schema

      FROM
        information_schema.tables

      WHERE
        table_name =
          'integration_service_requests'

        AND
        table_schema NOT IN (
          'pg_catalog',
          'information_schema'
        )

      ORDER BY
        table_schema
    `);


  return result.rows
    .map(
      (row) =>
        row.schema,
    )
    .filter(
      (schema) =>
        /^[a-z][a-z0-9_]{0,62}$/.test(
          schema,
        ),
    );
}


async function claimQueueRows(
  schema: string,
) {
  return withTenantSchema(
    schema,
    async (
      db,
    ) => {
      const result =
        await db.execute(sql`
          WITH picked AS (
            SELECT
              id

            FROM
              integration_service_requests

            WHERE
              status IN (
                'queued',
                'retry'
              )

              AND
              next_attempt_at <=
                now()

              AND
              attempts <
                5

            ORDER BY
              created_at

            FOR UPDATE
              SKIP LOCKED

            LIMIT 10
          )

          UPDATE
            integration_service_requests
              AS request

          SET
            status =
              'processing',

            attempts =
              request.attempts +
              1,

            updated_at =
              now()

          FROM
            picked

          WHERE
            request.id =
              picked.id

          RETURNING
            request.id,
            request.capability,

            request.request_payload
              AS "requestPayload",

            request.idempotency_key
              AS "idempotencyKey",

            request.attempts
        `);


      return result.rows as
        unknown as
        QueueRow[];
    },
  );
}


async function markSuccess(
  schema: string,
  row: QueueRow,
  result: ServiceResult,
) {
  await withTenantSchema(
    schema,
    async (
      db,
    ) => {
      await db.execute(sql`
        UPDATE
          integration_service_requests

        SET
          status =
            'succeeded',

          response_payload =
            ${JSON.stringify(
              result,
            )}::jsonb,

          last_error =
            NULL,

          completed_at =
            now(),

          updated_at =
            now()

        WHERE
          id =
            ${row.id}::uuid
      `);
    },
  );
}


async function markFailure(
  schema: string,
  row: QueueRow,
  error: Error,
  retryable: boolean,
) {
  const terminal =
    !retryable ||
    row.attempts >=
      5;

  const retrySeconds =
    Math.min(
      300,
      Math.max(
        2,
        2 ** row.attempts,
      ),
    );


  await withTenantSchema(
    schema,
    async (
      db,
    ) => {
      await db.execute(sql`
        UPDATE
          integration_service_requests

        SET
          status =
            ${
              terminal
                ? "failed"
                : "retry"
            },

          last_error =
            ${error.message.slice(
              0,
              4000,
            )},

          next_attempt_at =
            now() +
            make_interval(
              secs =>
                ${retrySeconds}
            ),

          completed_at =
            ${
              terminal
                ? new Date()
                : null
            },

          updated_at =
            now()

        WHERE
          id =
            ${row.id}::uuid
      `);
    },
  );


  return terminal;
}


async function executeQueueRow(
  schema: string,
  row: QueueRow,
) {
  const adapter =
    SERVICE_ADAPTERS.get(
      row.capability,
    );


  const prepared =
    await withTenantSchema(
      schema,
      async (
        db,
      ) => {
        const request =
          adapter
            ?.prepareInput
            ? await adapter
                .prepareInput(
                  db,
                  row.requestPayload,
                )
            : row
                .requestPayload;

        const external =
          await resolvePublishedCapability(
            db,
            row.capability,
          );

        return {
          request,
          external,
        };
      },
    );


  const preference =
    adapter
      ?.preferInternal?.();


  let result:
    ServiceResult;


  if (
    preference ===
      true
  ) {
    if (
      !adapter
        ?.executeInternal
    ) {
      throw new ProviderExecutionError(
        `Capability "${row.capability}" has no internal implementation.`,
        {
          retryable:
            false,
        },
      );
    }

    result =
      await withTenantSchema(
        schema,
        (db) =>
          adapter
            .executeInternal!(
              db,
              prepared.request,
              row.idempotencyKey,
            ),
      );
  } else if (
    prepared.external
  ) {
    result =
      await executePublishedService(
        prepared.external,
        prepared.request,
        row.idempotencyKey,
      );
  } else if (
    preference ===
      false
  ) {
    throw new ProviderExecutionError(
      `No published API Integration is bound to "${row.capability}".`,
      {
        retryable:
          false,
      },
    );
  } else if (
    adapter
      ?.executeInternal
  ) {
    result =
      await withTenantSchema(
        schema,
        (db) =>
          adapter
            .executeInternal!(
              db,
              prepared.request,
              row.idempotencyKey,
            ),
      );
  } else {
    throw new ProviderExecutionError(
      `No implementation is bound to "${row.capability}".`,
      {
        retryable:
          false,
      },
    );
  }


  if (
    adapter
      ?.applyResult
  ) {
    await withTenantSchema(
      schema,
      (db) =>
        adapter
          .applyResult!(
            db,
            prepared.request,
            result,
          ),
    );
  }


  await markSuccess(
    schema,
    row,
    result,
  );
}


let workerStarted =
  false;

let workerBusy =
  false;


async function workerTick() {
  if (
    workerBusy
  ) {
    return;
  }

  workerBusy =
    true;


  try {
    const schemas =
      await queueSchemas();


    for (
      const schema of
      schemas
    ) {
      const rows =
        await claimQueueRows(
          schema,
        );


      for (
        const row of
        rows
      ) {
        try {
          await executeQueueRow(
            schema,
            row,
          );
        } catch (
          error
        ) {
          const normalized =
            error instanceof
              Error
              ? error
              : new Error(
                  "Service execution failed.",
                );

          const retryable =
            error instanceof
              ProviderExecutionError
              ? error.retryable
              : true;

          const terminal =
            !retryable ||
            row.attempts >=
              5;

          const adapter =
            SERVICE_ADAPTERS.get(
              row.capability,
            );


          if (
            adapter
              ?.applyError
          ) {
            try {
              await withTenantSchema(
                schema,
                (db) =>
                  adapter
                    .applyError!(
                      db,
                      row.requestPayload,
                      normalized,
                      terminal,
                    ),
              );
            } catch (
              applyError
            ) {
              console.error(
                "Service error adapter failed:",
                applyError,
              );
            }
          }


          await markFailure(
            schema,
            row,
            normalized,
            retryable,
          );
        }
      }
    }
  } catch (
    error
  ) {
    console.error(
      "Integration worker failed:",
      error,
    );
  } finally {
    workerBusy =
      false;
  }
}


export function startIntegrationServiceWorker() {
  if (
    workerStarted
  ) {
    return;
  }


  const enabled =
    process.env
      .BRIXTA_INTEGRATION_WORKER ===
      "1" ||
    process.env
      .BRIXTA_BACKEND_EDITION ===
      "qr-voucher-rewards";


  if (
    !enabled
  ) {
    return;
  }


  workerStarted =
    true;


  const interval =
    setInterval(
      () => {
        void workerTick();
      },
      3_000,
    );

  interval.unref();


  const initial =
    setTimeout(
      () => {
        void workerTick();
      },
      500,
    );

  initial.unref();


  console.log(
    " Integration service worker: ENABLED",
  );
}
