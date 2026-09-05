import type {
  Express,
  Request,
  Response,
} from "express";

import {
  withTenantSchema,
} from "../db/db";

import {
  verifyMobileToken,
} from "../auth/jwt";

import {
  claimQrReward,
  readQrRewardStatus,
  resolveQrReward,
} from "./runtime";


function validTenant(
  value: string,
) {
  return /^[a-z][a-z0-9_]{0,62}$/.test(
    value,
  );
}


const RATE_WINDOW_MS =
  60_000;

const RATE_LIMIT =
  120;


const buckets =
  new Map<
    string,
    {
      startedAt:
        number;

      count:
        number;
    }
  >();


function rateLimit(
  req: Request,
  res: Response,
) {
  const forwarded =
    String(
      req.headers[
        "x-forwarded-for"
      ] ??
      "",
    )
      .split(",")[0]
      .trim();

  const key =
    forwarded ||
    req.ip ||
    "unknown";

  const now =
    Date.now();

  const bucket =
    buckets.get(
      key,
    );


  if (
    !bucket ||
    now -
      bucket.startedAt >
      RATE_WINDOW_MS
  ) {
    buckets.set(
      key,
      {
        startedAt:
          now,

        count:
          1,
      },
    );

    return true;
  }


  bucket.count +=
    1;


  if (
    bucket.count >
    RATE_LIMIT
  ) {
    res
      .status(429)
      .json({
        success:
          false,

        error:
          "Too many requests.",
      });

    return false;
  }


  return true;
}


function optionalAppUser(
  req: Request,
  tenant: string,
) {
  const authorization =
    String(
      req.headers
        .authorization ??
      "",
    ).trim();


  if (
    !authorization
  ) {
    return null;
  }


  if (
    !authorization.startsWith(
      "Bearer ",
    )
  ) {
    throw new Error(
      "INVALID_AUTH",
    );
  }


  const token =
    authorization
      .slice(
        "Bearer ".length,
      )
      .trim();

  const payload =
    verifyMobileToken(
      token,
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


export default function setupQrRewardRoutes(
  app: Express,
) {
  app.get(
    "/api/public/qr-rewards/:tenant/:token",
    async (
      req,
      res,
    ) => {
      if (
        !rateLimit(
          req,
          res,
        )
      ) {
        return;
      }


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
        const reward =
          await withTenantSchema(
            tenant,
            (db) =>
              resolveQrReward(
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
          );


        res.setHeader(
          "Cache-Control",
          "no-store",
        );


        return res.json({
          success:
            true,

          reward,
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
      if (
        !rateLimit(
          req,
          res,
        )
      ) {
        return;
      }


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
        const reward =
          await withTenantSchema(
            tenant,
            (db) =>
              claimQrReward(
                db,
                {
                  rawToken:
                    String(
                      req.params.token,
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
          );


        res.setHeader(
          "Cache-Control",
          "no-store",
        );


        return res.json({
          success:
            true,

          reward,
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
      if (
        !rateLimit(
          req,
          res,
        )
      ) {
        return;
      }


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
        const reward =
          await withTenantSchema(
            tenant,
            (db) =>
              readQrRewardStatus(
                db,
                String(
                  req.params.token,
                ),
              ),
          );


        res.setHeader(
          "Cache-Control",
          "no-store",
        );


        return res.json({
          success:
            true,

          reward,
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
