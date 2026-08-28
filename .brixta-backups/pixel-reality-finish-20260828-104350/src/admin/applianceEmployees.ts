import type {
  Router,
} from "express";

import bcrypt from "bcryptjs";

import {
  asc,
  eq,
  inArray,
} from "drizzle-orm";

import {
  mobileCapabilities,
  roles,
  userMobileCapabilities,
  userRoles,
  users,
} from "../db/schema";

import {
  employeeRuntimeState,
} from "../db/applianceSchema";

import type {
  AppDatabase,
} from "../db/db";

import {
  withAdminTenantDb,
  type AdminRequest,
} from "../middleware/adminService";

import {
  getResolvedCapabilitiesForUser,
} from "../services/capabilityResolver";

import {
  writeAudit,
} from "../services/audit";

function normalizeIds(
  raw: unknown,
): number[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return [
    ...new Set(
      raw
        .map(Number)
        .filter(
          (value) =>
            Number.isInteger(value) &&
            value > 0,
        ),
    ),
  ];
}

async function validateResponsibilityIds(
  db: AppDatabase,
  ids: number[],
) {
  if (!ids.length) {
    return;
  }

  const rows = await db
    .select({
      id:
        mobileCapabilities.id,
    })
    .from(
      mobileCapabilities,
    )
    .where(
      inArray(
        mobileCapabilities.id,
        ids,
      ),
    );

  if (
    rows.length !==
    ids.length
  ) {
    throw new Error(
      "One or more Responsibility IDs are invalid.",
    );
  }
}

async function validateRoleIds(
  db: AppDatabase,
  ids: number[],
) {
  if (!ids.length) {
    return;
  }

  const rows = await db
    .select({
      id:
        roles.id,
    })
    .from(roles)
    .where(
      inArray(
        roles.id,
        ids,
      ),
    );

  if (
    rows.length !==
    ids.length
  ) {
    throw new Error(
      "One or more Role IDs are invalid.",
    );
  }
}

export function registerEmployeeAdminRoutes(
  router: Router,
) {
  router.get(
    "/roles",
    withAdminTenantDb<AdminRequest>(
      async (
        _req,
        res,
        db,
      ) => {
        const rows = await db
          .select()
          .from(roles)
          .orderBy(
            asc(roles.orgRole),
            asc(roles.jobRole),
          );

        return res.json({
          success: true,
          roles:
            rows.map(
              (role) => ({
                ...role,
                label:
                  role.orgRole &&
                  role.jobRole
                    ? `${role.orgRole} · ${role.jobRole}`
                    : role.orgRole ??
                      role.jobRole ??
                      `Role ${role.id}`,
              }),
            ),
        });
      },
    ),
  );

  router.get(
    "/employees",
    withAdminTenantDb<AdminRequest>(
      async (
        _req,
        res,
        db,
      ) => {
        const employees = await db
          .select({
            id:
              users.id,
            employeeCode:
              users.salesmanLoginId,
            name:
              users.displayName,
            username:
              users.username,
            department:
              users.department,
            designation:
              users.designation,
            phoneNumber:
              users.phoneNumber,
            email:
              users.email,
            role:
              users.role,
            area:
              users.area,
            zone:
              users.zone,
            status:
              users.status,
            reportsToId:
              users.reportsToId,
            mobileAccess:
              users.isSalesAppUser,
            lastSeenAt:
              employeeRuntimeState.lastSeenAt,
            lastLoginAt:
              employeeRuntimeState.lastLoginAt,
          })
          .from(users)
          .leftJoin(
            employeeRuntimeState,
            eq(
              employeeRuntimeState.userId,
              users.id,
            ),
          )
          .where(
            eq(
              users.isSalesAppUser,
              true,
            ),
          )
          .orderBy(
            asc(users.id),
          );

        const assignments = await db
          .select({
            userId:
              userMobileCapabilities.userId,
          })
          .from(
            userMobileCapabilities,
          );

        const counts =
          new Map<number, number>();

        for (const row of assignments) {
          counts.set(
            row.userId,
            (counts.get(row.userId) ?? 0) + 1,
          );
        }

        return res.json({
          success: true,
          employees:
            employees.map(
              (employee) => ({
                ...employee,
                directResponsibilityCount:
                  counts.get(
                    employee.id,
                  ) ?? 0,
              }),
            ),
        });
      },
    ),
  );

  router.get(
    "/employees/:id",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          Number(
            req.params.id,
          );

        if (
          !Number.isInteger(userId) ||
          userId <= 0
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "Invalid employee ID.",
            });
        }

        const [employee] = await db
          .select()
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
          return res
            .status(404)
            .json({
              success: false,
              error:
                "Mobile employee not found.",
            });
        }

        const [
          responsibilities,
          directRows,
          directRoleRows,
          runtimeRows,
        ] = await Promise.all([
          getResolvedCapabilitiesForUser(
            db,
            userId,
          ),

          db
            .select({
              capabilityId:
                userMobileCapabilities.capabilityId,
              sortOrder:
                userMobileCapabilities.sortOrder,
            })
            .from(
              userMobileCapabilities,
            )
            .where(
              eq(
                userMobileCapabilities.userId,
                userId,
              ),
            )
            .orderBy(
              userMobileCapabilities.sortOrder,
            ),

          db
            .select({
              roleId:
                userRoles.roleId,
            })
            .from(userRoles)
            .where(
              eq(
                userRoles.userId,
                userId,
              ),
            ),

          db
            .select()
            .from(
              employeeRuntimeState,
            )
            .where(
              eq(
                employeeRuntimeState.userId,
                userId,
              ),
            )
            .limit(1),
        ]);

        return res.json({
          success: true,
          employee: {
            id:
              employee.id,
            employeeCode:
              employee.salesmanLoginId,
            name:
              employee.displayName ??
              employee.username ??
              employee.salesmanLoginId,
            username:
              employee.username,
            email:
              employee.email,
            phoneNumber:
              employee.phoneNumber,
            department:
              employee.department,
            designation:
              employee.designation,
            role:
              employee.role,
            area:
              employee.area,
            zone:
              employee.zone,
            reportsToId:
              employee.reportsToId,
            status:
              employee.status,
            mobileAccess:
              employee.isSalesAppUser,
          },
          responsibilities,
          directResponsibilityIds:
            directRows.map(
              (row) =>
                row.capabilityId,
            ),
          directRoleIds:
            directRoleRows.map(
              (row) =>
                row.roleId,
            ),
          runtime:
            runtimeRows[0] ??
            null,
        });
      },
    ),
  );

  router.post(
    "/employees",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const employeeCode =
          String(
            req.body?.employeeCode ??
              "",
          ).trim();
        const name =
          String(
            req.body?.name ??
              "",
          ).trim();
        const password =
          String(
            req.body?.password ??
              "",
          );

        if (
          !employeeCode ||
          !name ||
          password.length < 6
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "Employee code, name and password of at least 6 characters are required.",
            });
        }

        try {
          const ids =
            normalizeIds(
              req.body?.responsibilityIds ??
                req.body?.capabilityIds,
            );

          await validateResponsibilityIds(
            db,
            ids,
          );

          const roleIds =
            normalizeIds(
              req.body?.roleIds,
            );

          await validateRoleIds(
            db,
            roleIds,
          );

          const passwordHash =
            await bcrypt.hash(
              password,
              12,
            );

          const managerId =
            Number(
              req.body?.reportsToId,
            );

          const [created] = await db
            .insert(users)
            .values({
              email:
                String(
                  req.body?.email ??
                    "",
                ).trim() ||
                `${employeeCode.toLowerCase()}@mobile.local`,
              username:
                name,
              displayName:
                name,
              phoneNumber:
                String(
                  req.body?.phoneNumber ??
                    "",
                ).trim() ||
                null,
              department:
                String(
                  req.body?.department ??
                    "",
                ).trim() ||
                null,
              designation:
                String(
                  req.body?.designation ??
                    "",
                ).trim() ||
                null,
              role:
                String(
                  req.body?.role ??
                    "",
                ).trim() ||
                String(
                  req.body?.designation ??
                    "",
                ).trim() ||
                "EMPLOYEE",
              status:
                "active",
              area:
                String(
                  req.body?.area ??
                    "",
                ).trim() ||
                null,
              zone:
                String(
                  req.body?.zone ??
                    "",
                ).trim() ||
                null,
              reportsToId:
                Number.isInteger(
                  managerId,
                ) &&
                managerId > 0
                  ? managerId
                  : null,
              isSalesAppUser:
                true,
              salesmanLoginId:
                employeeCode,
              salesAppPassword:
                null,
              salesAppPasswordHash:
                passwordHash,
              updatedAt:
                new Date().toISOString(),
            })
            .returning();

          if (ids.length) {
            await db
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

          if (roleIds.length) {
            await db
              .insert(userRoles)
              .values(
                roleIds.map(
                  (roleId) => ({
                    userId:
                      created.id,
                    roleId,
                  }),
                ),
              );
          }

          await writeAudit(
            db,
            {
              actorUserId:
                req.adminActor?.userId,
              action:
                "employee.create",
              entityType:
                "employee",
              entityId:
                created.id,
              afterState: {
                employeeCode:
                  created.salesmanLoginId,
                name:
                  created.displayName,
                responsibilityIds:
                  ids,
                roleIds,
              },
            },
          );

          return res
            .status(201)
            .json({
              success: true,
              employee: {
                id:
                  created.id,
                employeeCode:
                  created.salesmanLoginId,
                name:
                  created.displayName,
              },
            });
        } catch (error: any) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                error?.message ??
                "Unable to create employee.",
            });
        }
      },
    ),
  );

  router.patch(
    "/employees/:id",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          Number(
            req.params.id,
          );

        if (
          !Number.isInteger(userId) ||
          userId <= 0
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "Invalid employee ID.",
            });
        }

        const [before] = await db
          .select()
          .from(users)
          .where(
            eq(
              users.id,
              userId,
            ),
          )
          .limit(1);

        if (!before) {
          return res
            .status(404)
            .json({
              success: false,
              error:
                "Employee not found.",
            });
        }

        const update: any = {
          updatedAt:
            new Date().toISOString(),
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

        for (
          const [
            bodyKey,
            dbKey,
          ] of mappings
        ) {
          if (
            bodyKey in
            (req.body ?? {})
          ) {
            const raw =
              req.body[bodyKey];
            update[dbKey] =
              raw === null
                ? null
                : String(raw).trim() ||
                  null;
          }
        }

        if (
          "reportsToId" in
          (req.body ?? {})
        ) {
          const managerId =
            Number(
              req.body.reportsToId,
            );
          update.reportsToId =
            Number.isInteger(
              managerId,
            ) &&
            managerId > 0
              ? managerId
              : null;
        }

        if (
          "mobileAccess" in
          (req.body ?? {})
        ) {
          update.isSalesAppUser =
            Boolean(
              req.body.mobileAccess,
            );
        }

        const [updated] = await db
          .update(users)
          .set(update)
          .where(
            eq(
              users.id,
              userId,
            ),
          )
          .returning();

        await writeAudit(
          db,
          {
            actorUserId:
              req.adminActor?.userId,
            action:
              "employee.update",
            entityType:
              "employee",
            entityId:
              userId,
            beforeState:
              before,
            afterState:
              updated,
          },
        );

        return res.json({
          success: true,
          employee:
            updated,
        });
      },
    ),
  );

  router.post(
    "/employees/:id/status",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          Number(
            req.params.id,
          );
        const status =
          String(
            req.body?.status ??
              "",
          ).trim();

        if (
          !Number.isInteger(userId) ||
          userId <= 0 ||
          ![
            "active",
            "inactive",
            "suspended",
          ].includes(status)
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "Valid employee ID and status are required.",
            });
        }

        const [updated] = await db
          .update(users)
          .set({
            status,
            updatedAt:
              new Date().toISOString(),
          })
          .where(
            eq(
              users.id,
              userId,
            ),
          )
          .returning();

        if (!updated) {
          return res
            .status(404)
            .json({
              success: false,
              error:
                "Employee not found.",
            });
        }

        await writeAudit(
          db,
          {
            actorUserId:
              req.adminActor?.userId,
            action:
              "employee.status_change",
            entityType:
              "employee",
            entityId:
              userId,
            afterState: {
              status,
            },
          },
        );

        return res.json({
          success: true,
          employee:
            updated,
        });
      },
    ),
  );

  router.post(
    "/employees/:id/reset-password",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          Number(
            req.params.id,
          );
        const password =
          String(
            req.body?.password ??
              "",
          );

        if (
          !Number.isInteger(userId) ||
          userId <= 0 ||
          password.length < 6
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "Valid employee ID and password of at least 6 characters are required.",
            });
        }

        const hash =
          await bcrypt.hash(
            password,
            12,
          );

        const [updated] = await db
          .update(users)
          .set({
            salesAppPassword:
              null,
            salesAppPasswordHash:
              hash,
            updatedAt:
              new Date().toISOString(),
          })
          .where(
            eq(
              users.id,
              userId,
            ),
          )
          .returning({
            id:
              users.id,
          });

        if (!updated) {
          return res
            .status(404)
            .json({
              success: false,
              error:
                "Employee not found.",
            });
        }

        return res.json({
          success: true,
        });
      },
    ),
  );

  router.put(
    "/employees/:id/responsibilities",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          Number(
            req.params.id,
          );

        if (
          !Number.isInteger(userId) ||
          userId <= 0
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "Invalid employee ID.",
            });
        }

        const ids =
          normalizeIds(
            req.body?.responsibilityIds ??
              req.body?.capabilityIds,
          );

        try {
          await validateResponsibilityIds(
            db,
            ids,
          );

          const [employee] = await db
            .select({
              id:
                users.id,
              mobile:
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
            !employee.mobile
          ) {
            throw new Error(
              "Mobile employee not found.",
            );
          }

          await db
            .delete(
              userMobileCapabilities,
            )
            .where(
              eq(
                userMobileCapabilities.userId,
                userId,
              ),
            );

          if (ids.length) {
            await db
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

          const resolved =
            await getResolvedCapabilitiesForUser(
              db,
              userId,
            );

          await writeAudit(
            db,
            {
              actorUserId:
                req.adminActor?.userId,
              action:
                "employee.responsibilities_replace",
              entityType:
                "employee",
              entityId:
                userId,
              afterState: {
                directResponsibilityIds:
                  ids,
                resolvedResponsibilityKeys:
                  resolved.map(
                    (item) =>
                      item.key,
                  ),
              },
            },
          );

          return res.json({
            success: true,
            directResponsibilityIds:
              ids,
            resolvedResponsibilities:
              resolved,
          });
        } catch (error: any) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                error?.message ??
                "Unable to update employee Responsibilities.",
            });
        }
      },
    ),
  );

  router.put(
    "/employees/:id/roles",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          Number(
            req.params.id,
          );

        if (
          !Number.isInteger(userId) ||
          userId <= 0
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "Invalid employee ID.",
            });
        }

        const roleIds =
          normalizeIds(
            req.body?.roleIds,
          );

        try {
          await validateRoleIds(
            db,
            roleIds,
          );

          const [employee] = await db
            .select({
              id:
                users.id,
            })
            .from(users)
            .where(
              eq(
                users.id,
                userId,
              ),
            )
            .limit(1);

          if (!employee) {
            return res
              .status(404)
              .json({
                success: false,
                error:
                  "Employee not found.",
              });
          }

          await db
            .delete(userRoles)
            .where(
              eq(
                userRoles.userId,
                userId,
              ),
            );

          if (roleIds.length) {
            await db
              .insert(userRoles)
              .values(
                roleIds.map(
                  (roleId) => ({
                    userId,
                    roleId,
                  }),
                ),
              );
          }

          await writeAudit(
            db,
            {
              actorUserId:
                req.adminActor?.userId,
              action:
                "employee.roles_replace",
              entityType:
                "employee",
              entityId:
                userId,
              afterState: {
                roleIds,
              },
            },
          );

          return res.json({
            success: true,
            roleIds,
          });
        } catch (error: any) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                error?.message ??
                "Unable to update employee roles.",
            });
        }
      },
    ),
  );

}
