import type {
  Express,
  Request,
  Response,
} from "express";

import bcrypt from "bcryptjs";
import {
  asc,
  eq,
  inArray,
} from "drizzle-orm";

import { db } from "../db/db";
import {
  mobileCapabilities,
  userMobileCapabilities,
  users,
} from "../db/schema";

const SUPPORTED_CAPABILITY_TYPES =
  new Set([
    "form",
    "approval_queue",
    "tracking",
    "report",
    "checklist",
    "data_view",
    "status_update",
    "upload",
    "native",
  ]);

function requireAdmin(
  req: Request,
  res: Response,
): boolean {
  const expectedSecret =
    process.env.FLOW1_ADMIN_SECRET;

  const suppliedSecret =
    req.headers[
      "x-flow1-admin-secret"
    ];

  if (
    !expectedSecret ||
    suppliedSecret !== expectedSecret
  ) {
    res.status(401).json({
      success: false,
      error: "Unauthorized.",
    });

    return false;
  }

  return true;
}

function normalizeCapabilityIds(
  raw: unknown,
): number[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return Array.from(
    new Set(
      raw
        .map(Number)
        .filter(
          (value) =>
            Number.isInteger(value) &&
            value > 0,
        ),
    ),
  );
}

async function validateCapabilityIds(
  capabilityIds: number[],
  tx: Parameters<
    Parameters<typeof db.transaction>[0]
  >[0],
) {
  if (capabilityIds.length === 0) {
    return;
  }

  const valid =
    await tx
      .select({
        id: mobileCapabilities.id,
      })
      .from(mobileCapabilities)
      .where(
        inArray(
          mobileCapabilities.id,
          capabilityIds,
        ),
      );

  if (
    valid.length !==
    capabilityIds.length
  ) {
    throw new Error(
      "One or more capability IDs are invalid.",
    );
  }
}

export default function setupMobileWorkspaceAdminRoutes(
  app: Express,
) {
  // -----------------------------------------------------
  // CAPABILITIES
  // -----------------------------------------------------

  app.get(
    "/api/admin/flow1/capabilities",
    async (
      req: Request,
      res: Response,
    ) => {
      if (!requireAdmin(req, res)) {
        return;
      }

      try {
        const capabilities =
          await db
            .select()
            .from(mobileCapabilities)
            .orderBy(
              asc(
                mobileCapabilities.title,
              ),
            );

        return res.json({
          success: true,
          capabilities,
        });
      } catch (error) {
        console.error(
          "Get capabilities error:",
          error,
        );

        return res.status(500).json({
          success: false,
          error:
            "Unable to load capabilities.",
        });
      }
    },
  );

  app.post(
    "/api/admin/flow1/capabilities",
    async (
      req: Request,
      res: Response,
    ) => {
      if (!requireAdmin(req, res)) {
        return;
      }

      try {
        const {
          key,
          title,
          type,
          description,
          icon,
          config,
        } = req.body ?? {};

        const normalizedKey =
          String(key ?? "")
            .trim()
            .toLowerCase()
            .replace(
              /[^a-z0-9_]+/g,
              "_",
            )
            .replace(
              /^_+|_+$/g,
              "",
            );

        const normalizedTitle =
          String(title ?? "").trim();

        if (
          !normalizedKey ||
          !normalizedTitle ||
          !SUPPORTED_CAPABILITY_TYPES.has(
            String(type),
          )
        ) {
          return res.status(400).json({
            success: false,
            error:
              "key, title and a supported type are required.",
          });
        }

        const [capability] =
          await db
            .insert(
              mobileCapabilities,
            )
            .values({
              key: normalizedKey,
              title: normalizedTitle,
              type: String(type),
              description:
                String(
                  description ?? "",
                ).trim() || null,
              icon:
                String(
                  icon ?? "",
                ).trim() || null,
              config:
                config &&
                typeof config ===
                  "object" &&
                !Array.isArray(config)
                  ? config
                  : {},
            })
            .returning();

        return res
          .status(201)
          .json({
            success: true,
            capability,
          });
      } catch (error: any) {
        console.error(
          "Create capability error:",
          error,
        );

        return res.status(400).json({
          success: false,
          error:
            error?.message ??
            "Unable to create capability.",
        });
      }
    },
  );

  // -----------------------------------------------------
  // EMPLOYEES
  // -----------------------------------------------------

  app.get(
    "/api/admin/flow1/employees",
    async (
      req: Request,
      res: Response,
    ) => {
      if (!requireAdmin(req, res)) {
        return;
      }

      try {
        const employees =
          await db
            .select({
              id: users.id,
              employeeCode:
                users.salesmanLoginId,
              name: users.displayName,
              username:
                users.username,
              department:
                users.department,
              designation:
                users.designation,
              phoneNumber:
                users.phoneNumber,
              role: users.role,
              area: users.area,
              zone: users.zone,
              status: users.status,
            })
            .from(users)
            .where(
              eq(
                users.isSalesAppUser,
                true,
              ),
            )
            .orderBy(
              asc(users.id),
            );

        return res.json({
          success: true,
          employees,
        });
      } catch (error) {
        console.error(
          "Get employees error:",
          error,
        );

        return res.status(500).json({
          success: false,
          error:
            "Unable to load employees.",
        });
      }
    },
  );

  app.post(
    "/api/admin/flow1/employees",
    async (
      req: Request,
      res: Response,
    ) => {
      if (!requireAdmin(req, res)) {
        return;
      }

      const {
        employeeCode,
        password,
        name,
        department,
        designation,
        phoneNumber,
        email,
        role,
        area,
        zone,
        capabilityIds = [],
      } = req.body ?? {};

      const normalizedEmployeeCode =
        String(
          employeeCode ?? "",
        ).trim();

      const normalizedName =
        String(name ?? "").trim();

      if (
        !normalizedEmployeeCode ||
        !password ||
        !normalizedName
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Employee code, name and password are required.",
        });
      }

      try {
        const ids =
          normalizeCapabilityIds(
            capabilityIds,
          );

        const passwordHash =
          await bcrypt.hash(
            String(password),
            12,
          );

        const employee =
          await db.transaction(
            async (tx) => {
              await validateCapabilityIds(
                ids,
                tx,
              );

              const [created] =
                await tx
                  .insert(users)
                  .values({
                    email:
                      String(
                        email ?? "",
                      ).trim() ||
                      `${normalizedEmployeeCode.toLowerCase()}@mobile.local`,

                    username:
                      normalizedName,

                    displayName:
                      normalizedName,

                    phoneNumber:
                      String(
                        phoneNumber ?? "",
                      ).trim() ||
                      null,

                    department:
                      String(
                        department ?? "",
                      ).trim() ||
                      null,

                    designation:
                      String(
                        designation ?? "",
                      ).trim() ||
                      null,

                    role:
                      String(
                        role ?? "",
                      ).trim() ||
                      String(
                        designation ?? "",
                      ).trim() ||
                      "EMPLOYEE",

                    status: "active",

                    area:
                      String(
                        area ?? "",
                      ).trim() ||
                      null,

                    zone:
                      String(
                        zone ?? "",
                      ).trim() ||
                      null,

                    isSalesAppUser:
                      true,

                    salesmanLoginId:
                      normalizedEmployeeCode,

                    // New employee passwords are
                    // NEVER stored in plaintext.
                    salesAppPassword:
                      null,

                    salesAppPasswordHash:
                      passwordHash,

                    updatedAt:
                      new Date().toISOString(),
                  })
                  .returning();

              if (ids.length > 0) {
                await tx
                  .insert(
                    userMobileCapabilities,
                  )
                  .values(
                    ids.map(
                      (
                        capabilityId,
                        index,
                      ) => ({
                        userId:
                          created.id,
                        capabilityId,
                        sortOrder:
                          index,
                      }),
                    ),
                  );
              }

              return created;
            },
          );

        return res
          .status(201)
          .json({
            success: true,
            employee: {
              id: employee.id,
              employeeCode:
                employee.salesmanLoginId,
              name:
                employee.displayName,
              department:
                employee.department,
              designation:
                employee.designation,
            },
          });
      } catch (error: any) {
        console.error(
          "Create employee error:",
          error,
        );

        return res.status(400).json({
          success: false,
          error:
            error?.message ??
            "Unable to create employee.",
        });
      }
    },
  );

  app.put(
    "/api/admin/flow1/employees/:id/capabilities",
    async (
      req: Request,
      res: Response,
    ) => {
      if (!requireAdmin(req, res)) {
        return;
      }

      const userId =
        Number(req.params.id);

      if (
        !Number.isInteger(userId) ||
        userId <= 0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Invalid employee ID.",
        });
      }

      const ids =
        normalizeCapabilityIds(
          req.body?.capabilityIds,
        );

      try {
        await db.transaction(
          async (tx) => {
            const [employee] =
              await tx
                .select({
                  id: users.id,
                  isSalesAppUser:
                    users.isSalesAppUser,
                })
                .from(users)
                .where(
                  eq(
                    users.id,
                    userId,
                  ),
                )
                .limit(1);

            if (
              !employee ||
              !employee.isSalesAppUser
            ) {
              throw new Error(
                "Mobile employee not found.",
              );
            }

            await validateCapabilityIds(
              ids,
              tx,
            );

            await tx
              .delete(
                userMobileCapabilities,
              )
              .where(
                eq(
                  userMobileCapabilities.userId,
                  userId,
                ),
              );

            if (ids.length > 0) {
              await tx
                .insert(
                  userMobileCapabilities,
                )
                .values(
                  ids.map(
                    (
                      capabilityId,
                      index,
                    ) => ({
                      userId,
                      capabilityId,
                      sortOrder:
                        index,
                    }),
                  ),
                );
            }
          },
        );

        return res.json({
          success: true,
        });
      } catch (error: any) {
        console.error(
          "Update employee capabilities error:",
          error,
        );

        return res.status(400).json({
          success: false,
          error:
            error?.message ??
            "Unable to update employee capabilities.",
        });
      }
    },
  );
}
