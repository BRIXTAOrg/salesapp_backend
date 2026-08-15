// src/postRoutes/institution.ts
import { Express, Response } from "express";
import { db } from "../db/db";
import { institutions } from "../db/schema";
import { authenticateToken, AuthRequest } from "../middleware/auth";

export default function setupInstitutionPostRoutes(app: Express) {
  app.post("/api/salesApp/institutions", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId; // Extract the user ID from the token

      // Basic validation
      if (!req.body.institutionName) {
        return res.status(400).json({
          success: false,
          error: "institutionName is required."
        });
      }

      // Inject the userId into the payload
      const payload = {
        ...req.body,
        userId: userId,
      };

      // Create institution
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
      // Unique constraint violation
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
  });
}