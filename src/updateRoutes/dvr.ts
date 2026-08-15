// src/updateRoutes/dvr.ts
import { Express, Response } from "express";
import { db } from "../db/db";
import { dailyVisitReports } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { authenticateToken, AuthRequest } from "../middleware/auth";

export default function setupDvrUpdateRoutes(app: Express) {
    const updateHandler = async (req: AuthRequest, res: Response) => {
        try {
            const id = String(req.params.id);
            const userId = req.user!.userId;

            // Sanitize payload
            const { id: _id, userId: _userId, createdAt, ...updateData } = req.body;

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({ success: false, error: "No update data provided." });
            }

            // Parse dates if provided
            if (updateData.reportDate) updateData.reportDate = new Date(updateData.reportDate);
            if (updateData.checkInTime) updateData.checkInTime = new Date(updateData.checkInTime);
            if (updateData.checkOutTime) updateData.checkOutTime = new Date(updateData.checkOutTime);
            if (updateData.expectedActivationDate) updateData.expectedActivationDate = new Date(updateData.expectedActivationDate);

            const [updatedDvr] = await db.update(dailyVisitReports)
                .set({
                    ...updateData,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(dailyVisitReports.id, id),
                        eq(dailyVisitReports.userId, userId)
                    )
                )
                .returning();

            if (!updatedDvr) {
                return res.status(404).json({ success: false, error: "DVR not found or unauthorized." });
            }

            return res.status(200).json({ success: true, data: updatedDvr });
        } catch (err: any) {
            console.error("Error updating DVR:", err);
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    };

    app.put("/api/salesApp/daily-visit-reports/:id", authenticateToken, updateHandler);
    app.patch("/api/salesApp/daily-visit-reports/:id", authenticateToken, updateHandler);
}