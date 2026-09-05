import express, {
  type Express,
  type Request,
} from "express";

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import {
  eq,
  sql,
} from "drizzle-orm";

import {
  withTenantSchema,
  type AppDatabase,
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
      )[part];
  }

  return current;
}


function header(
  req: Request,
  name: string,
) {
  const value =
    req.headers[
      name.toLowerCase()
    ];

  return Array.isArray(value)
    ? value[0] ??
      ""
    : String(
        value ??
        "",
      );
}


function signatureEqual(
  left: string,
  right: string,
) {
  const a =
    Buffer.from(
      left,
      "utf8",
    );

  const b =
    Buffer.from(
      right,
      "utf8",
    );

  return (
    a.length ===
      b.length &&
    timingSafeEqual(
      a,
      b,
    )
  );
}


function timestampMs(
  value: string,
) {
  if (
    /^\d+$/.test(
      value,
    )
  ) {
    const numeric =
      Number(
        value,
      );

    return numeric >
      10_000_000_000
      ? numeric
      : numeric *
        1000;
  }

  return Date.parse(
    value,
  );
}


async function publishedIntegration(
  db: AppDatabase,
  key: string,
) {
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

  const registry =
    objectValue(
      rows[0]
        ?.value,
    );

  const integrations =
    Array.isArray(
      registry.integrations,
    )
      ? registry.integrations
      : [];

  return (
    integrations
      .map(
        objectValue,
      )
      .find(
        (integration) =>
          integration.key ===
            key &&
          integration.status ===
            "published",
      ) ??
    null
  );
}


function verifyWebhook(
  req: Request,
  rawBody: Buffer,
  integration:
    Record<string, unknown>,
) {
  const webhook =
    objectValue(
      integration.webhook,
    );

  if (
    webhook.enabled !==
    true
  ) {
    throw new Error(
      "Webhook is not enabled for this Integration.",
    );
  }

  const signature =
    objectValue(
      webhook.signature,
    );

  const kind =
    String(
      signature.kind ??
      "",
    );

  if (
    ![
      "hmac_sha256_base64",
      "hmac_sha256_hex",
    ].includes(
      kind,
    )
  ) {
    throw new Error(
      "Unsupported webhook signature scheme.",
    );
  }

  const credentialKey =
    String(
      signature
        .credentialKey ??
      "",
    );

  const encrypted =
    objectValue(
      integration
        .encryptedCredentials,
    )[
      credentialKey
    ];

  if (
    typeof encrypted !==
      "string" ||
    !encrypted
  ) {
    throw new Error(
      "Webhook signing credential is not configured.",
    );
  }

  const secret =
    decryptSecretBox(
      encrypted,
      requiredSecret(
        "BRIXTA_INTEGRATION_SECRET_KEY",
      ),
    );

  const signatureHeader =
    String(
      signature
        .signatureHeader ??
      "",
    );

  const supplied =
    header(
      req,
      signatureHeader,
    )
      .replace(
        /^sha256=/i,
        "",
      )
      .trim();

  if (
    !supplied
  ) {
    throw new Error(
      "Webhook signature header is missing.",
    );
  }

  const timestampHeader =
    String(
      signature
        .timestampHeader ??
      "",
    );

  const timestamp =
    timestampHeader
      ? header(
          req,
          timestampHeader,
        )
      : "";

  if (
    timestampHeader
  ) {
    const tolerance =
      Math.max(
        30,
        Number(
          signature
            .toleranceSeconds ??
          300,
        ),
      ) *
      1000;

    const parsed =
      timestampMs(
        timestamp,
      );

    if (
      !Number.isFinite(
        parsed,
      ) ||
      Math.abs(
        Date.now() -
        parsed,
      ) >
        tolerance
    ) {
      throw new Error(
        "Webhook timestamp is outside the allowed tolerance.",
      );
    }
  }

  const mode =
    String(
      signature
        .signedPayload ??
      "body",
    );

  const body =
    rawBody.toString(
      "utf8",
    );

  const signed =
    mode ===
      "timestamp_body"
      ? `${timestamp}${body}`
      : mode ===
          "timestamp_dot_body"
        ? `${timestamp}.${body}`
        : body;

  const expected =
    createHmac(
      "sha256",
      secret,
    )
      .update(
        signed,
        "utf8",
      )
      .digest(
        kind ===
          "hmac_sha256_hex"
          ? "hex"
          : "base64",
      );

  if (
    !signatureEqual(
      supplied,
      expected,
    )
  ) {
    throw new Error(
      "Webhook signature verification failed.",
    );
  }

  return webhook;
}


export default function setupIntegrationWebhookRoutes(
  app: Express,
) {
  /*
   * MUST be registered BEFORE global express.json().
   */
  app.post(
    "/api/integrations/webhooks/:tenant/:integrationKey",

    express.raw({
      type:
        "*/*",

      limit:
        "512kb",
    }),

    async (
      req,
      res,
    ) => {
      const tenant =
        String(
          req.params.tenant,
        );

      const integrationKey =
        String(
          req.params
            .integrationKey,
        );

      if (
        !/^[a-z][a-z0-9_]{0,62}$/.test(
          tenant,
        ) ||
        !/^[a-z][a-z0-9_]*$/.test(
          integrationKey,
        )
      ) {
        return res
          .status(404)
          .json({
            success:
              false,
          });
      }

      const rawBody =
        Buffer.isBuffer(
          req.body,
        )
          ? req.body
          : Buffer.from(
              "",
            );

      try {
        const result =
          await withTenantSchema(
            tenant,
            async (
              db,
            ) => {
              const integration =
                await publishedIntegration(
                  db,
                  integrationKey,
                );

              if (
                !integration
              ) {
                return {
                  status:
                    404,

                  body: {
                    success:
                      false,

                    error:
                      "Integration not found.",
                  },
                };
              }

              const webhook =
                verifyWebhook(
                  req,
                  rawBody,
                  integration,
                );

              let payload:
                unknown;

              try {
                payload =
                  JSON.parse(
                    rawBody.toString(
                      "utf8",
                    ),
                  );
              } catch {
                return {
                  status:
                    400,

                  body: {
                    success:
                      false,

                    error:
                      "Webhook body must be JSON.",
                  },
                };
              }

              const event =
                objectValue(
                  webhook.event,
                );

              const eventId =
                String(
                  (
                    event.eventIdPath
                      ? readPath(
                          payload,
                          String(
                            event.eventIdPath,
                          ),
                        )
                      : null
                  ) ??
                  createHash(
                    "sha256",
                  )
                    .update(
                      rawBody,
                    )
                    .digest(
                      "hex",
                    ),
                );

              const providerReference =
                String(
                  readPath(
                    payload,
                    String(
                      event.referencePath ??
                      "",
                    ),
                  ) ??
                  "",
                );

              const providerStatus =
                String(
                  readPath(
                    payload,
                    String(
                      event.statusPath ??
                      "",
                    ),
                  ) ??
                  "",
                );

              const fallbackProviderStatus =
                String(
                  event.fallbackStatusPath
                    ? readPath(
                        payload,
                        String(
                          event.fallbackStatusPath,
                        ),
                      )
                    : "",
                );

              const statusMap =
                objectValue(
                  event.statusMap,
                );

              const mapped =
                String(
                  statusMap[
                    providerStatus
                  ] ??
                  statusMap[
                    providerStatus
                      .toLowerCase()
                  ] ??
                  statusMap[
                    fallbackProviderStatus
                  ] ??
                  statusMap[
                    fallbackProviderStatus
                      .toLowerCase()
                  ] ??
                  "",
                );

              if (
                ![
                  "processing",
                  "paid",
                  "failed",
                  "reversed",
                ].includes(
                  mapped,
                )
              ) {
                return {
                  status:
                    202,

                  body: {
                    success:
                      true,

                    ignored:
                      true,

                    reason:
                      "unmapped_status",
                  },
                };
              }

              const inserted =
                await db.execute(sql`
                  INSERT INTO
                    integration_webhook_events (
                      id,
                      integration_key,
                      event_id,
                      provider_reference,
                      status,
                      payload,
                      received_at
                    )

                  VALUES (
                    gen_random_uuid(),

                    ${integrationKey},

                    ${eventId},

                    ${providerReference || null},

                    ${mapped},

                    ${JSON.stringify(
                      payload,
                    )}::jsonb,

                    now()
                  )

                  ON CONFLICT (
                    integration_key,
                    event_id
                  )
                  DO NOTHING

                  RETURNING
                    id
                `);

              if (
                inserted.rows.length ===
                0
              ) {
                return {
                  status:
                    200,

                  body: {
                    success:
                      true,

                    duplicate:
                      true,
                  },
                };
              }

              const referenceTarget =
                String(
                  event.referenceTarget ??
                  "provider_transfer_ref",
                );

              if (
                providerReference
              ) {
                if (
                  referenceTarget ===
                  "request_id"
                ) {
                  await db.execute(sql`
                    UPDATE
                      qr_reward_payouts

                    SET
                      status =
                        ${mapped},

                      paid_at =
                        CASE
                          WHEN ${mapped} = 'paid'
                          THEN COALESCE(
                            paid_at,
                            now()
                          )
                          ELSE paid_at
                        END,

                      reversed_at =
                        CASE
                          WHEN ${mapped} = 'reversed'
                          THEN COALESCE(
                            reversed_at,
                            now()
                          )
                          ELSE reversed_at
                        END,

                      provider_response =
                        ${JSON.stringify(
                          payload,
                        )}::jsonb,

                      updated_at =
                        now()

                    WHERE
                      request_id =
                        ${providerReference}
                  `);
                } else {
                  await db.execute(sql`
                    UPDATE
                      qr_reward_payouts

                    SET
                      status =
                        ${mapped},

                      paid_at =
                        CASE
                          WHEN ${mapped} = 'paid'
                          THEN COALESCE(
                            paid_at,
                            now()
                          )
                          ELSE paid_at
                        END,

                      reversed_at =
                        CASE
                          WHEN ${mapped} = 'reversed'
                          THEN COALESCE(
                            reversed_at,
                            now()
                          )
                          ELSE reversed_at
                        END,

                      provider_response =
                        ${JSON.stringify(
                          payload,
                        )}::jsonb,

                      updated_at =
                        now()

                    WHERE
                      provider_transfer_ref =
                        ${providerReference}
                  `);
                }
              }

              return {
                status:
                  200,

                body: {
                  success:
                    true,

                  eventId,

                  status:
                    mapped,
                },
              };
            },
          );

        return res
          .status(
            result.status,
          )
          .json(
            result.body,
          );
      } catch (
        error
      ) {
        console.error(
          "Integration webhook failed:",
          error,
        );

        return res
          .status(401)
          .json({
            success:
              false,

            error:
              "Webhook verification failed.",
          });
      }
    },
  );
}
