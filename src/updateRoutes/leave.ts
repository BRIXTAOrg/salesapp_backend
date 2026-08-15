// src/updateRoutes/leave.ts
import { Express, Response } from "express";
import { db } from "../db/db";
import { salesmanLeaveApplications } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { authenticateToken, AuthRequest } from "../middleware/auth";

export default function setupLeaveUpdateRoutes(app: Express) {
    const updateHandler = async (req: AuthRequest, res: Response) => {
        try {
            const id = String(req.params.id);
            const userId = req.user!.userId;

            // Prevent overriding immutable fields
            const { id: _id, userId: _userId, createdAt, ...updateData } = req.body;

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({ success: false, error: "No update data provided." });
            }

            // Convert date strings to Date objects if they exist in the payload
            if (updateData.startDate) updateData.startDate = new Date(updateData.startDate);
            if (updateData.endDate) updateData.endDate = new Date(updateData.endDate);

            const [updatedLeave] = await db.update(salesmanLeaveApplications)
                .set({
                    ...updateData,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(salesmanLeaveApplications.id, id),
                        eq(salesmanLeaveApplications.userId, userId) // Ensure they only update their own leave
                    )
                )
                .returning();

            if (!updatedLeave) {
                return res.status(404).json({ success: false, error: "Leave application not found or unauthorized." });
            }

            return res.status(200).json({ success: true, data: updatedLeave });
        } catch (err: any) {
            console.error("Error updating leave:", err);
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    };

    app.put("/api/salesApp/leaves/:id", authenticateToken, updateHandler);
    app.patch("/api/salesApp/leaves/:id", authenticateToken, updateHandler);
}