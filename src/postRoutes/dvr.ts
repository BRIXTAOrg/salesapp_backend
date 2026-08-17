// src/postRoutes/dvr.ts 
import { Express, Response } from "express"; 
import { dailyVisitReports } from "../db/schema"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 
import crypto from "crypto"; 

export default function setupDvrPostRoutes(app: Express) {   
  app.post("/api/salesApp/daily-visit-reports", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {     
    try {       
      const userId = req.user!.userId;              
      const { id, createdAt, updatedAt, ...safeBody } = req.body;              
      const dvrPayload = {         
        ...safeBody,         
        id: crypto.randomUUID(),         
        userId: userId,         
        reportDate: safeBody.reportDate ? new Date(safeBody.reportDate) : new Date(),         
        checkInTime: safeBody.checkInTime ? new Date(safeBody.checkInTime) : null,         
        checkOutTime: safeBody.checkOutTime ? new Date(safeBody.checkOutTime) : null,         
        expectedActivationDate: safeBody.expectedActivationDate ? new Date(safeBody.expectedActivationDate) : null,                  
        createdAt: new Date(),         
        updatedAt: new Date(),       
      };       
      const [newDvr] = await db.insert(dailyVisitReports).values(dvrPayload).returning();       
      return res.status(201).json({ success: true, data: newDvr });     
    } catch (err: any) {       
      console.error("Error creating DVR:", err);       
      return res.status(500).json({ success: false, error: "Internal server error" });     
    }   
  })); 
}