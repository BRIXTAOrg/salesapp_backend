// src/postRoutes/attendanceOUT.ts 
import { Express, Response } from "express"; 
import { salesmanAttendance } from "../db/schema"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 
import { eq, and, isNull, desc, sql } from "drizzle-orm"; 

export default function setupAttendanceOutRoutes(app: Express) {     
    app.patch("/api/salesApp/attendance/out", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {         
        try {             
            const userId = req.user!.userId;             
            const {                 
                outTimeLatitude,                 
                outTimeLongitude,                 
                outTimeImageUrl,                 
                outTimeImageCaptured,                 
                id             
            } = req.body;             
            const now = new Date();             
            let targetAttendanceId = id;             
            if (!targetAttendanceId) {                 
                const activeRecord = await db.select({ id: salesmanAttendance.id })                     
                    .from(salesmanAttendance)                     
                    .where(                         
                        and(                             
                            eq(salesmanAttendance.userId, userId),                             
                            isNull(salesmanAttendance.outTimeTimestamp)                         
                        )                     
                    )                     
                    .orderBy(desc(salesmanAttendance.inTimeTimestamp))                     
                    .limit(1);                 
                if (activeRecord.length === 0) {                     
                    return res.status(404).json({ success: false, error: "No active check-in found to check-out from." });                 
                }                 
                targetAttendanceId = activeRecord[0].id;             
            }             
            const [updatedAttendance] = await db                 
                .update(salesmanAttendance)                 
                .set({                     
                    outTimeTimestamp: now.toISOString(),                     
                    outTimeLatitude: outTimeLatitude?.toString() ?? null,                     
                    outTimeLongitude: outTimeLongitude?.toString() ?? null,                     
                    outTimeImageUrl: outTimeImageUrl ?? null,                     
                    outTimeImageCaptured: outTimeImageCaptured ?? true,                     
                    updatedAt: now.toISOString(),                 
                })                 
                .where(eq(salesmanAttendance.id, targetAttendanceId))                 
                .returning();             
            return res.status(200).json({ success: true, data: updatedAttendance });         
        } catch (err: any) {             
            console.error("Error marking attendance OUT:", err);             
            return res.status(500).json({ success: false, error: "Internal server error" });         
        }     
    })); 
}