// src/getRoutes/tadabill.ts 
import { Express, Response } from "express"; 
import { tadaBills, tadaBillItems } from "../db/schema"; 
import { eq, desc } from "drizzle-orm"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 

export default function setupTadaBillRoutes(app: Express) {   
  app.get("/api/salesApp/tada-bills", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {     
    try {       
      const userId = req.user!.userId;       
      // Fetch the parent envelopes for this user       
      const bills = await db         
        .select()         
        .from(tadaBills)         
        .where(eq(tadaBills.userId, userId))         
        .orderBy(desc(tadaBills.billDate));       
      // Map through and fetch the nested items for each bill        
      // (This guarantees the JSON payload structure matches the POST payload)       
      const dataWithItems = await Promise.all(         
        bills.map(async (bill) => {           
          const items = await db             
            .select()             
            .from(tadaBillItems)             
            .where(eq(tadaBillItems.billId, bill.id));                        
          return { ...bill, items };         
        })       
      );       
      return res.status(200).json({ success: true, data: dataWithItems });     
    } catch (err: any) {       
      console.error("Error fetching TA/DA Bills:", err);       
      return res.status(500).json({ success: false, error: "Internal server error" });     
    }   
  })); 
}