import type { Router } from "express";

import type { AdminRequest } from "../middleware/adminService";
import {
  getAdminHome,
  getSetupHealth,
} from "../services/adminHome";

export function registerHomeAdminRoutes(router: Router) {
  router.get("/home", async (req: AdminRequest, res) => {
    try {
      const queryActor = Number(req.query.actorUserId);
      const actorUserId =
        req.adminActor?.userId ??
        (Number.isInteger(queryActor) && queryActor > 0
          ? queryActor
          : null);

      return res.json({
        success: true,
        home: await getAdminHome(actorUserId),
      });
    } catch (error) {
      console.error("Admin home error:", error);
      return res.status(500).json({
        success: false,
        error: "Unable to build admin home.",
      });
    }
  });

  router.get("/setup-health", async (_req, res) => {
    try {
      return res.json({
        success: true,
        health: await getSetupHealth(),
      });
    } catch (error) {
      console.error("Setup health error:", error);
      return res.status(500).json({
        success: false,
        error: "Unable to calculate setup health.",
      });
    }
  });
}
