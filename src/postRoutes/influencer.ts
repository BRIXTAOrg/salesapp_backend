// src/postRoutes/influencer.ts 
import { Express, Response } from "express"; 
import { influencers } from "../db/schema"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 

export default function setupInfluencerPostRoutes(app: Express) {   
  app.post("/api/salesApp/influencers", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {     
    try {       
      const userId = req.user!.userId;       
      if (!req.body.contactPersonName) {         
        return res.status(400).json({           
          success: false,           
          error: "contactPersonName is required."         
        });       
      }       
      const payload = {         
        ...req.body,         
        userId: userId,       
      };       
      const [newInfluencer] = await db         
        .insert(influencers)         
        .values(payload)         
        .returning();       
      return res.status(201).json({         
        success: true,         
        data: newInfluencer       
      });     
    } catch (err: any) {       
      console.error("Error creating influencer:", err);       
      if (err.code === '23505') {         
        return res.status(409).json({           
          success: false,           
          error: "An influencer with this information already exists."         
        });       
      }       
      return res.status(500).json({         
        success: false,         
        error: "Internal server error"       
      });     
    }   
  })); 
}