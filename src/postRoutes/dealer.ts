// src/postRoutes/dealer.ts
import { Express, Response } from "express";
import { db } from "../db/db";
import { dealers } from "../db/schema";
import { authenticateToken, AuthRequest } from "../middleware/auth";

export default function setupDealerPostRoutes(app: Express) {
  app.post("/api/salesApp/dealers", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId; // <-- Get user ID from token

      if (!req.body.dealerPartyName) {
        return res.status(400).json({ success: false, error: "dealerPartyName is required." });
      }

      // Inject the userId into the payload
      const payload = {
        ...req.body,
        userId: userId, 
      };

      const [newDealer] = await db.insert(dealers)
        .values(payload) // <-- Use the combined payload
        .returning();

      return res.status(201).json({ success: true, data: newDealer });
    } catch (err: any) {
      console.error("Error creating dealer:", err);
      if (err.code === '23505') { 
         return res.status(409).json({ success: false, error: "A dealer with this information already exists." });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  });
}