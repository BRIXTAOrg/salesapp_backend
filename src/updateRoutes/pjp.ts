// src/updateRoutes/pjp.ts 
import { Express, Response } from "express"; 
import { permanentJourneyPlans } from "../db/schema"; 
import { eq, and } from "drizzle-orm"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 

export default function setupPjpUpdateRoutes(app: Express) {     
    const updateHandler = withTenantDb<AuthRequest>(async (req, res, db) => {         
        try {             
            const id = String(req.params.id);             
            const userId = req.user!.userId;             
            const { id: _id, userId: _userId, createdById: _createdById, createdAt, ...updateData } = req.body;             
            if (Object.keys(updateData).length === 0) {                 
                return res.status(400).json({ success: false, error: "No update data provided." });             
            }             
            if (updateData.planDate) updateData.planDate = new Date(updateData.planDate);                          
            if (updateData.noOfDealerVisits !== undefined) updateData.noOfDealerVisits = updateData.noOfDealerVisits ? Number(updateData.noOfDealerVisits) : null;             
            if (updateData.noOfInstitutionVisits !== undefined) updateData.noOfInstitutionVisits = updateData.noOfInstitutionVisits ? Number(updateData.noOfInstitutionVisits) : null;             
            if (updateData.noOfInfluencerVisits !== undefined) updateData.noOfInfluencerVisits = updateData.noOfInfluencerVisits ? Number(updateData.noOfInfluencerVisits) : null;             
            const [updatedPjp] = await db.update(permanentJourneyPlans)                 
                .set({                     
                    ...updateData,                     
                    updatedAt: new Date(),                 
                })                 
                .where(                     
                    and(                         
                        eq(permanentJourneyPlans.id, id),                         
                        eq(permanentJourneyPlans.userId, userId)                     
                    )                 
                )                 
                .returning();             
            if (!updatedPjp) {                 
                return res.status(404).json({ success: false, error: "PJP not found or unauthorized." });             
            }             
            return res.status(200).json({ success: true, data: updatedPjp });         
        } catch (err: any) {             
            console.error("Error updating PJP:", err);             
            return res.status(500).json({ success: false, error: "Internal server error" });         
        }     
    });     
    app.put("/api/salesApp/permanent-journey-plans/:id", authenticateToken, updateHandler);     
    app.patch("/api/salesApp/permanent-journey-plans/:id", authenticateToken, updateHandler); 
}