import type {
  Express,
  Request,
} from "express";

import {
  eq,
} from "drizzle-orm";

import {
  withTenantSchema,
} from "../db/db";

import {
  platformMeta,
} from "../db/platformVNextSchema";

import {
  verifyMobileToken,
} from "../auth/jwt";

import {
  consumePublicRateLimit,
} from "../public/rateLimit";

import {
  claimQrReward,
  readQrRewardStatus,
  resolveQrReward,
} from "./runtime";


const QR_RUNTIME_KEY =
  "public_qr_reward_responsibility_v1";


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


function validTenant(
  value: string,
) {
  return /^[a-z][a-z0-9_]{0,62}$/.test(
    value,
  );
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

  const payload =
    verifyMobileToken(
      auth
        .slice(
          "Bearer ".length,
        )
        .trim(),
    );

  if (
    payload.schemaName !==
    tenant
  ) {
    throw new Error(
      "TENANT_MISMATCH",
    );
  }

  return payload.userId;
}


async function qrRuntimeMapping(
  db:
    Parameters<
      Parameters<
        typeof withTenantSchema
      >[1]
    >[0],
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
          QR_RUNTIME_KEY,
        ),
      )
      .limit(1);

  const value =
    objectValue(
      rows[0]
        ?.value,
    );

  return value
    .responsibilityKey
    ? {
        responsibilityId:
          value.responsibilityId ??
          null,

        responsibilityKey:
          String(
            value.responsibilityKey,
          ),

        publishedVersion:
          value.publishedVersion ??
          null,

        manifestHash:
          value.manifestHash ??
          null,
      }
    : null;
}


export default function setupQrRewardRoutes(
  app: Express,
) {
  app.get(
    "/api/public/qr-rewards/:tenant/:token",
    async (
      req,
      res,
    ) => {
      const tenant =
        String(
          req.params.tenant,
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
                      "qr-resolve",

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
                  limited:
                    true as const,
                };
              }

              return {
                limited:
                  false as const,

                reward:
                  await resolveQrReward(
                    db,
                    String(
                      req.params.token,
                    ),
                    String(
                      req.query
                        .entityRecordId ??
                      "",
                    ).trim() ||
                    null,
                  ),

                runtime:
                  await qrRuntimeMapping(
                    db,
                  ),
              };
            },
          );

        if (
          result.limited
        ) {
          return res
            .status(429)
            .json({
              success:
                false,

              error:
                "Too many requests.",
            });
        }

        res.setHeader(
          "Cache-Control",
          "no-store",
        );

        return res.json({
          success:
            true,

          reward:
            result.reward,

          runtime:
            result.runtime,
        });
      } catch (
        error
      ) {
        console.error(
          "Public QR resolve failed:",
          error,
        );

        return res
          .status(500)
          .json({
            success:
              false,

            error:
              "Unable to resolve QR reward.",
          });
      }
    },
  );


  app.post(
    "/api/public/qr-rewards/:tenant/:token/claim",
    async (
      req,
      res,
    ) => {
      const tenant =
        String(
          req.params.tenant,
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

      let userId:
        number | null;

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
                      "qr-claim",

                    identity:
                      clientIdentity(
                        req,
                      ),

                    limit:
                      60,

                    windowSeconds:
                      60,
                  },
                );

              if (
                !rate.allowed
              ) {
                return {
                  limited:
                    true as const,
                };
              }

              return {
                limited:
                  false as const,

                reward:
                  await claimQrReward(
                    db,
                    {
                      rawToken:
                        String(
                          req.params
                            .token,
                        ),

                      requestId:
                        String(
                          req.body
                            ?.requestId ??
                          "",
                        ),

                      upi:
                        String(
                          req.body
                            ?.upi ??
                          "",
                        ),

                      entityRecordId:
                        String(
                          req.body
                            ?.entityRecordId ??
                          "",
                        ).trim() ||
                        null,

                      userId,
                    },
                  ),
              };
            },
          );

        if (
          result.limited
        ) {
          return res
            .status(429)
            .json({
              success:
                false,

              error:
                "Too many requests.",
            });
        }

        res.setHeader(
          "Cache-Control",
          "no-store",
        );

        return res.json({
          success:
            true,

          reward:
            result.reward,
        });
      } catch (
        error
      ) {
        console.error(
          "QR claim failed:",
          error,
        );

        return res
          .status(500)
          .json({
            success:
              false,

            error:
              "Unable to process QR reward claim.",
          });
      }
    },
  );


  app.get(
    "/api/public/qr-rewards/:tenant/:token/status",
    async (
      req,
      res,
    ) => {
      const tenant =
        String(
          req.params.tenant,
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
                      "qr-status",

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
                  limited:
                    true as const,
                };
              }

              return {
                limited:
                  false as const,

                reward:
                  await readQrRewardStatus(
                    db,
                    String(
                      req.params.token,
                    ),
                  ),
              };
            },
          );

        if (
          result.limited
        ) {
          return res
            .status(429)
            .json({
              success:
                false,

              error:
                "Too many requests.",
            });
        }

        res.setHeader(
          "Cache-Control",
          "no-store",
        );

        return res.json({
          success:
            true,

          reward:
            result.reward,
        });
      } catch (
        error
      ) {
        console.error(
          "QR status failed:",
          error,
        );

        return res
          .status(500)
          .json({
            success:
              false,

            error:
              "Unable to read QR reward status.",
          });
      }
    },
  );
}
