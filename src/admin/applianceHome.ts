import type { Router } from "express";

import {
  withAdminTenantDb,
  type AdminRequest,
} from "../middleware/adminService";
import {
  getAdminHome,
  getSetupHealth,
} from "../services/adminHome";

export function registerHomeAdminRoutes(router: Router) {
  router.get("/home", withAdminTenantDb<AdminRequest>(async (req, res, db) => {
    try {
      const queryActor = Number(req.query.actorUserId);
      const actorUserId =
        req.adminActor?.userId ??
        (Number.isInteger(queryActor) && queryActor > 0
          ? queryActor
          : null);

      return res.json({
        success: true,
        home: await getAdminHome(db, actorUserId),
      });
    } catch (error) {
      console.error("Admin home error:", error);
      return res.status(500).json({
        success: false,
        error: "Unable to build admin home.",
      });
    }
  }));

  router.get("/setup-health", withAdminTenantDb<AdminRequest>(async (_req, res, db) => {
    try {
      return res.json({
        success: true,
        health: await getSetupHealth(db),
      });
    } catch (error) {
      console.error("Setup health error:", error);
      return res.status(500).json({
        success: false,
        error: "Unable to calculate setup health.",
      });
    }
  }));
}