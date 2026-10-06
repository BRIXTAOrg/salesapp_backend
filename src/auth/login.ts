import type {
  Express,
  Request,
  Response,
} from "express";

import bcrypt from "bcryptjs";

import {
  and,
  eq,
  or,
  type InferSelectModel,
} from "drizzle-orm";

import {
  db,
  withTenantSchema,
} from "../db/db";

import {
  users,
} from "../db/schema";

import {
  employeeRuntimeState,
} from "../db/applianceSchema";

import {
  organizations,
} from "../db/publicSchema";

import {
  signMobileToken,
} from "./jwt";

import {
  clearAccountFailures,
  loginRules,
  recordFailure,
  throttleWait,
  tooManyAttemptsMessage,
} from "./loginThrottle";

type UserRow =
  InferSelectModel<
    typeof users
  >;

type LoginOutcome =
  | {
      ok: false;
      status: number;
      error: string;
      countsAsFailure?: boolean;
    }
  | {
      ok: true;
      user: UserRow;
    };

// A real hash of a random value, so an unknown login spends the same time
// as a wrong password and response timing does not reveal accounts.
let dummyHash:
  | Promise<string>
  | null = null;

function burnPasswordCheck(
  password: string,
) {
  dummyHash ??=
    bcrypt.hash(
      `brixta-dummy-${Date.now()}-${Math.random()}`,
      12,
    );

  return dummyHash.then(
    (hash) =>
      bcrypt
        .compare(
          password || "x",
          hash,
        )
        .catch(() => false),
  );
}

export default function setupAuthRoutes(
  app: Express,
) {
  app.post(
    "/api/salesApp/auth/login",
    async (
      req: Request,
      res: Response,
    ) => {
      try {
        const {
          companyCode,
          salesmanLoginId,
          phoneNumber,
          password,
        } = req.body ?? {};

        const loginIdentifier =
          String(
            salesmanLoginId ??
              phoneNumber ??
              "",
          ).trim();

        if (
          !String(
            companyCode ?? "",
          ).trim() ||
          !loginIdentifier ||
          !password
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "Company code, phone number / login ID and password are required.",
            });
        }

        // BRIXTA_LOGIN_HARDENING_V1
        const throttle =
          loginRules({
            scope: "mobile-login",
            address:
              req.ip ??
              req.socket.remoteAddress ??
              "unknown",
            account: `${String(companyCode).trim()}:${loginIdentifier}`,
          });

        const wait =
          throttleWait(throttle);

        if (wait > 0) {
          res.setHeader(
            "retry-after",
            String(wait),
          );

          return res
            .status(429)
            .json({
              success: false,
              code: "TOO_MANY_ATTEMPTS",
              error:
                tooManyAttemptsMessage(wait),
            });
        }

        const [org] =
          await db
            .select({
              schemaName:
                organizations.schemaName,
            })
            .from(organizations)
            .where(
              and(
                eq(
                  organizations.schemaName,
                  String(
                    companyCode,
                  )
                    .trim()
                    .toLowerCase(),
                ),
                eq(
                  organizations.isProvisioned,
                  true,
                ),
              ),
            )
            .limit(1);

        if (!org) {
          await burnPasswordCheck(
            String(password),
          );
          recordFailure(throttle);

          return res
            .status(401)
            .json({
              success: false,
              error:
                "Invalid login credentials.",
            });
        }

        const result:
          LoginOutcome =
          await withTenantSchema(
            org.schemaName,
            async (tx) => {
              const [user] =
                await tx
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

              // Password first: account state is only revealed to
              // someone who already knows the password.
              let passwordMatches =
                false;

              if (!user) {
                await burnPasswordCheck(
                  String(password),
                );
              } else if (
                user.salesAppPasswordHash
              ) {
                passwordMatches =
                  await bcrypt.compare(
                    String(password),
                    user.salesAppPasswordHash,
                  );
              } else if (
                user.salesAppPassword
              ) {
                await burnPasswordCheck(
                  String(password),
                );

                passwordMatches =
                  user.salesAppPassword ===
                  String(password);

                if (passwordMatches) {
                  const migratedHash =
                    await bcrypt.hash(
                      String(password),
                      12,
                    );

                  await tx
                    .update(users)
                    .set({
                      salesAppPasswordHash:
                        migratedHash,
                      salesAppPassword:
                        null,
                      updatedAt:
                        new Date().toISOString(),
                    })
                    .where(
                      eq(
                        users.id,
                        user.id,
                      ),
                    );
                }
              } else {
                await burnPasswordCheck(
                  String(password),
                );
              }

              if (
                !user ||
                !passwordMatches
              ) {
                return {
                  ok: false,
                  status: 401,
                  error:
                    "Invalid login credentials.",
                  countsAsFailure: true,
                };
              }

              if (!user.isSalesAppUser) {
                return {
                  ok: false,
                  status: 403,
                  error:
                    "Sales app access is not enabled for this account. Contact management.",
                };
              }

              if (
                user.status !==
                "active"
              ) {
                return {
                  ok: false,
                  status: 403,
                  error:
                    "This employee account is inactive. Contact management.",
                };
              }

              const now =
                new Date();

              await tx
                .insert(
                  employeeRuntimeState,
                )
                .values({
                  userId:
                    user.id,
                  lastLoginAt:
                    now,
                  lastSeenAt:
                    now,
                  updatedAt:
                    now,
                })
                .onConflictDoUpdate({
                  target:
                    employeeRuntimeState.userId,
                  set: {
                    lastLoginAt:
                      now,
                    lastSeenAt:
                      now,
                    updatedAt:
                      now,
                  },
                });

              return {
                ok: true,
                user,
              };
            },
          );

        if (!result.ok) {
          if (result.countsAsFailure) {
            recordFailure(throttle);
          }

          return res
            .status(
              result.status,
            )
            .json({
              success: false,
              error:
                result.error,
            });
        }

        clearAccountFailures(throttle);

        const { user } =
          result;

        const token =
          signMobileToken({
            userId:
              user.id,
            schemaName:
              org.schemaName,
            email:
              user.email,
            username:
              user.username,
            orgRole:
              user.role,
            phoneNumber:
              user.phoneNumber,
            area:
              user.area,
            zone:
              user.zone,
          });

        console.log(
          `[AUTH] Login success: schema=${org.schemaName}, userId=${user.id}, employee=${user.salesmanLoginId}`,
        );

        return res
          .status(200)
          .json({
            success: true,
            token,

            user: {
              id:
                user.id,
              employeeCode:
                user.salesmanLoginId,
              username:
                user.username,
              displayName:
                user.displayName ??
                user.username ??
                user.salesmanLoginId,
              email:
                user.email,
              phoneNumber:
                user.phoneNumber,
              role:
                user.role,
              department:
                user.department,
              designation:
                user.designation,
              area:
                user.area,
              zone:
                user.zone,
              isSalesAppUser:
                user.isSalesAppUser,
            },
          });
      } catch (error) {
        console.error(
          "Sales app login route error:",
          error,
        );

        return res
          .status(500)
          .json({
            success: false,
            error:
              "Internal server error during login.",
          });
      }
    },
  );
}
