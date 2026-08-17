// src/getRoutes/dvr.ts 
import { Express, Response } from "express"; 
import { dailyVisitReports } from "../db/schema"; 
import { eq, desc } from "drizzle-orm"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 

export default function setupDvrRoutes(app: Express) {   
  app.get("/api/salesApp/daily-visit-reports", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {     
    try {       
      const userId = req.user!.userId;       
      const dvrs = await db         
        .select()         
        .from(dailyVisitReports)         
        .where(eq(dailyVisitReports.userId, userId))         
        .orderBy(desc(dailyVisitReports.reportDate));       
      return res.status(200).json({ success: true, data: dvrs });     
    } catch (err: any) {       
      console.error("Error fetching DVRs:", err);       
      return res.status(500).json({ success: false, error: "Internal server error" });     
    }   
  })); 
}