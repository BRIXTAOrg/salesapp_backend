// src/postRoutes/pjp.ts 
import { Express, Response } from "express"; 
import { permanentJourneyPlans } from "../db/schema"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 
import crypto from "crypto"; 

export default function setupPjpPostRoutes(app: Express) {   
  app.post("/api/salesApp/permanent-journey-plans/bulk", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {     
    try {       
      const createdById = req.user!.userId;       
      const { plans } = req.body;        
      if (!plans || !Array.isArray(plans) || plans.length === 0) {         
        return res.status(400).json({ success: false, error: "An array of 'plans' is required." });       
      }       
      const formattedPlans = plans.map((plan: any) => {         
        const { id, createdAt, updatedAt, ...safePlanData } = plan;         
        return {           
          ...safePlanData,           
          id: crypto.randomUUID(),           
          userId: plan.userId || createdById,            
          createdById: createdById,           
          planDate: new Date(plan.planDate),           
          status: plan.status || 'Pending',           
          createdAt: new Date(),           
          updatedAt: new Date(),           
          noOfDealerVisits: safePlanData.noOfDealerVisits ? Number(safePlanData.noOfDealerVisits) : null,           
          noOfInstitutionVisits: safePlanData.noOfInstitutionVisits ? Number(safePlanData.noOfInstitutionVisits) : null,           
          noOfInfluencerVisits: safePlanData.noOfInfluencerVisits ? Number(safePlanData.noOfInfluencerVisits) : null,         
        };       
      });       
      const insertedPlans = await db.insert(permanentJourneyPlans)         
        .values(formattedPlans)         
        .returning();       
      return res.status(201).json({ success: true, data: insertedPlans });     
    } catch (err: any) {       
      console.error("Error bulk creating PJPs:", err);       
      return res.status(500).json({ success: false, error: "Internal server error" });     
    }   
  })); 
}