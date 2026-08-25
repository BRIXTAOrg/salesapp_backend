import type {
  Express,
} from "express";

import {
  PLATFORM_PRIMITIVES,
} from "../platform/primitives";

import {
  authenticateToken,
} from "../middleware/auth";

import {
  registerDataRoutes,
} from "./dataRoutes";

import {
  registerDeviceRoutes,
} from "./deviceRoutes";

import {
  registerLegacyRecordRoutes,
} from "./legacyRecordRoutes";

import {
  registerRuntimeRoutes,
} from "./runtimeRoutes";

import {
  registerWorkflowRoutes,
} from "./workflowRoutes";

/**
 * Small route composition root. Business behavior lives in platform/services,
 * not in one giant Express route file and never in business-specific routes.
 */
export default function setupMobilePlatformRoutes(
  app: Express,
) {
  app.get(
    "/api/salesApp/primitives",
    authenticateToken,
    (_req, res) =>
      res.json({
        success: true,
        primitives:
          PLATFORM_PRIMITIVES,
      }),
  );

  registerDeviceRoutes(app);
  registerRuntimeRoutes(app);
  registerDataRoutes(app);
  registerWorkflowRoutes(app);
  registerLegacyRecordRoutes(app);
}
