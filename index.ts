import express, {
  type Express,
  type Request,
  type Response,
} from "express";

import cors from "cors";
import path from "node:path";
import dotenv from "dotenv";

import setupAuthRoutes from "./src/auth/login";
import setupMobileBootstrapRoutes from "./src/auth/bootstrap";
import setupMobilePlatformRoutes from "./src/mobile/platform";
import setupApplianceAdminRoutes from "./src/admin/appliance";
import setupUploadRoutes from "./src/photoUpload/upload";

import setupPublicExternalRuntimeRoutes from "./src/public/externalRuntimeRoutes";
import setupQrRewardRoutes from "./src/qrRewards/routes";

import {
  registerQrRewardServiceAdapters,
} from "./src/qrRewards/runtime";

import {
  startIntegrationServiceWorker,
} from "./src/platform/integrations/serviceRuntime";

import {
  PLATFORM_PRIMITIVES,
} from "./src/platform/primitives";

dotenv.config({
  path: path.resolve(
    process.cwd(),
    ".env",
  ),
});


const QR_REWARDS_EDITION =
  process.env.BRIXTA_BACKEND_EDITION ===
  "qr-voucher-rewards";

const app: Express =
  express();

const DEFAULT_PORT =
  8000;

const parsedPort =
  Number.parseInt(
    process.env.PORT ??
      String(DEFAULT_PORT),
    10,
  );

const PORT =
  Number.isNaN(
    parsedPort,
  )
    ? DEFAULT_PORT
    : parsedPort;

app.use(cors());

app.use(
  express.json({
    limit: "4mb",
  }),
);

app.use(
  (
    req: Request,
    res: Response,
    next,
  ) => {
    const startedAt =
      Date.now();

    res.on(
      "finish",
      () => {
        const status =
          res.statusCode;

        const marker =
          status >= 500
            ? "❌"
            : status >= 400
              ? "⚠️"
              : "✅";

        console.log(
          [
            marker,
            new Date().toISOString(),
            req.method,
            req.originalUrl,
            `-> ${status}`,
            `(${Date.now() - startedAt}ms)`,
          ].join(" "),
        );
      },
    );

    next();
  },
);

app.get(
  "/",
  (
    _req: Request,
    res: Response,
  ) =>
    res.json({
      success: true,
      service:
        "BRIXTA Responsibility Runtime",
      architecture:
        "responsibility-kernel-workflow",
      primitiveVersion:
        PLATFORM_PRIMITIVES.version,
      capabilities: {
        publishedManifests: true,
        kernelRuntime: true,
        genericDataSources: true,
        entityMemory: true,
        deviceRuntime: true,
        workflowRuntime: true,
        legacyCrudCompatibility: true,
        publicExternalRuntime: true,
        apiServiceRuntime: true,
        qrRewardsPublic: QR_REWARDS_EDITION,
      },
      endpoints: {
        auth:
          "/api/salesApp/auth/login",
        bootstrap:
          "/api/salesApp/bootstrap",
        syncState:
          "/api/salesApp/sync/state",
        runtime:
          "/api/salesApp/responsibilities/:responsibilityKey/runtime",
        kernelAction:
          "/api/salesApp/responsibilities/:responsibilityKey/actions/:actionId",
        dataSources:
          "/api/salesApp/data-sources/:key",
        memory:
          "/api/salesApp/memory/:sourceKey/:entityId",
        myWork:
          "/api/salesApp/my-work",
        devices:
          "/api/salesApp/devices/register",
        legacyRecords:
          "/api/salesApp/records/:responsibilityKey",
        workflow:
          "/api/salesApp/workflow/state",
        media:
          "/api/salesApp/media",
        publicRuntime:
          "/api/public/runtime/:tenant/:responsibilityKey",
        publicQrReward:
          "/api/public/qr-rewards/:tenant/:token",
        admin:
          "/api/admin/appliance",
      },
    }),
);

setupAuthRoutes(app);
setupMobileBootstrapRoutes(
  app,
);
setupMobilePlatformRoutes(
  app,
);

/*
 * Generic public External Link Runtime.
 *
 * Route exists globally, but a Responsibility must explicitly
 * publish externalWeb.enabled=true with public/optional_auth.
 */
setupPublicExternalRuntimeRoutes(
  app,
);


if (
  QR_REWARDS_EDITION
) {
  registerQrRewardServiceAdapters();

  setupQrRewardRoutes(
    app,
  );
}


/*
 * QR edition enables worker automatically.
 *
 * Core backend can enable it explicitly with:
 * BRIXTA_INTEGRATION_WORKER=1
 */
startIntegrationServiceWorker();
setupUploadRoutes(app);
setupApplianceAdminRoutes(
  app,
);

app.use(
  (
    req: Request,
    res: Response,
  ) =>
    res
      .status(404)
      .json({
        success: false,
        error:
          "Route not found.",
        method:
          req.method,
        path:
          req.originalUrl,
      }),
);

app.listen(
  PORT,
  () => {
    console.log("");
    console.log(
      "==============================================",
    );
    console.log(
      " BRIXTA RESPONSIBILITY RUNTIME",
    );
    console.log(
      "==============================================",
    );
    console.log(
      ` Server: http://localhost:${PORT}`,
    );
    console.log(
      ` Backend edition: ${process.env.BRIXTA_BACKEND_EDITION ?? "core"}`,
    );
    console.log(
      ` Primitives: ${PLATFORM_PRIMITIVES.version}`,
    );
    console.log(
      " Published manifests: ENABLED",
    );
    console.log(
      " Kernel v3+ runtime: ENABLED",
    );
    console.log(
      " Generic Data Sources: ENABLED",
    );
    console.log(
      " Workflow runtime: ENABLED",
    );
    console.log(
      " V2 CRUD compatibility: ENABLED",
    );
    console.log(
      "==============================================",
    );
    console.log("");
  },
);
