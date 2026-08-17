// src/updateRoutes/tadabill.ts 
import { Express, Response } from "express"; 
import { tadaBills } from "../db/schema"; 
import { eq, and } from "drizzle-orm"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 

export default function setupTadaBillUpdateRoutes(app: Express) {     
    const updateHandler = withTenantDb<AuthRequest>(async (req, res, db) => {         
        try {             
            const id = String(req.params.id);             
            const userId = req.user!.userId;             
            const { id: _id, userId: _userId, createdAt, items, ...updateData } = req.body;             
            if (Object.keys(updateData).length === 0) {                 
                return res.status(400).json({ success: false, error: "No update data provided." });             
            }             
            if (updateData.billDate) updateData.billDate = new Date(updateData.billDate);             
            if (updateData.fromDate) updateData.fromDate = new Date(updateData.fromDate);             
            if (updateData.toDate) updateData.toDate = new Date(updateData.toDate);             
            if (updateData.billDate) updateData.billDate = new Date(updateData.billDate);             
            const [updatedBill] = await db.update(tadaBills)                 
                .set({                     
                    ...updateData,                     
                    updatedAt: new Date(),                 
                })                 
                .where(                     
                    and(                         
                        eq(tadaBills.id, id),                         
                        eq(tadaBills.userId, userId)                     
                    )                 
                )                 
                .returning();             
            if (!updatedBill) {                 
                return res.status(404).json({ success: false, error: "TA/DA Bill not found or unauthorized." });             
            }             
            return res.status(200).json({ success: true, data: updatedBill });         
        } catch (err: any) {             
            console.error("Error updating TA/DA Bill:", err);             
            return res.status(500).json({ success: false, error: "Internal server error" });         
        }     
    });     
    app.put("/api/salesApp/tada-bills/:id", authenticateToken, updateHandler);     
    app.patch("/api/salesApp/tada-bills/:id", authenticateToken, updateHandler); 
}