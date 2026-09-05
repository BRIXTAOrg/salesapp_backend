import type {
  Express,
} from "express";

import {
  withTenantSchema,
} from "../db/db";

import {
  getResponsibilityByKey,
} from "../platform/responsibility";

import {
  getPublishedRuntimeManifest,
} from "../platform/vnext/runtimeManifest";

import {
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


function validTenant(
  tenant: string,
) {
  return /^[a-z][a-z0-9_]{0,62}$/.test(
    tenant,
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
              const responsibility =
                await getResponsibilityByKey(
                  db,
                  String(
                    req.params
                      .responsibilityKey,
                  ),
                );


              if (
                !responsibility
              ) {
                return {
                  status:
                    404,

                  body: {
                    success:
                      false,

                    error:
                      "Responsibility not found.",
                  },
                };
              }


              const published =
                await getPublishedRuntimeManifest(
                  db,
                  responsibility.id,
                );


              if (
                !published ||
                !published.kernel
              ) {
                return {
                  status:
                    404,

                  body: {
                    success:
                      false,

                    error:
                      "Published runtime not found.",
                  },
                };
              }


              const kernelMetadata =
                objectValue(
                  published.kernel
                    .metadata,
                );

              const deliveryTargets =
                objectValue(
                  kernelMetadata
                    .deliveryTargets,
                );

              const external =
                objectValue(
                  deliveryTargets
                    .externalWeb,
                );

              const access =
                String(
                  external.access ??
                  "",
                );


              if (
                external.enabled !==
                  true ||
                ![
                  "public",
                  "optional_auth",
                ].includes(
                  access,
                ) ||
                String(
                  external.tenantKey ??
                  "",
                ) !==
                  tenant
              ) {
                return {
                  status:
                    404,

                  body: {
                    success:
                      false,

                    error:
                      "External runtime is not public.",
                  },
                };
              }


              const ui =
                objectValue(
                  kernelMetadata.ui,
                );


              const manifest =
                objectValue(
                  published.manifest,
                );

              const extension =
                objectValue(
                  manifest.extension,
                );

              const extensionMetadata =
                objectValue(
                  extension.metadata,
                );


              const requestedCapabilities =
                Array.isArray(
                  external
                    .allowedCapabilities,
                )
                  ? external
                      .allowedCapabilities
                      .map(String)
                  : [];


              const publishedApiCapabilities =
                await listPublishedCapabilities(
                  db,
                );


              const builtInPublic =
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
                      builtInPublic.has(
                        capability,
                      ) ||
                      publishedApiCapabilities.includes(
                        capability,
                      ),
                  );


              return {
                status:
                  200,

                body: {
                  success:
                    true,

                  responsibility: {
                    id:
                      responsibility.id,

                    key:
                      responsibility.key,

                    title:
                      responsibility.title,
                  },

                  manifest: {
                    version:
                      published.version,

                    hash:
                      published.manifestHash,

                    source:
                      published.source,
                  },

                  delivery: {
                    runtime:
                      external.runtime,

                    access,

                    routePattern:
                      external.routePattern,

                    tenantKey:
                      tenant,

                    allowedCapabilities,
                  },

                  uiDocument:
                    ui.uiDocument ??
                    null,

                  /*
                   * Safe to expose graph contract.
                   *
                   * Provider credentials are not stored in Pixel.
                   */
                  pixelLogic:
                    extensionMetadata
                      .pixelLogic ??
                    null,
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
          "Public external runtime failed:",
          error,
        );

        return res
          .status(500)
          .json({
            success:
              false,

            error:
              "Unable to load public runtime.",
          });
      }
    },
  );
}
