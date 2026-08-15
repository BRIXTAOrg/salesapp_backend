// src/postRoutes/leave.ts
import { Express, Response } from "express";
import { db } from "../db/db";
import { salesmanLeaveApplications } from "../db/schema";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { randomUUID } from "crypto";

export default function setupLeavePostRoutes(app: Express) {
    app.post("/api/salesApp/leaves", authenticateToken, async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user!.userId;
            const { leaveType, startDate, endDate, reason } = req.body;

            if (!leaveType || !startDate || !endDate || !reason) {
                return res.status(400).json({ success: false, error: "Missing required leave fields." });
            }

            const leaveData = {
                id: randomUUID(),
                userId,
                leaveType,
                startDate,
                endDate,
                reason,
                status: "Pending",
                appRole: req.user!.orgRole,
            };

            const [newLeave] = await db
                .insert(salesmanLeaveApplications)
                .values(leaveData)
                .returning();

            return res.status(201).json({ success: true, data: newLeave });
        } catch (err: any) {
            console.error("Error creating leave:", err);
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    });
}