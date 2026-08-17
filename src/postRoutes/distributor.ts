// src/postRoutes/distributor.ts 
import { Express, Response } from "express"; 
import { distributors } from "../db/schema"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 

export default function setupDistributorPostRoutes(app: Express) {   
  app.post("/api/salesApp/distributors", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {     
    try {       
      const userId = req.user!.userId;       
      if (!req.body.name || !req.body.concernedPersonName || !req.body.concernedPersonPhoneNum || !req.body.address) {         
        return res.status(400).json({              
             success: false,              
             error: "name, concernedPersonName, concernedPersonPhoneNum, and address are required."          
         });       
      }       
      const distributorPayload = {         
        ...req.body,         
        userId: userId,       
      };       
      const [newDistributor] = await db         
        .insert(distributors)         
        .values(distributorPayload)         
        .returning();       
      return res.status(201).json({ success: true, data: newDistributor });     
    } catch (err: any) {       
      console.error("Error creating distributor:", err);       
      if (err.code === '23505') {          
         return res.status(409).json({ success: false, error: "A distributor with this information already exists." });       
      }       
      return res.status(500).json({ success: false, error: "Internal server error" });     
    }   
  })); 
}