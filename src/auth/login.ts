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

import { db, withTenantSchema } from "../db/db";
import { users } from "../db/schema";
import { employeeRuntimeState } from "../db/applianceSchema";
import { signMobileToken } from "./jwt";
import { organizations } from "../db/publicSchema";
import type { InferSelectModel } from "drizzle-orm";

type UserRow = InferSelectModel<typeof users>;

type LoginOutcome =
  | { ok: false; status: number; error: string }
  | { ok: true; user: UserRow }; // plain pgTable in the public schema

export default function setupAuthRoutes(app: Express) {
  app.post(
    "/api/salesApp/auth/login",
    async (req: Request, res: Response) => {
      try {
        const {
          companyCode,
          salesmanLoginId,
          phoneNumber,
          password,
        } = req.body ?? {};

        const loginIdentifier = String(
          salesmanLoginId ??
            phoneNumber ??
            "",
        ).trim();

        if (!String(companyCode ?? "").trim() || !loginIdentifier || !password) {
          return res.status(400).json({
            success: false,
            error:
              "Company code, phone number / login ID and password are required.",
          });
        }

        // 1. Resolve tenant. This is the ONE query in the whole app that
        // deliberately runs against the unscoped `db` -- public.organizations
        // has no tenant to resolve yet, that's what this query is for.
        const [org] = await db
          .select({ schemaName: organizations.schemaName })
          .from(organizations)
          .where(eq(organizations.schemaName, String(companyCode).trim().toLowerCase()))
          .limit(1);

        if (!org) {
          return res.status(401).json({
            success: false,
            error: "Invalid login credentials.",
          });
        }

        // 2. Now that we know the schema, do everything else inside a
        // transaction with search_path locked to it.
        const result: LoginOutcome = await withTenantSchema(org.schemaName, async (tx) => {
          const [user] = await tx
            .select()
            .from(users)
            .where(
              or(
                eq(users.salesmanLoginId, loginIdentifier),
                eq(users.phoneNumber, loginIdentifier),
              ),
            )
            .limit(1);

          if (!user || !user.isSalesAppUser) {
            return { ok: false, status: 401, error: "Invalid login credentials." };
          }

          if (user.status !== "active") {
            return {
              ok: false,
              status: 403,
              error: "This employee account is inactive. Contact management.",
            };
          }

          let passwordMatches = false;

          if (user.salesAppPasswordHash) {
            passwordMatches = await bcrypt.compare(
              String(password),
              user.salesAppPasswordHash,
            );
          } else if (user.salesAppPassword) {
            passwordMatches = user.salesAppPassword === String(password);

            if (passwordMatches) {
              const migratedHash = await bcrypt.hash(String(password), 12);

              await tx
                .update(users)
                .set({
                  salesAppPasswordHash: migratedHash,
                  salesAppPassword: null,
                  updatedAt: new Date().toISOString(),
                })
                .where(eq(users.id, user.id));
            }
          }

          if (!passwordMatches) {
            return { ok: false, status: 401, error: "Invalid login credentials." };
          }

          const now = new Date();

          await tx
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

          return { ok: true, user };
        });

        if (!result.ok) {
          return res.status(result.status).json({
            success: false,
            error: result.error,
          });
        }

        const { user } = result;

        const token = signMobileToken({
          userId: user.id,
          schemaName: org.schemaName,
          email: user.email,
          username: user.username,
          orgRole: user.role,
          phoneNumber: user.phoneNumber,
          area: user.area,
          zone: user.zone,
        });

        console.log(
          `[AUTH] Login success: schema=${org.schemaName}, userId=${user.id}, employee=${user.salesmanLoginId}`,
        );

        return res.status(200).json({
          success: true,
          token,
          user: {
            id: user.id,
            employeeCode: user.salesmanLoginId,
            username: user.username,
            displayName:
              user.displayName ??
              user.username ??
              user.salesmanLoginId,
            email: user.email,
            phoneNumber: user.phoneNumber,
            role: user.role,
            department: user.department,
            designation: user.designation,
            area: user.area,
            zone: user.zone,
            isSalesAppUser: user.isSalesAppUser,
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