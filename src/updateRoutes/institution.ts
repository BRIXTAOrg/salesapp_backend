// src/updateRoutes/institution.ts

import { Express, Response } from "express";
import { db } from "../db/db";
import { institutions } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { authenticateToken, AuthRequest } from "../middleware/auth";

export default function setupInstitutionUpdateRoutes(app: Express) {

    const updateHandler = async (req: AuthRequest, res: Response) => {
        try {

            const { id } = req.params;
            const userId = req.user!.userId; // <-- Get user ID

            // Prevent updating restricted fields
            const {
                id: _id,
                userId: _userId,
                createdAt,
                ...updateData
            } = req.body;

            // Empty update check
            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({
                    success: false,
                    error: "No update data provided."
                });
            }

            // Update
            const [updatedInstitution] = await db
                .update(institutions)
                .set({
                    ...updateData,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(institutions.id, Number(id)),
                        eq(institutions.userId, userId) // <-- Enforce ownership
                    )
                )
                .returning();

            // Not found
            if (!updatedInstitution) {
                return res.status(404).json({
                    success: false,
                    error: "Institution not found."
                });
            }

            return res.status(200).json({
                success: true,
                data: updatedInstitution
            });

        } catch (err: any) {

            console.error("Error updating institution:", err);

            // Duplicate conflict
            if (err.code === '23505') {
                return res.status(409).json({
                    success: false,
                    error: "Update failed: Data conflict."
                });
            }

            return res.status(500).json({
                success: false,
                error: "Internal server error"
            });
        }
    };

    app.put("/api/salesApp/institutions/:id", authenticateToken, updateHandler);
    app.patch("/api/salesApp/institutions/:id", authenticateToken, updateHandler);
}