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

import {
  PLATFORM_PRIMITIVES,
} from "./src/platform/primitives";

dotenv.config({
  path: path.resolve(
    process.cwd(),
    ".env",
  ),
});

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
        "responsibility-crud-workflow",
      primitiveVersion:
        PLATFORM_PRIMITIVES.version,
      endpoints: {
        auth:
          "/api/salesApp/auth/login",
        bootstrap:
          "/api/salesApp/bootstrap",
        records:
          "/api/salesApp/records/:responsibilityKey",
        workflow:
          "/api/salesApp/workflow/state",
        media:
          "/api/salesApp/media",
        admin:
          "/api/admin/appliance",
      },
    }),
);

// Employee identity + generated workspace.
setupAuthRoutes(app);
setupMobileBootstrapRoutes(
  app,
);

// Generic CRUD + workflow runtime. This is the business API.
setupMobilePlatformRoutes(
  app,
);

// Generic media primitive for photo/file/signature/audio/etc.
setupUploadRoutes(app);

// Admin control plane: employees, Responsibilities, Workflows, runtime.
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
      ` Primitives: ${PLATFORM_PRIMITIVES.version}`,
    );
    console.log(
      " Business routes: GENERIC CRUD ONLY",
    );
    console.log(
      " Workflow runtime: ENABLED",
    );
    console.log(
      "==============================================",
    );
    console.log("");
  },
);
