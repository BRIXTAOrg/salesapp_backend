// src/postRoutes/outlet.ts
import { Express, Response } from "express";
import { db } from "../db/db";
import { outlets } from "../db/schema";
import { authenticateToken, AuthRequest } from "../middleware/auth";

export default function setupOutletPostRoutes(app: Express) {
  app.post("/api/salesApp/outlets", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;

      // Basic validation based on schema
      if (!req.body.name || !req.body.concernedPersonName || !req.body.concernedPersonPhoneNum || !req.body.address) {
        return res.status(400).json({ 
            success: false, 
            error: "name, concernedPersonName, concernedPersonPhoneNum, and address are required." 
        });
      }

      // Inject the user ID from the token.
      // Note: distributorId is optional in the schema, so it can be null if unlinked.
      const outletPayload = {
        ...req.body,
        userId: userId,
      };

      const [newOutlet] = await db
        .insert(outlets)
        .values(outletPayload)
        .returning();

      return res.status(201).json({ success: true, data: newOutlet });
    } catch (err: any) {
      console.error("Error creating outlet:", err);
      if (err.code === '23505') {
         return res.status(409).json({ success: false, error: "An outlet with this information already exists." });
      }
      return res.status(500).json({ success: false, error: "Internal server error" });
    }
  });
}