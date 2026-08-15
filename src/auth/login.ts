import type {
  Express,
  Request,
  Response,
} from "express";

import bcrypt from "bcryptjs";
import {
  eq,
  or,
} from "drizzle-orm";

import { db } from "../db/db";
import { users } from "../db/schema";
import { employeeRuntimeState } from "../db/applianceSchema";
import { signMobileToken } from "./jwt";

export default function setupAuthRoutes(app: Express) {
  app.post(
    "/api/salesApp/auth/login",
    async (req: Request, res: Response) => {
      try {
        const {
          salesmanLoginId,
          phoneNumber,
          password,
        } = req.body ?? {};

        const loginIdentifier = String(
          salesmanLoginId ??
            phoneNumber ??
            "",
        ).trim();

        if (!loginIdentifier || !password) {
          return res.status(400).json({
            success: false,
            error:
              "Phone number / Login ID and password are required.",
          });
        }

        console.log(
          `[AUTH] Login attempt: ${loginIdentifier}`,
        );

        const [user] = await db
          .select()
          .from(users)
          .where(
            or(
              eq(
                users.salesmanLoginId,
                loginIdentifier,
              ),
              eq(
                users.phoneNumber,
                loginIdentifier,
              ),
            ),
          )
          .limit(1);

        if (!user || !user.isSalesAppUser) {
          return res.status(401).json({
            success: false,
            error: "Invalid login credentials.",
          });
        }

        if (user.status !== "active") {
          return res.status(403).json({
            success: false,
            error:
              "This employee account is inactive. Contact management.",
          });
        }

        let passwordMatches = false;

        if (user.salesAppPasswordHash) {
          passwordMatches = await bcrypt.compare(
            String(password),
            user.salesAppPasswordHash,
          );
        } else if (user.salesAppPassword) {
          passwordMatches =
            user.salesAppPassword ===
            String(password);

          if (passwordMatches) {
            const migratedHash =
              await bcrypt.hash(
                String(password),
                12,
              );

            await db
              .update(users)
              .set({
                salesAppPasswordHash:
                  migratedHash,
                salesAppPassword:
                  null,
                updatedAt:
                  new Date().toISOString(),
              })
              .where(eq(users.id, user.id));
          }
        }

        if (!passwordMatches) {
          return res.status(401).json({
            success: false,
            error: "Invalid login credentials.",
          });
        }

        const now = new Date();

        await db
          .insert(employeeRuntimeState)
          .values({
            userId: user.id,
            lastLoginAt: now,
            lastSeenAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: employeeRuntimeState.userId,
            set: {
              lastLoginAt: now,
              lastSeenAt: now,
              updatedAt: now,
            },
          });

        const token = signMobileToken({
          userId: user.id,
          email: user.email,
          username: user.username,
          orgRole: user.role,
          phoneNumber: user.phoneNumber,
          area: user.area,
          zone: user.zone,
        });

        console.log(
          `[AUTH] Login success: userId=${user.id}, employee=${user.salesmanLoginId}`,
        );

        return res.status(200).json({
          success: true,
          token,
          user: {
            id: user.id,
            employeeCode:
              user.salesmanLoginId,
            username: user.username,
            displayName:
              user.displayName ??
              user.username ??
              user.salesmanLoginId,
            email: user.email,
            phoneNumber:
              user.phoneNumber,
            role: user.role,
            department:
              user.department,
            designation:
              user.designation,
            area: user.area,
            zone: user.zone,
            isSalesAppUser:
              user.isSalesAppUser,
          },
        });
      } catch (error) {
        console.error(
          "Sales app login route error:",
          error,
        );

        return res.status(500).json({
          success: false,
          error:
            "Internal server error during login.",
        });
      }
    },
  );
}
