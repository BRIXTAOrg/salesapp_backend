// src/postRoutes/institution.ts 
import { Express, Response } from "express"; 
import { institutions } from "../db/schema"; 
import { authenticateToken, withTenantDb, AuthRequest } from "../middleware/auth"; 

export default function setupInstitutionPostRoutes(app: Express) {   
  app.post("/api/salesApp/institutions", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {     
    try {       
      const userId = req.user!.userId;       
      if (!req.body.institutionName) {         
        return res.status(400).json({           
          success: false,           
          error: "institutionName is required."         
        });       
      }       
      const payload = {         
        ...req.body,         
        userId: userId,       
      };       
      const [newInstitution] = await db         
        .insert(institutions)         
        .values(payload)         
        .returning();       
      return res.status(201).json({         
        success: true,         
        data: newInstitution       
      });     
    } catch (err: any) {       
      console.error("Error creating institution:", err);       
      if (err.code === '23505') {         
        return res.status(409).json({           
          success: false,           
          error: "An institution with this information already exists."         
        });       
      }       
      return res.status(500).json({         
        success: false,         
        error: "Internal server error"       
      });     
    }   
  })); 
}