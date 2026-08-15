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

// AUTH + APPLIANCE CONTROL PLANE
import setupAuthRoutes from "./src/auth/login";
import setupMobileBootstrapRoutes from "./src/auth/bootstrap";
import setupApplianceAdminRoutes from "./src/admin/appliance";
import setupMobileApplianceRoutes from "./src/mobile/appliance";

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
  process.env.PORT ?? String(DEFAULT_PORT),
  10,
);
const PORT =
  Number.isNaN(parsedPort)
    ? DEFAULT_PORT
    : parsedPort;

app.use(cors());

app.use(
  express.json({
    limit: "4mb",
  }),
);

// REQUEST LOGGER
app.use(
  (
    req: Request,
    res: Response,
    next,
  ) => {
    const startedAt = Date.now();
    const requestTime =
      new Date().toISOString();

    res.on("finish", () => {
      const duration =
        Date.now() - startedAt;
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
          requestTime,
          req.method,
          req.originalUrl,
          `-> ${status}`,
          `(${duration}ms)`,
        ].join(" "),
      );
    });

    next();
  },
);

app.get(
  "/",
  (
    _req: Request,
    res: Response,
  ) =>
    res.status(200).json({
      success: true,
      message:
        "Kamdhenu FieldForce Appliance Backend",
      service:
        "salesapp_backend",
      port: PORT,
      capabilities: {
        employeeLifecycle:
          true,
        dynamicResponsibilities:
          true,
        inheritedAssignments:
          true,
        workAssignments:
          true,
        approvals: true,
        adminOwnershipFallback:
          true,
        adaptiveAdminHome:
          true,
        devices: true,
        dynamicSubmissions:
          true,
      },
    }),
);

// AUTH + APPLIANCE
setupAuthRoutes(app);
setupMobileBootstrapRoutes(app);
setupMobileApplianceRoutes(app);
setupApplianceAdminRoutes(app);

// EXISTING GET ROUTES
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

// EXISTING POST ROUTES
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

// EXISTING UPDATE ROUTES
setupDealerUpdateRoutes(app);
setupDvrUpdateRoutes(app);
setupLeaveUpdateRoutes(app);
setupPjpUpdateRoutes(app);
setupInstitutionUpdateRoutes(app);
setupInfluencerUpdateRoutes(app);
setupDistributorUpdateRoutes(app);
setupOutletUpdateRoutes(app);
setupTadaBillUpdateRoutes(app);

// PHOTO UPLOAD
setupUploadRoutes(app);

// 404
app.use(
  (
    req: Request,
    res: Response,
  ) =>
    res.status(404).json({
      success: false,
      error: "Route not found.",
      method: req.method,
      path: req.originalUrl,
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
      " KAMDHENU FIELDFORCE APPLIANCE BACKEND",
    );
    console.log(
      "==============================================",
    );
    console.log(
      ` Server: http://localhost:${PORT}`,
    );
    console.log(
      ` Mode:   ${process.env.NODE_ENV ?? "development"}`,
    );
    console.log(
      " Control Plane: READY",
    );
    console.log(
      " Request Logging: ENABLED",
    );
    console.log(
      "==============================================",
    );
    console.log("");
  },
);