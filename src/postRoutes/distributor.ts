// src/postRoutes/distributor.ts
import { Express, Response } from "express";
import { db } from "../db/db";
import { distributors } from "../db/schema";
import { authenticateToken, AuthRequest } from "../middleware/auth";

export default function setupDistributorPostRoutes(app: Express) {
  app.post("/api/salesApp/distributors", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;

      // Basic validation based on schema
      if (!req.body.name || !req.body.concernedPersonName || !req.body.concernedPersonPhoneNum || !req.body.address) {
        return res.status(400).json({ 
            success: false, 
            error: "name, concernedPersonName, concernedPersonPhoneNum, and address are required." 
        });
      }

      // Inject the user ID from the token
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
      // Catch unique constraint violations if any are added later
      if (err.code === '23505') {
         return res.status(409).json({ success: false, error: "A distributor with this information already exists." });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  });
}