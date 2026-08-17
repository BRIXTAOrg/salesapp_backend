// src/getRoutes/leave.ts 
import { Express, Response } from "express"; 
import { salesmanLeaveApplications } from "../db/schema"; 
import { eq, desc } from "drizzle-orm"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 

export default function setupLeaveRoutes(app: Express) {   
  app.get("/api/salesApp/leaves", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {     
    try {       
      const userId = req.user!.userId;       
      const leaves = await db         
        .select()         
        .from(salesmanLeaveApplications)         
        .where(eq(salesmanLeaveApplications.userId, userId))         
        .orderBy(desc(salesmanLeaveApplications.createdAt));       
      return res.status(200).json({ success: true, data: leaves });     
    } catch (err: any) {       
      console.error("Error fetching leaves:", err);       
      return res.status(500).json({ success: false, error: "Internal server error" });     
    }   
  })); 
}