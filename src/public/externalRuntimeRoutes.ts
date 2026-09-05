import type {
  Express,
  Request,
} from "express";

import {
  withTenantSchema,
} from "../db/db";

import {
  verifyMobileToken,
} from "../auth/jwt";

import {
  consumePublicRateLimit,
} from "./rateLimit";

import {
  createExternalSession,
  verifyExternalSession,
} from "./externalSession";

import {
  executeExternalRuntimeAction,
  loadExternalRuntimeDefinition,
  publicRuntimeContract,
} from "./externalActionRuntime";


function validTenant(
  value: string,
) {
  return /^[a-z][a-z0-9_]{0,62}$/.test(
    value,
  );
}


function optionalAppUser(
  req: Request,
  tenant: string,
) {
  const auth =
    String(
      req.headers
        .authorization ??
      "",
    ).trim();

  if (!auth) {
    return null;
  }

  if (
    !auth.startsWith(
      "Bearer ",
    )
  ) {
    throw new Error(
      "INVALID_AUTH",
    );
  }

  const session =
    verifyMobileToken(
      auth
        .slice(
          "Bearer ".length,
        )
        .trim(),
    );

  if (
    session.schemaName !==
    tenant
  ) {
    throw new Error(
      "TENANT_MISMATCH",
    );
  }

  return session.userId;
}


function clientIdentity(
  req: Request,
) {
  return (
    req.ip ||
    req.socket
      .remoteAddress ||
    "unknown"
  );
}


export default function setupPublicExternalRuntimeRoutes(
  app: Express,
) {
  app.get(
    "/api/public/runtime/:tenant/:responsibilityKey",
    async (
      req,
      res,
    ) => {
      const tenant =
        String(
          req.params.tenant,
        );

      const responsibilityKey =
        String(
          req.params
            .responsibilityKey,
        );

      if (
        !validTenant(
          tenant,
        )
      ) {
        return res
          .status(404)
          .json({
            success:
              false,

            error:
              "Not found.",
          });
      }

      try {
        let userId:
          number | null =
          null;

        try {
          userId =
            optionalAppUser(
              req,
              tenant,
            );
        } catch {
          return res
            .status(401)
            .json({
              success:
                false,

              error:
                "Invalid BRIXTA session.",
            });
        }

        const result =
          await withTenantSchema(
            tenant,
            async (
              db,
            ) => {
              const rate =
                await consumePublicRateLimit(
                  db,
                  {
                    scope:
                      `external-manifest:${responsibilityKey}`,

                    identity:
                      clientIdentity(
                        req,
                      ),

                    limit:
                      180,

                    windowSeconds:
                      60,
                  },
                );

              if (
                !rate.allowed
              ) {
                return {
                  status:
                    429,

                  body: {
                    success:
                      false,

                    error:
                      "Too many requests.",
                  },
                };
              }

              const definition =
                await loadExternalRuntimeDefinition(
                  db,
                  tenant,
                  responsibilityKey,
                );

              if (
                !definition
              ) {
                return {
                  status:
                    404,

                  body: {
                    success:
                      false,

                    error:
                      "Public runtime not found.",
                  },
                };
              }

              const access =
                String(
                  definition
                    .delivery
                    .access ??
                  "",
                );

              if (
                access ===
                  "required_auth" &&
                !userId
              ) {
                return {
                  status:
                    401,

                  body: {
                    success:
                      false,

                    error:
                      "BRIXTA authentication is required.",
                  },
                };
              }

              const existing =
                verifyExternalSession(
                  String(
                    req.headers[
                      "x-brixta-external-session"
                    ] ??
                    "",
                  ),
                );

              const external =
                (
                  existing &&
                  existing.tenant ===
                    tenant &&
                  existing
                    .responsibilityKey ===
                    responsibilityKey &&
                  Number(
                    existing.userId ??
                    0,
                  ) ===
                    Number(
                      userId ??
                      0,
                    )
                )
                  ? {
                      token:
                        String(
                          req.headers[
                            "x-brixta-external-session"
                          ],
                        ),

                      payload:
                        existing,
                    }
                  : createExternalSession({
                      tenant,

                      responsibilityKey,

                      userId,
                    });

              return {
                status:
                  200,

                body: {
                  success:
                    true,

                  runtime:
                    publicRuntimeContract(
                      definition,
                    ),

                  session: {
                    token:
                      external.token,

                    id:
                      external
                        .payload
                        .sessionId,

                    expiresAt:
                      new Date(
                        external
                          .payload
                          .exp *
                        1000,
                      )
                        .toISOString(),

                    authenticatedUserId:
                      external
                        .payload
                        .userId ??
                      null,
                  },
                },
              };
            },
          );

        res.setHeader(
          "Cache-Control",
          "no-store",
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
          "External runtime failed:",
          error,
        );

        return res
          .status(500)
          .json({
            success:
              false,

            error:
              "Unable to load external runtime.",
          });
      }
    },
  );


  app.post(
    "/api/public/runtime/:tenant/:responsibilityKey/actions/:actionId",
    async (
      req,
      res,
    ) => {
      const tenant =
        String(
          req.params.tenant,
        );

      const responsibilityKey =
        String(
          req.params
            .responsibilityKey,
        );

      if (
        !validTenant(
          tenant,
        )
      ) {
        return res
          .status(404)
          .json({
            success:
              false,

            error:
              "Not found.",
          });
      }

      const external =
        verifyExternalSession(
          String(
            req.headers[
              "x-brixta-external-session"
            ] ??
            "",
          ),
        );

      if (
        !external ||
        external.tenant !==
          tenant ||
        external
          .responsibilityKey !==
          responsibilityKey
      ) {
        return res
          .status(401)
          .json({
            success:
              false,

            error:
              "External runtime session is missing or invalid.",
          });
      }

      const clientMutationId =
        String(
          req.body
            ?.clientMutationId ??
          "",
        ).trim();

      if (
        clientMutationId.length <
          8 ||
        clientMutationId.length >
          160
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            error:
              "clientMutationId must be 8–160 characters.",
          });
      }

      try {
        const result =
          await withTenantSchema(
            tenant,
            async (
              db,
            ) => {
              const rate =
                await consumePublicRateLimit(
                  db,
                  {
                    scope:
                      `external-action:${responsibilityKey}`,

                    identity:
                      `${clientIdentity(req)}:${external.sessionId}`,

                    limit:
                      90,

                    windowSeconds:
                      60,
                  },
                );

              if (
                !rate.allowed
              ) {
                return {
                  ok:
                    false as const,

                  status:
                    429,

                  code:
                    "RATE_LIMITED",

                  error:
                    "Too many requests.",
                };
              }

              const definition =
                await loadExternalRuntimeDefinition(
                  db,
                  tenant,
                  responsibilityKey,
                );

              if (
                !definition
              ) {
                return {
                  ok:
                    false as const,

                  status:
                    404,

                  code:
                    "EXTERNAL_RUNTIME_NOT_FOUND",

                  error:
                    "Public runtime not found.",
                };
              }

              if (
                String(
                  definition
                    .delivery
                    .access ??
                  "",
                ) ===
                  "required_auth" &&
                !external.userId
              ) {
                return {
                  ok:
                    false as const,

                  status:
                    401,

                  code:
                    "EXTERNAL_AUTH_REQUIRED",

                  error:
                    "BRIXTA authentication is required.",
                };
              }

              return executeExternalRuntimeAction(
                db,
                {
                  definition,

                  sessionId:
                    external.sessionId,

                  actionId:
                    String(
                      req.params
                        .actionId,
                    ),

                  recordId:
                    String(
                      req.body
                        ?.recordId ??
                      "",
                    ).trim() ||
                    null,

                  payload:
                    req.body
                      ?.payload ??
                    {},

                  clientMutationId,

                  device:
                    (
                      req.body
                        ?.device &&
                      typeof req.body
                        .device ===
                        "object"
                    )
                      ? req.body
                          .device as
                          Record<
                            string,
                            unknown
                          >
                      : {},
                },
              );
            },
          );

        res.setHeader(
          "Cache-Control",
          "no-store",
        );

        if (
          !result.ok
        ) {
          return res
            .status(
              result.status,
            )
            .json({
              success:
                false,

              code:
                result.code,

              error:
                result.error,

              details:
                "details" in
                  result
                  ? result.details
                  : undefined,
            });
        }

        return res.json({
          success:
            true,

          ...result.value,

          idempotent:
            result.idempotent,
        });
      } catch (
        error
      ) {
        console.error(
          "External action failed:",
          error,
        );

        return res
          .status(500)
          .json({
            success:
              false,

            error:
              error instanceof
              Error
                ? error.message
                : "External action failed.",
          });
      }
    },
  );
}
