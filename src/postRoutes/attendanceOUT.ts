// src/postRoutes/attendanceOUT.ts
import { Express, Response } from "express";
import { db } from "../db/db";
import { salesmanAttendance } from "../db/schema";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { eq, and, isNull, desc, sql } from "drizzle-orm";

export default function setupAttendanceOutRoutes(app: Express) {
    app.patch("/api/salesApp/attendance/out", authenticateToken, async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user!.userId;
            const {
                outTimeLatitude,
                outTimeLongitude,
                outTimeImageUrl,
                outTimeImageCaptured,
                id // Optional: If the app sends the specific attendance ID
            } = req.body;

            const now = new Date();
            let targetAttendanceId = id;

            // If the app didn't send an ID, find the user's active check-in for today
            if (!targetAttendanceId) {
                const activeRecord = await db.select({ id: salesmanAttendance.id })
                    .from(salesmanAttendance)
                    .where(
                        and(
                            eq(salesmanAttendance.userId, userId),
                            isNull(salesmanAttendance.outTimeTimestamp), // Still open
                            // sql`DATE(${salesmanAttendance.attendanceDate}) = CURRENT_DATE`
                        )
                    )
                    .orderBy(desc(salesmanAttendance.inTimeTimestamp))
                    .limit(1);

                if (activeRecord.length === 0) {
                    return res.status(404).json({ success: false, error: "No active check-in found to check-out from." });
                }
                targetAttendanceId = activeRecord[0].id;
            }

            // Update the record
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
    });
}