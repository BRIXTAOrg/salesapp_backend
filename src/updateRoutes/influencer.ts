// src/updateRoutes/influencer.ts 
import { Express, Response } from "express"; 
import { influencers } from "../db/schema"; 
import { eq, and } from "drizzle-orm"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 

export default function setupInfluencerUpdateRoutes(app: Express) {   
  const updateHandler = withTenantDb<AuthRequest>(async (req, res, db) => {     
    try {       
      const { id } = req.params;       
      const userId = req.user!.userId;       
      const {         
        id: _id,         
        userId: _userId,         
        createdAt,         
        ...updateData       
      } = req.body;       
      if (Object.keys(updateData).length == 0) {         
        return res.status(400).json({ success: false, error: "No update data provided." });       
      }       
      const [updatedInfluencer] = await db           
          .update(influencers)           
          .set({ ...updateData, updatedAt: new Date(),})           
          .where(             
            and(               
              eq(influencers.id, Number(id)),               
              eq(influencers.userId, userId)             
            )           
          )           
          .returning();       
      if (!updatedInfluencer) {         
        return res.status(404).json({           
          success: false, error: "Influencer not found."         
        });       
      }       
      return res.status(200).json({         
        success: true,         
        data: updatedInfluencer       
      });     
    } catch (err: any) {       
      console.error("Error updating influencer:", err);       
      if (err.code === '23505') {         
        return res.status(409).json({           
          success: false, error: "Update failed: Data conflict."         
        });       
      }       
      return res.status(500).json({         
        success: false, error: "Internal server error"       
      });     
    }   
  });   
  app.put("/api/salesApp/influencers/:id", authenticateToken, updateHandler);   
  app.patch("/api/salesApp/influencers/:id", authenticateToken, updateHandler); 
}