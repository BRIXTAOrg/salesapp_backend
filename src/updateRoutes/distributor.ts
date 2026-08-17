// src/updateRoutes/distributor.ts 
import { Express, Response } from "express"; 
import { distributors } from "../db/schema"; 
import { eq, and } from "drizzle-orm"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 

export default function setupDistributorUpdateRoutes(app: Express) {     
    const updateHandler = withTenantDb<AuthRequest>(async (req, res, db) => {         
        try {             
            const { id } = req.params;             
            const userId = req.user!.userId;             
            const { id: _id, userId: _userId, createdAt, ...updateData } = req.body;             
            if (Object.keys(updateData).length === 0) {                 
                return res.status(400).json({ success: false, error: "No update data provided." });             
            }             
            const [updatedDistributor] = await db.update(distributors)                 
                .set({                     
                    ...updateData,                     
                    updatedAt: new Date(),                 
                })                 
                .where(                     
                    and(                         
                        eq(distributors.id, Number(id)),                         
                        eq(distributors.userId, userId)                     
                    )                 
                )                 
                .returning();             
            if (!updatedDistributor) {                 
                return res.status(404).json({ success: false, error: "Distributor not found or unauthorized." });             
            }             
            return res.status(200).json({ success: true, data: updatedDistributor });         
        } catch (err: any) {             
            console.error("Error updating distributor:", err);             
            if (err.code === '23505') {                 
                return res.status(409).json({ success: false, error: "Update failed: Data conflict." });             
            }             
            return res.status(500).json({ success: false, error: "Internal server error" });         
        }     
    });     
    app.put("/api/salesApp/distributors/:id", authenticateToken, updateHandler);     
    app.patch("/api/salesApp/distributors/:id", authenticateToken, updateHandler); 
}