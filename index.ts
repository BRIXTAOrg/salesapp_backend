// index.ts
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({
  path: path.resolve(process.cwd(), '.env')
});

// AUTH ROUTES
import setupAuthRoutes from './src/auth/login';

// PHOTO UPLOAD
import setupUploadRoutes from './src/photoUpload/upload';

// CRUD ROUTES
import setupDealerRoutes from "./src/getRoutes/dealer";
import setupDvrRoutes from "./src/getRoutes/dvr";
import setupPjpRoutes from "./src/getRoutes/pjp";
import setupLeaveRoutes from "./src/getRoutes/leave";
import setupAttendanceRoutes from "./src/getRoutes/attendance";
import setupInstitutionRoutes from './src/getRoutes/institution';
import setupInfluencerRoutes from './src/getRoutes/influencer';
import setupDistributorRoutes from './src/getRoutes/distributor';
import setupOutletRoutes from './src/getRoutes/outlet';
import setupTadaBillRoutes from './src/getRoutes/tadabill';

import setupAttendanceInRoutes from './src/postRoutes/attendanceIN';
import setupAttendanceOutRoutes from './src/postRoutes/attendanceOUT';
import setupDealerPostRoutes from './src/postRoutes/dealer';
import setupDvrPostRoutes from './src/postRoutes/dvr';
import setupLeavePostRoutes from './src/postRoutes/leave';
import setupPjpPostRoutes from './src/postRoutes/pjp';
import setupInstitutionPostRoutes from './src/postRoutes/institution';
import setupInfluencerPostRoutes from './src/postRoutes/influencer';
import setupDistributorPostRoutes from './src/postRoutes/distributor';
import setupOutletPostRoutes from './src/postRoutes/outlet';
import setupTadaBillPostRoutes from './src/postRoutes/tadabill';

import setupDealerUpdateRoutes from './src/updateRoutes/dealer';
import setupDvrUpdateRoutes from './src/updateRoutes/dvr';
import setupLeaveUpdateRoutes from './src/updateRoutes/leave';
import setupPjpUpdateRoutes from './src/updateRoutes/pjp';
import setupInstitutionUpdateRoutes from './src/updateRoutes/institution';
import setupInfluencerUpdateRoutes from './src/updateRoutes/influencer';
import setupDistributorUpdateRoutes from './src/updateRoutes/distributor';
import setupOutletUpdateRoutes from './src/updateRoutes/outlet';
import setupTadaBillUpdateRoutes from './src/updateRoutes/tadabill';

// --- SERVER SETUP ---
const app: Express = express();

const DEFAULT_PORT = 8000;

const parsed = parseInt(
  process.env.PORT ?? String(DEFAULT_PORT),
  10
);

const PORT = Number.isNaN(parsed)
  ? DEFAULT_PORT
  : parsed;


app.use(cors());
app.use(express.json());

// --- HEALTH CHECK ---
app.get( '/', ( req: Request, res: Response ) => {
    res.status(200).json({
      message: 'Welcome to the Eurofoam App Backend!'
    });
  }
);

// --- CRUD ROUTES ---
setupAuthRoutes(app);
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

setupDealerUpdateRoutes(app);
setupDvrUpdateRoutes(app);
setupLeaveUpdateRoutes(app);
setupPjpUpdateRoutes(app);
setupInstitutionUpdateRoutes(app);
setupInfluencerUpdateRoutes(app);
setupDistributorUpdateRoutes(app);
setupOutletUpdateRoutes(app);
setupTadaBillUpdateRoutes(app);

// --- PHOTO ROUTES ---
setupUploadRoutes(app);

// --- START SERVER ---
app.listen(PORT, () => { 
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});