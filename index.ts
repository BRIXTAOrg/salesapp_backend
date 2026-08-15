import express, {
  type Express,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";

dotenv.config({
  path: path.resolve(
    process.cwd(),
    ".env",
  ),
});

// AUTH + MOBILE WORKSPACE
import setupAuthRoutes from "./src/auth/login";
import setupMobileBootstrapRoutes from "./src/auth/bootstrap";
import setupMobileWorkspaceAdminRoutes from "./src/admin/mobileWorkspace";

// PHOTO UPLOAD
import setupUploadRoutes from "./src/photoUpload/upload";

// GET ROUTES
import setupDealerRoutes from "./src/getRoutes/dealer";
import setupDvrRoutes from "./src/getRoutes/dvr";
import setupPjpRoutes from "./src/getRoutes/pjp";
import setupLeaveRoutes from "./src/getRoutes/leave";
import setupAttendanceRoutes from "./src/getRoutes/attendance";
import setupInstitutionRoutes from "./src/getRoutes/institution";
import setupInfluencerRoutes from "./src/getRoutes/influencer";
import setupDistributorRoutes from "./src/getRoutes/distributor";
import setupOutletRoutes from "./src/getRoutes/outlet";
import setupTadaBillRoutes from "./src/getRoutes/tadabill";

// POST ROUTES
import setupAttendanceInRoutes from "./src/postRoutes/attendanceIN";
import setupAttendanceOutRoutes from "./src/postRoutes/attendanceOUT";
import setupDealerPostRoutes from "./src/postRoutes/dealer";
import setupDvrPostRoutes from "./src/postRoutes/dvr";
import setupLeavePostRoutes from "./src/postRoutes/leave";
import setupPjpPostRoutes from "./src/postRoutes/pjp";
import setupInstitutionPostRoutes from "./src/postRoutes/institution";
import setupInfluencerPostRoutes from "./src/postRoutes/influencer";
import setupDistributorPostRoutes from "./src/postRoutes/distributor";
import setupOutletPostRoutes from "./src/postRoutes/outlet";
import setupTadaBillPostRoutes from "./src/postRoutes/tadabill";

// UPDATE ROUTES
import setupDealerUpdateRoutes from "./src/updateRoutes/dealer";
import setupDvrUpdateRoutes from "./src/updateRoutes/dvr";
import setupLeaveUpdateRoutes from "./src/updateRoutes/leave";
import setupPjpUpdateRoutes from "./src/updateRoutes/pjp";
import setupInstitutionUpdateRoutes from "./src/updateRoutes/institution";
import setupInfluencerUpdateRoutes from "./src/updateRoutes/influencer";
import setupDistributorUpdateRoutes from "./src/updateRoutes/distributor";
import setupOutletUpdateRoutes from "./src/updateRoutes/outlet";
import setupTadaBillUpdateRoutes from "./src/updateRoutes/tadabill";

const app: Express = express();

const DEFAULT_PORT = 8000;

const parsedPort = Number.parseInt(
  process.env.PORT ??
    String(DEFAULT_PORT),
  10,
);

const PORT =
  Number.isNaN(parsedPort)
    ? DEFAULT_PORT
    : parsedPort;

// -------------------------------------------------------
// GLOBAL MIDDLEWARE
// -------------------------------------------------------

app.use(cors());

app.use(
  express.json({
    limit: "2mb",
  }),
);

// -------------------------------------------------------
// REQUEST LOGGER
// -------------------------------------------------------

app.use(
  (
    req: Request,
    res: Response,
    next,
  ) => {
    const startedAt =
      Date.now();

    const requestTime =
      new Date().toISOString();

    res.on(
      "finish",
      () => {
        const duration =
          Date.now() -
          startedAt;

        const status =
          res.statusCode;

        const statusMarker =
          status >= 500
            ? "❌"
            : status >= 400
              ? "⚠️"
              : "✅";

        console.log(
          [
            statusMarker,
            requestTime,
            req.method,
            req.originalUrl,
            `-> ${status}`,
            `(${duration}ms)`,
          ].join(" "),
        );
      },
    );

    next();
  },
);

// -------------------------------------------------------
// HEALTH CHECK
// -------------------------------------------------------

app.get(
  "/",
  (
    _req: Request,
    res: Response,
  ) => {
    return res
      .status(200)
      .json({
        success: true,
        message:
          "Kamdhenu Sales App Backend",
        service:
          "salesapp_backend",
        port: PORT,
      });
  },
);

// -------------------------------------------------------
// FLOW 1
// AUTH -> BOOTSTRAP -> DYNAMIC RESPONSIBILITIES
// -------------------------------------------------------

setupAuthRoutes(app);

setupMobileBootstrapRoutes(
  app,
);

setupMobileWorkspaceAdminRoutes(
  app,
);

// -------------------------------------------------------
// EXISTING GET ROUTES
// -------------------------------------------------------

setupDealerRoutes(app);
setupDvrRoutes(app);
setupPjpRoutes(app);
setupLeaveRoutes(app);
setupAttendanceRoutes(app);
setupInstitutionRoutes(app);
setupInfluencerRoutes(app);
setupDistributorRoutes(app);
setupOutletRoutes(app);
setupTadaBillRoutes(app);

// -------------------------------------------------------
// EXISTING POST ROUTES
// -------------------------------------------------------

setupAttendanceInRoutes(app);
setupAttendanceOutRoutes(app);
setupDealerPostRoutes(app);
setupDvrPostRoutes(app);
setupLeavePostRoutes(app);
setupPjpPostRoutes(app);
setupInstitutionPostRoutes(app);
setupInfluencerPostRoutes(app);
setupDistributorPostRoutes(app);
setupOutletPostRoutes(app);
setupTadaBillPostRoutes(app);

// -------------------------------------------------------
// EXISTING UPDATE ROUTES
// -------------------------------------------------------

setupDealerUpdateRoutes(app);
setupDvrUpdateRoutes(app);
setupLeaveUpdateRoutes(app);
setupPjpUpdateRoutes(app);
setupInstitutionUpdateRoutes(app);
setupInfluencerUpdateRoutes(app);
setupDistributorUpdateRoutes(app);
setupOutletUpdateRoutes(app);
setupTadaBillUpdateRoutes(app);

// -------------------------------------------------------
// PHOTO UPLOAD ROUTES
// -------------------------------------------------------

setupUploadRoutes(app);

// -------------------------------------------------------
// 404 HANDLER
// -------------------------------------------------------

app.use(
  (
    req: Request,
    res: Response,
  ) => {
    return res.status(404).json({
      success: false,
      error: "Route not found.",
      method: req.method,
      path: req.originalUrl,
    });
  },
);

// -------------------------------------------------------
// START SERVER
// -------------------------------------------------------

app.listen(
  PORT,
  () => {
    console.log("");
    console.log(
      "========================================",
    );
    console.log(
      " KAMDHENU SALES APP BACKEND",
    );
    console.log(
      "========================================",
    );
    console.log(
      ` Server: http://localhost:${PORT}`,
    );
    console.log(
      ` Mode:   ${process.env.NODE_ENV ?? "development"}`,
    );
    console.log(
      " Logging: ENABLED",
    );
    console.log(
      "========================================",
    );
    console.log("");
  },
);