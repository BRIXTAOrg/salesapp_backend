import type { Router } from "express";

import bcrypt from "bcryptjs";
import {
  asc,
  desc,
  eq,
  inArray,
} from "drizzle-orm";

import { db } from "../db/db";
import {
  mobileCapabilities,
  userMobileCapabilities,
  users,
} from "../db/schema";
import {
  deviceRegistrations,
  employeeRuntimeState,
  workItems,
} from "../db/applianceSchema";
import type { AdminRequest } from "../middleware/adminService";
import { getResolvedCapabilitiesForUser } from "../services/capabilityResolver";
import { writeAudit } from "../services/audit";

function normalizeIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];

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

async function validateCapabilityIds(ids: number[]) {
  if (ids.length === 0) return;

  const rows = await db
    .select({ id: mobileCapabilities.id })
    .from(mobileCapabilities)
    .where(inArray(mobileCapabilities.id, ids));

  if (rows.length !== ids.length) {
    throw new Error("One or more capability IDs are invalid.");
  }
}

export function registerEmployeeAdminRoutes(router: Router) {
  router.get("/employees", async (_req: AdminRequest, res) => {
    try {
      const employees = await db
        .select({
          id: users.id,
          employeeCode: users.salesmanLoginId,
          name: users.displayName,
          username: users.username,
          department: users.department,
          designation: users.designation,
          phoneNumber: users.phoneNumber,
          email: users.email,
          role: users.role,
          area: users.area,
          zone: users.zone,
          status: users.status,
          reportsToId: users.reportsToId,
          mobileAccess: users.isSalesAppUser,
          lastSeenAt: employeeRuntimeState.lastSeenAt,
          lastLoginAt: employeeRuntimeState.lastLoginAt,
        })
        .from(users)
        .leftJoin(
          employeeRuntimeState,
          eq(employeeRuntimeState.userId, users.id),
        )
        .where(eq(users.isSalesAppUser, true))
        .orderBy(asc(users.id));

      const directAssignments = await db
        .select({ userId: userMobileCapabilities.userId })
        .from(userMobileCapabilities);

      const counts = new Map<number, number>();

      for (const row of directAssignments) {
        counts.set(
          row.userId,
          (counts.get(row.userId) ?? 0) + 1,
        );
      }

      return res.json({
        success: true,
        employees: employees.map((employee) => ({
          ...employee,
          directResponsibilityCount:
            counts.get(employee.id) ?? 0,
        })),
      });
    } catch (error) {
      console.error("Get employees error:", error);
      return res.status(500).json({
        success: false,
        error: "Unable to load employees.",
      });
    }
  });

  router.get("/employees/:id", async (req: AdminRequest, res) => {
    const userId = Number(req.params.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee ID.",
      });
    }

    try {
      const [employee] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!employee || !employee.isSalesAppUser) {
        return res.status(404).json({
          success: false,
          error: "Mobile employee not found.",
        });
      }

      const [
        capabilities,
        directRows,
        devices,
        recentWork,
        runtime,
      ] = await Promise.all([
        getResolvedCapabilitiesForUser(userId),

        db
          .select({
            capabilityId: userMobileCapabilities.capabilityId,
            sortOrder: userMobileCapabilities.sortOrder,
          })
          .from(userMobileCapabilities)
          .where(eq(userMobileCapabilities.userId, userId))
          .orderBy(userMobileCapabilities.sortOrder),

        db
          .select()
          .from(deviceRegistrations)
          .where(eq(deviceRegistrations.userId, userId))
          .orderBy(desc(deviceRegistrations.lastSeenAt))
          .limit(5),

        db
          .select()
          .from(workItems)
          .where(eq(workItems.assigneeUserId, userId))
          .orderBy(desc(workItems.createdAt))
          .limit(20),

        db
          .select()
          .from(employeeRuntimeState)
          .where(eq(employeeRuntimeState.userId, userId))
          .limit(1),
      ]);

      return res.json({
        success: true,
        employee: {
          id: employee.id,
          employeeCode: employee.salesmanLoginId,
          name:
            employee.displayName ??
            employee.username ??
            employee.salesmanLoginId,
          username: employee.username,
          email: employee.email,
          phoneNumber: employee.phoneNumber,
          department: employee.department,
          designation: employee.designation,
          role: employee.role,
          area: employee.area,
          zone: employee.zone,
          reportsToId: employee.reportsToId,
          status: employee.status,
          mobileAccess: employee.isSalesAppUser,
        },
        capabilities,
        directCapabilityIds: directRows.map(
          (row) => row.capabilityId,
        ),
        devices,
        recentWork,
        runtime: runtime[0] ?? null,
      });
    } catch (error) {
      console.error("Get employee detail error:", error);
      return res.status(500).json({
        success: false,
        error: "Unable to load employee.",
      });
    }
  });

  router.post("/employees", async (req: AdminRequest, res) => {
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
      reportsToId,
      capabilityIds = [],
    } = req.body ?? {};

    const normalizedCode = String(employeeCode ?? "").trim();
    const normalizedName = String(name ?? "").trim();

    if (!normalizedCode || !password || !normalizedName) {
      return res.status(400).json({
        success: false,
        error: "Employee code, name and password are required.",
      });
    }

    try {
      const ids = normalizeIds(capabilityIds);
      await validateCapabilityIds(ids);

      const passwordHash = await bcrypt.hash(String(password), 12);

      const employee = await db.transaction(async (tx) => {
        const managerId = Number(reportsToId);

        const [created] = await tx
          .insert(users)
          .values({
            email:
              String(email ?? "").trim() ||
              `${normalizedCode.toLowerCase()}@mobile.local`,
            username: normalizedName,
            displayName: normalizedName,
            phoneNumber: String(phoneNumber ?? "").trim() || null,
            department: String(department ?? "").trim() || null,
            designation: String(designation ?? "").trim() || null,
            role:
              String(role ?? "").trim() ||
              String(designation ?? "").trim() ||
              "EMPLOYEE",
            status: "active",
            area: String(area ?? "").trim() || null,
            zone: String(zone ?? "").trim() || null,
            reportsToId:
              Number.isInteger(managerId) && managerId > 0
                ? managerId
                : null,
            isSalesAppUser: true,
            salesmanLoginId: normalizedCode,
            salesAppPassword: null,
            salesAppPasswordHash: passwordHash,
            updatedAt: new Date().toISOString(),
          })
          .returning();

        if (ids.length) {
          await tx.insert(userMobileCapabilities).values(
            ids.map((capabilityId, index) => ({
              userId: created.id,
              capabilityId,
              sortOrder: index,
            })),
          );
        }

        return created;
      });

      await writeAudit({
        actorUserId: req.adminActor?.userId,
        action: "employee.create",
        entityType: "employee",
        entityId: employee.id,
        afterState: {
          employeeCode: employee.salesmanLoginId,
          name: employee.displayName,
          capabilityIds: ids,
        },
      });

      return res.status(201).json({
        success: true,
        employee: {
          id: employee.id,
          employeeCode: employee.salesmanLoginId,
          name: employee.displayName,
          department: employee.department,
          designation: employee.designation,
        },
      });
    } catch (error: any) {
      console.error("Create employee error:", error);
      return res.status(400).json({
        success: false,
        error: error?.message ?? "Unable to create employee.",
      });
    }
  });

  router.patch("/employees/:id", async (req: AdminRequest, res) => {
    const userId = Number(req.params.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid employee ID.",
      });
    }

    const [before] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!before) {
      return res.status(404).json({
        success: false,
        error: "Employee not found.",
      });
    }

    const update: any = {
      updatedAt: new Date().toISOString(),
    };

    const mappings = [
      ["name", "displayName"],
      ["department", "department"],
      ["designation", "designation"],
      ["phoneNumber", "phoneNumber"],
      ["email", "email"],
      ["role", "role"],
      ["area", "area"],
      ["zone", "zone"],
    ] as const;

    for (const [bodyKey, dbKey] of mappings) {
      if (bodyKey in (req.body ?? {})) {
        const raw = req.body[bodyKey];
        update[dbKey] =
          raw === null
            ? null
            : String(raw).trim() || null;
      }
    }

    if ("reportsToId" in (req.body ?? {})) {
      const managerId = Number(req.body.reportsToId);
      update.reportsToId =
        Number.isInteger(managerId) && managerId > 0
          ? managerId
          : null;
    }

    if ("mobileAccess" in (req.body ?? {})) {
      update.isSalesAppUser = Boolean(req.body.mobileAccess);
    }

    const [updated] = await db
      .update(users)
      .set(update)
      .where(eq(users.id, userId))
      .returning();

    await writeAudit({
      actorUserId: req.adminActor?.userId,
      action: "employee.update",
      entityType: "employee",
      entityId: userId,
      beforeState: before,
      afterState: updated,
    });

    return res.json({
      success: true,
      employee: updated,
    });
  });

  router.post("/employees/:id/status", async (req: AdminRequest, res) => {
    const userId = Number(req.params.id);
    const status = String(req.body?.status ?? "").trim();

    if (
      !Number.isInteger(userId) ||
      userId <= 0 ||
      !["active", "inactive", "suspended"].includes(status)
    ) {
      return res.status(400).json({
        success: false,
        error: "Valid employee ID and status are required.",
      });
    }

    const [updated] = await db
      .update(users)
      .set({
        status,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId))
      .returning();

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: "Employee not found.",
      });
    }

    if (status !== "active") {
      await db
        .update(deviceRegistrations)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(deviceRegistrations.userId, userId));
    }

    await writeAudit({
      actorUserId: req.adminActor?.userId,
      action: "employee.status_change",
      entityType: "employee",
      entityId: userId,
      afterState: { status },
    });

    return res.json({
      success: true,
      employee: updated,
    });
  });

  router.post(
    "/employees/:id/reset-password",
    async (req: AdminRequest, res) => {
      const userId = Number(req.params.id);
      const password = String(req.body?.password ?? "");

      if (
        !Number.isInteger(userId) ||
        userId <= 0 ||
        password.length < 6
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Valid employee ID and password of at least 6 characters are required.",
        });
      }

      const hash = await bcrypt.hash(password, 12);

      const [updated] = await db
        .update(users)
        .set({
          salesAppPassword: null,
          salesAppPasswordHash: hash,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, userId))
        .returning({ id: users.id });

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: "Employee not found.",
        });
      }

      await db
        .update(deviceRegistrations)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(deviceRegistrations.userId, userId));

      await writeAudit({
        actorUserId: req.adminActor?.userId,
        action: "employee.password_reset",
        entityType: "employee",
        entityId: userId,
      });

      return res.json({ success: true });
    },
  );

  router.put(
    "/employees/:id/capabilities",
    async (req: AdminRequest, res) => {
      const userId = Number(req.params.id);

      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid employee ID.",
        });
      }

      const ids = normalizeIds(req.body?.capabilityIds);

      try {
        await validateCapabilityIds(ids);

        await db.transaction(async (tx) => {
          const [employee] = await tx
            .select({
              id: users.id,
              mobile: users.isSalesAppUser,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

          if (!employee || !employee.mobile) {
            throw new Error("Mobile employee not found.");
          }

          await tx
            .delete(userMobileCapabilities)
            .where(eq(userMobileCapabilities.userId, userId));

          if (ids.length) {
            await tx.insert(userMobileCapabilities).values(
              ids.map((capabilityId, index) => ({
                userId,
                capabilityId,
                sortOrder: index,
              })),
            );
          }
        });

        const resolved =
          await getResolvedCapabilitiesForUser(userId);

        await writeAudit({
          actorUserId: req.adminActor?.userId,
          action: "employee.capabilities_replace",
          entityType: "employee",
          entityId: userId,
          afterState: {
            directCapabilityIds: ids,
            resolvedCapabilityKeys: resolved.map((item) => item.key),
          },
        });

        return res.json({
          success: true,
          directCapabilityIds: ids,
          resolvedCapabilities: resolved,
        });
      } catch (error: any) {
        return res.status(400).json({
          success: false,
          error:
            error?.message ??
            "Unable to update employee responsibilities.",
        });
      }
    },
  );
}
