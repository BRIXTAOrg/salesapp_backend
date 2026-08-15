// src/auth/login.ts
import { Express, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db/db"; 
import { users } from "../db/schema";
import { eq, or } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development";

export default function setupAuthRoutes(app: Express) {
  
  app.post("/api/salesApp/auth/login", async (req: Request, res: Response) => {
    try {
      // Accepts phone number/salesmanLoginId in the body
      const { salesmanLoginId, phoneNumber, username, password } = req.body;

      // Identify the login identifier provided (phone number or login ID)
      const loginIdentifier = (salesmanLoginId || phoneNumber || username)?.trim();

      if (!loginIdentifier || !password) {
        return res.status(400).json({ 
          success: false, 
          error: "Phone number / Login ID and password are required." 
        });
      }

      // 1. Find user by matching either salesmanLoginId or phoneNumber
      const userResult = await db
        .select()
        .from(users)
        .where(
          or(
            eq(users.salesmanLoginId, loginIdentifier),
            eq(users.phoneNumber, loginIdentifier)
          )
        )
        .limit(1);

      const user = userResult[0];

      if (!user) {
        return res.status(401).json({ 
          success: false, 
          error: "Invalid Phone Number or Password." 
        });
      }

      // 2. CRITICAL SECURITY CHECK: Verify Sales App User flag
      if (!user.isSalesAppUser) {
        return res.status(403).json({ 
          success: false, 
          error: "Access Denied: This account does not have Sales App privileges." 
        });
      }

      // 3. Verify Password
      if (user.salesAppPassword !== password) {
        return res.status(401).json({ 
          success: false, 
          error: "Invalid Phone Number or Password." 
        });
      }

      // 4. Update status to 'active' if not already active
      if (user.status !== 'active') {
        await db.update(users)
          .set({ status: 'active' })
          .where(eq(users.id, user.id));
      }

      // 5. Generate JWT Token (valid for 7 days)
      const tokenPayload = {
        userId: user.id,
        email: user.email,
        username: user.username,
        orgRole: user.role,
        phoneNumber: user.phoneNumber,
        area: user.area,
        zone: user.zone,
      };

      const token = jwt.sign(tokenPayload, JWT_SECRET, { 
        expiresIn: '7d' 
      });

      // 6. Return response matching Flutter auth_service
      return res.status(200).json({
        success: true,
        token: token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          phoneNumber: user.phoneNumber,
          role: user.role,
          area: user.area,
          zone: user.zone,
          isSalesAppUser: user.isSalesAppUser,
        }
      });

    } catch (err: any) {
      console.error("Login route error:", err);
      return res.status(500).json({ 
        success: false, 
        error: "Internal server error during login." 
      });
    }
  });
}