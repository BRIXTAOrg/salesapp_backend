// src/updateRoutes/dealer.ts
import { Express, Response } from "express";
import { db } from "../db/db";
import { dealers } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { authenticateToken, AuthRequest } from "../middleware/auth";

export default function setupDealerUpdateRoutes(app: Express) {
    const updateHandler = async (req: AuthRequest, res: Response) => {
        try {
            const { id } = req.params;
            const userId = req.user!.userId; // <-- Get user ID

            const { id: _id, userId: _userId, createdAt, ...updateData } = req.body;

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({ success: false, error: "No update data provided." });
            }

            const [updatedDealer] = await db.update(dealers)
                .set({
                    ...updateData,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(dealers.id, Number(id)),
                        eq(dealers.userId, userId) // <-- Enforce ownership
                    )
                )
                .returning();

            if (!updatedDealer) {
                return res.status(404).json({ success: false, error: "Dealer not found or unauthorized." });
            }

            return res.status(200).json({ success: true, data: updatedDealer });
        } catch (err: any) {
            console.error("Error updating dealer:", err);
            if (err.code === '23505') {
                return res.status(409).json({ success: false, error: "Update failed: Data conflict." });
            }
            return res.status(500).json({ success: false, error: "Internal server error" });
        }
    };

    app.put("/api/salesApp/dealers/:id", authenticateToken, updateHandler);
    app.patch("/api/salesApp/dealers/:id", authenticateToken, updateHandler);
}