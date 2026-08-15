import {
  Router,
  type Express,
} from "express";

import { requireAdminService } from "../middleware/adminService";
import { registerEmployeeAdminRoutes } from "./applianceEmployees";
import { registerResponsibilityAdminRoutes } from "./applianceResponsibilities";
import { registerOperationsAdminRoutes } from "./applianceOperations";
import { registerHomeAdminRoutes } from "./applianceHome";

export default function setupApplianceAdminRoutes(
  app: Express,
) {
  const router = Router();

  // Protect every admin control-plane endpoint.
  router.use(requireAdminService);

  // Register all appliance admin feature routes on one shared router.
  registerHomeAdminRoutes(router);
  registerEmployeeAdminRoutes(router);
  registerResponsibilityAdminRoutes(router);
  registerOperationsAdminRoutes(router);

  // Permanent Field Control API.
  app.use(
    "/api/admin/appliance",
    router,
  );

  // Backward compatibility with the earlier Flow 1 CMS proxy.
  app.use(
    "/api/admin/flow1",
    router,
  );

  console.log(
    "[ADMIN] Appliance routes mounted at /api/admin/appliance",
  );
}