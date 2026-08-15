// src/postRoutes/influencer.ts
import { Express, Response } from "express";
import { db } from "../db/db";
import { influencers } from "../db/schema";
import { authenticateToken, AuthRequest } from "../middleware/auth";

export default function setupInfluencerPostRoutes(app: Express) {
  app.post("/api/salesApp/influencers", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId; // Extract the user ID from the token

      // ===============================================
      // BASIC VALIDATION
      // ===============================================
      if (!req.body.contactPersonName) {
        return res.status(400).json({
          success: false,
          error: "contactPersonName is required."
        });
      }

      // Inject the userId into the payload
      const payload = {
        ...req.body,
        userId: userId,
      };

      // ===============================================
      // INSERT
      // ===============================================
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
  });
}