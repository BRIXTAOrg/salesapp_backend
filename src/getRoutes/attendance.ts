// src/getRoutes/attendance.ts
import { Express, Response } from "express";
import { db } from "../db/db";
import { salesmanAttendance } from "../db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { authenticateToken, AuthRequest } from "../middleware/auth";

export default function setupAttendanceRoutes(app: Express) {
  app.get("/api/salesApp/attendance", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      
      // Check if the frontend is asking ONLY for today's data (for the Home Screen)
      const isTodayOnly = req.query.today === 'true';

      const conditions = [eq(salesmanAttendance.userId, userId)];
      
      if (isTodayOnly) {
        // Apply the 12 AM reset guard ONLY if requested
        conditions.push(sql`DATE(${salesmanAttendance.attendanceDate}) = CURRENT_DATE`);
      }

      const attendanceHistory = await db
        .select()
        .from(salesmanAttendance)
        .where(and(...conditions))
        .orderBy(desc(salesmanAttendance.attendanceDate));

      return res.status(200).json({ success: true, data: attendanceHistory });
    } catch (err: any) {
      console.error("Error fetching attendance:", err);
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  });
}