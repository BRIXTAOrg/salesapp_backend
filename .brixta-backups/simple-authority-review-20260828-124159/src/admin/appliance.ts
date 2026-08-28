import {
  Router,
  type Express,
} from "express";

import {
  requireAdminService,
} from "../middleware/adminService";

import {
  PLATFORM_PRIMITIVES,
} from "../platform/primitives";

import {
  registerEmployeeAdminRoutes,
} from "./applianceEmployees";

import {
  registerResponsibilityAdminRoutes,
} from "./applianceResponsibilities";

import {
  registerWorkflowAdminRoutes,
} from "./applianceWorkflows";

import {
  registerRuntimeAdminRoutes,
} from "./applianceRuntime";

/**
 * Admin API intentionally contains only the control plane required by the
 * Responsibility + generic CRUD + Workflow architecture.
 */
export default function setupApplianceAdminRoutes(
  app: Express,
) {
  const router =
    Router();

  router.use(
    requireAdminService,
  );

  router.get(
    "/primitives",
    (_req, res) =>
      res.json({
        success: true,
        primitives:
          PLATFORM_PRIMITIVES,
      }),
  );

  registerEmployeeAdminRoutes(
    router,
  );

  registerResponsibilityAdminRoutes(
    router,
  );

  registerWorkflowAdminRoutes(
    router,
  );

  registerRuntimeAdminRoutes(
    router,
  );

  app.use(
    "/api/admin/appliance",
    router,
  );

  console.log(
    "[ADMIN] Generic platform API mounted at /api/admin/appliance",
  );
}
