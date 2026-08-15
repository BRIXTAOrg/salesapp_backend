// src/postRoutes/dvr.ts
// src/postRoutes/dvr.ts
import { Express, Response } from "express";
import { db } from "../db/db";
import { dailyVisitReports } from "../db/schema";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import crypto from "crypto"; // Add this for explicit UUID generation

export default function setupDvrPostRoutes(app: Express) {
  app.post("/api/salesApp/daily-visit-reports", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      
      // 1. Destructure to REMOVE 'id', 'createdAt', and 'updatedAt' from the Flutter payload
      const { id, createdAt, updatedAt, ...safeBody } = req.body;
      
      // 2. Build the payload with safe values
      const dvrPayload = {
        ...safeBody,
        id: crypto.randomUUID(), // Explicitly generate a valid UUID
        userId: userId, // Inject secure userId
        reportDate: safeBody.reportDate ? new Date(safeBody.reportDate) : new Date(),
        checkInTime: safeBody.checkInTime ? new Date(safeBody.checkInTime) : null,
        checkOutTime: safeBody.checkOutTime ? new Date(safeBody.checkOutTime) : null,
        expectedActivationDate: safeBody.expectedActivationDate ? new Date(safeBody.expectedActivationDate) : null,
        
        // 3. Set fresh timestamps server-side
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const [newDvr] = await db.insert(dailyVisitReports).values(dvrPayload).returning();

      return res.status(201).json({ success: true, data: newDvr });
    } catch (err: any) {
      console.error("Error creating DVR:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  });
}
