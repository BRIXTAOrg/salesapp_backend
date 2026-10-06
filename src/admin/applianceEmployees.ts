import type {
  Router,
} from "express";

import bcrypt from "bcryptjs";

import {
  and,
  asc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";

import {
  mobileCapabilities,
  roles,
  userMobileCapabilities,
  userRoles,
  users,
} from "../db/schema";

import {
  capabilityAssignmentRules,
  employeeRuntimeState,
} from "../db/applianceSchema";

import type {
  AppDatabase,
} from "../db/db";

/*
 * BRIXTA_EMPLOYEE_CREATE_SAFE_V1
 *
 * Creating an employee is all-or-nothing: if any part fails (manager rule,
 * roles, responsibilities) nothing is saved, so a retry never hits
 * "already exists". Duplicate IDs, phones and emails get a plain answer
 * that names who already has them.
 */
async function employeeClash(
  db: AppDatabase,
  input: {
    employeeCode: string;
    phoneNumber: string | null;
    email: string | null;
  },
): Promise<string | null> {
  const nameOf = (row: { displayName: string | null; username: string | null; id: number }) =>
    row.displayName ?? row.username ?? `employee #${row.id}`;

  const [byCode] = await db
    .select({ id: users.id, displayName: users.displayName, username: users.username })
    .from(users)
    .where(sql`lower(${users.salesmanLoginId}) = lower(${input.employeeCode})`)
    .limit(1);
  if (byCode) {
    return `Employee ID ${input.employeeCode} is already used by ${nameOf(byCode)}.`;
  }

  if (input.phoneNumber) {
    const [byPhone] = await db
      .select({ id: users.id, displayName: users.displayName, username: users.username })
      .from(users)
      .where(and(eq(users.phoneNumber, input.phoneNumber), eq(users.status, "active")))
      .limit(1);
    if (byPhone) {
      return `Phone ${input.phoneNumber} already belongs to ${nameOf(byPhone)}. The app signs in with phone numbers, so each one must be unique.`;
    }
  }

  if (input.email) {
    const [byEmail] = await db
      .select({ id: users.id, displayName: users.displayName, username: users.username })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${input.email})`)
      .limit(1);
    if (byEmail) {
      return `${input.email} is already used by ${nameOf(byEmail)}.`;
    }
  }

  return null;
}

/*
 * BRIXTA_ADMIN_LOCKOUT_GUARD_V1
 * A company must always keep at least one active person who can sign in to
 * the dashboard with full access, and nobody can switch themselves off.
 */
async function activeAdminCount(db: AppDatabase): Promise<number> {
  const result = await db.execute(sql`
    SELECT count(DISTINCT u.id)::int AS count
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
     WHERE u.status = 'active'
       AND u.is_dashboard_user = true
       AND 'ALL_ACCESS' = ANY(r.granted_perms)
  `);
  const row = result.rows[0] as { count?: number | string } | undefined;
  return Number(row?.count ?? 0);
}

async function hasDashboardPermissions(db: AppDatabase, userId: number): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ${userId}
       AND cardinality(r.granted_perms) > 0
     LIMIT 1
  `);
  return result.rows.length > 0;
}

function friendlyCreateError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const constraint = String((error as { constraint?: string } | null)?.constraint ?? "");
  if (code === "23505") {
    if (constraint.includes("salesman_login_id")) return "That employee ID is already in use.";
    if (constraint.includes("device")) return "That device is already linked to another employee.";
    return "Someone with these details already exists.";
  }
  return error instanceof Error && error.message ? error.message : "Unable to create employee.";
}

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

import {
  getReportingSnapshot,
  refreshReportingCaches,
  resolveReportingManager,
  saveReportingPolicy,
} from "../services/reportingResolver";

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

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
}

function normalizeSurfaces(
  value: unknown,
) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .map(String)
            .filter(
              (surface) =>
                surface === "app" ||
                surface === "dashboard",
            ),
        ),
      ]
    : [];
}

function normalizeParticipantGrants(
  value: unknown,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  const result = new Map<
    string,
    {
      responsibilityId: number;
      actorId: string;
      surfaces: string[];
    }
  >();

  for (const raw of value) {
    const item =
      objectValue(raw);

    const responsibilityId =
      Number(
        item.responsibilityId,
      );

    const actorId =
      String(
        item.actorId ?? "",
      ).trim();

    const surfaces =
      normalizeSurfaces(
        item.surfaces,
      );

    if (
      !Number.isInteger(
        responsibilityId,
      ) ||
      responsibilityId <= 0 ||
      !actorId ||
      surfaces.length === 0
    ) {
      continue;
    }

    result.set(
      `${responsibilityId}:${actorId}`,
      {
        responsibilityId,
        actorId,
        surfaces,
      },
    );
  }

  return [...result.values()];
}

function pixelRealityActors(
  config: unknown,
) {
  const root =
    objectValue(config);

  const rawReality =
    root.pixelReality ??
    objectValue(
      root.raw,
    ).pixelReality;

  const reality =
    objectValue(rawReality);

  return Array.isArray(
    reality.actors,
  )
    ? reality.actors
        .map(objectValue)
        .filter(
          (actor) =>
            typeof actor.id ===
              "string" &&
            Boolean(
              String(
                actor.id,
              ).trim(),
            ),
        )
    : [];
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

        const reportingRows =
          await Promise.all(
            employees.map(
              async (
                employee,
              ) => ({
                userId:
                  employee.id,

                resolution:
                  await resolveReportingManager(
                    db,
                    employee.id,
                  ),
              }),
            ),
          );

        const reportingMap =
          new Map(
            reportingRows.map(
              (item) => [
                item.userId,
                item.resolution,
              ],
            ),
          );

        const directReportCounts =
          new Map<number, number>();

        for (
          const item of
          reportingRows
        ) {
          if (
            item.resolution
              .status ===
              "resolved" &&
            item.resolution
              .managerId
          ) {
            directReportCounts.set(
              item.resolution
                .managerId,

              (
                directReportCounts.get(
                  item.resolution
                    .managerId,
                ) ?? 0
              ) + 1,
            );
          }
        }

        const names =
          new Map(
            employees.map(
              (employee) => [
                employee.id,
                employee.name ??
                  employee.employeeCode ??
                  `Employee ${employee.id}`,
              ],
            ),
          );

        return res.json({
          success: true,

          employees:
            employees.map(
              (employee) => {
                const reporting =
                  reportingMap.get(
                    employee.id,
                  );

                const managerId =
                  reporting
                    ?.status ===
                    "resolved"
                    ? reporting.managerId
                    : null;

                return {
                  ...employee,

                  reportsToId:
                    managerId,

                  reportingPolicy:
                    reporting
                      ?.policy ?? {
                        version: 1,
                        mode: "unset",
                      },

                  reportingMode:
                    reporting
                      ?.policy.mode ??
                    "unset",

                  reportingStatus:
                    reporting
                      ?.status ??
                    "unset",

                  reportingCandidateCount:
                    reporting
                      ?.candidateIds
                      .length ??
                    0,

                  reportingManagerName:
                    managerId
                      ? names.get(
                          managerId,
                        ) ??
                        null
                      : null,

                  directReportCount:
                    directReportCounts.get(
                      employee.id,
                    ) ?? 0,

                  directResponsibilityCount:
                    counts.get(
                      employee.id,
                    ) ?? 0,
                };
              },
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

        const reporting =
          await getReportingSnapshot(
            db,
            userId,
          );

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
              reporting
                .resolution
                .managerId,

            reportingMode:
              reporting
                .policy
                .mode,

            reportingStatus:
              reporting
                .resolution
                .status,

            reportingManagerName:
              reporting
                .manager
                ?.name ??
              reporting
                .manager
                ?.employeeCode ??
              null,
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

          reporting,
        });
      },
    ),
  );

  router.get(
    "/employees/:id/reporting-policy",
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
          !Number.isInteger(
            userId,
          ) ||
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

        return res.json({
          success: true,
          ...await getReportingSnapshot(
            db,
            userId,
          ),
        });
      },
    ),
  );

  router.post(
    "/employees/:id/reporting-policy/preview",
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
          !Number.isInteger(
            userId,
          ) ||
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

        return res.json({
          success: true,
          ...await getReportingSnapshot(
            db,
            userId,
            req.body
              ?.reportingPolicy ??
            req.body
              ?.policy,
          ),
        });
      },
    ),
  );

  router.put(
    "/employees/:id/reporting-policy",
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
          !Number.isInteger(
            userId,
          ) ||
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

        try {
          const reporting =
            await saveReportingPolicy(
              db,
              {
                userId,

                policy:
                  req.body
                    ?.reportingPolicy ??
                  req.body
                    ?.policy,

                actorUserId:
                  req.adminActor
                    ?.userId,
              },
            );

          await refreshReportingCaches(
            db,
          );

          await writeAudit(
            db,
            {
              actorUserId:
                req.adminActor
                  ?.userId,

              action:
                "employee.reporting_policy_update",

              entityType:
                "employee",

              entityId:
                userId,

              afterState:
                reporting,
            },
          );

          return res.json({
            success: true,
            ...reporting,
          });
        } catch (
          error: any
        ) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                error?.message ??
                "Unable to save reporting policy.",
            });
        }
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

        if (!name) {
          return res.status(400).json({ success: false, error: "Enter the employee's name.", field: "name" });
        }
        if (!employeeCode) {
          return res.status(400).json({ success: false, error: "Enter an employee ID.", field: "employeeCode" });
        }
        if (password.length < 6) {
          return res.status(400).json({
            success: false,
            error: "The app password needs at least 6 characters.",
            field: "password",
          });
        }

        const clash = await employeeClash(db, {
          employeeCode,
          phoneNumber: String(req.body?.phoneNumber ?? "").trim() || null,
          email: String(req.body?.email ?? "").trim() || null,
        });
        if (clash) {
          return res.status(409).json({ success: false, error: clash });
        }

        await db.execute(sql`SAVEPOINT brixta_create_employee`);

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

          // BRIXTA_REPORTING_CREATE
          let reporting = null;

          if (
            "reportingPolicy" in
            (req.body ?? {})
          ) {
            reporting =
              await saveReportingPolicy(
                db,
                {
                  userId:
                    created.id,

                  policy:
                    req.body
                      .reportingPolicy,

                  actorUserId:
                    req.adminActor
                      ?.userId,
                },
              );
          }

          await refreshReportingCaches(
            db,
          );

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

          await db.execute(sql`RELEASE SAVEPOINT brixta_create_employee`);

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
        } catch (error: unknown) {
          // Undo everything this request wrote, keep the transaction usable.
          await db
            .execute(sql`ROLLBACK TO SAVEPOINT brixta_create_employee`)
            .catch(() => undefined);
          return res
            .status(400)
            .json({
              success: false,
              error: friendlyCreateError(error),
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

        // BRIXTA_EMPLOYEE_UPDATE_SAFE_V1: a bad manager rule or a clash
        // undoes the whole save and comes back as a readable message.
        if ("phoneNumber" in (req.body ?? {})) {
          const phone = String(req.body.phoneNumber ?? "").trim();
          if (phone && phone !== (before.phoneNumber ?? "")) {
            const [taken] = await db
              .select({ id: users.id, displayName: users.displayName, username: users.username })
              .from(users)
              .where(and(eq(users.phoneNumber, phone), eq(users.status, "active")))
              .limit(1);
            if (taken && taken.id !== userId) {
              return res.status(409).json({
                success: false,
                error: `Phone ${phone} already belongs to ${taken.displayName ?? taken.username ?? `employee #${taken.id}`}.`,
              });
            }
          }
        }

        await db.execute(sql`SAVEPOINT brixta_update_employee`);
        try {

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
            const cleaned =
              raw === null
                ? null
                : String(raw).trim() ||
                  null;
            // Email is required in the database: an empty box keeps the old one.
            if (dbKey === "email" && !cleaned) continue;
            update[dbKey] = cleaned;
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

        // BRIXTA_REPORTING_PROFILE_UPDATE
        let reporting =
          await getReportingSnapshot(
            db,
            userId,
          );

        if (
          "reportingPolicy" in
          (req.body ?? {})
        ) {
          reporting =
            await saveReportingPolicy(
              db,
              {
                userId,

                policy:
                  req.body
                    .reportingPolicy,

                actorUserId:
                  req.adminActor
                    ?.userId,
              },
            );
        }

        /*
         * Department / area / zone changes may affect
         * Role+scope reporting policies elsewhere.
         */
        await refreshReportingCaches(
          db,
        );

        reporting =
          await getReportingSnapshot(
            db,
            userId,
          );

        const [fresh] =
          await db
            .select()
            .from(users)
            .where(
              eq(
                users.id,
                userId,
              ),
            )
            .limit(1);

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
            afterState: {
              ...(fresh ?? updated),
              reporting,
            },
          },
        );

        await db.execute(sql`RELEASE SAVEPOINT brixta_update_employee`);

        return res.json({
          success: true,
          employee:
            fresh ?? updated,

          reporting,
        });
        } catch (error: unknown) {
          await db
            .execute(sql`ROLLBACK TO SAVEPOINT brixta_update_employee`)
            .catch(() => undefined);
          return res.status(400).json({
            success: false,
            error: friendlyCreateError(error).replace("create", "save"),
          });
        }
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

        if (
          status !== "active" &&
          req.adminActor?.userId === userId
        ) {
          return res.status(400).json({
            success: false,
            code: "SELF_LOCKOUT",
            error: "You can't suspend yourself. Ask another admin to do it.",
          });
        }

        const adminsBefore = await activeAdminCount(db);
        await db.execute(sql`SAVEPOINT brixta_status_change`);

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
          await db.execute(sql`ROLLBACK TO SAVEPOINT brixta_status_change`);
          return res
            .status(404)
            .json({
              success: false,
              error:
                "Employee not found.",
            });
        }

        if (status !== "active" && adminsBefore > 0 && (await activeAdminCount(db)) === 0) {
          await db.execute(sql`ROLLBACK TO SAVEPOINT brixta_status_change`);
          return res.status(400).json({
            success: false,
            code: "LAST_ADMIN",
            error: "This is the last admin. Give someone else admin access before suspending them.",
          });
        }

        await db.execute(sql`RELEASE SAVEPOINT brixta_status_change`);

        // BRIXTA_REPORTING_STATUS_REFRESH
        await refreshReportingCaches(
          db,
        );

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

  /*
   * BRIXTA_PIXEL_REALITY_PARTICIPANT_GRANTS
   *
   * These are human overrides for Responsibility actors.
   * They do NOT assign the whole Responsibility.
   */
  router.get(
    "/employees/:id/participant-grants",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          Number(req.params.id);

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

        const rows =
          await db
            .select({
              id:
                capabilityAssignmentRules.id,
              capabilityId:
                capabilityAssignmentRules.capabilityId,
              config:
                capabilityAssignmentRules.config,
            })
            .from(
              capabilityAssignmentRules,
            )
            .where(
              and(
                eq(
                  capabilityAssignmentRules.subjectType,
                  "user",
                ),
                eq(
                  capabilityAssignmentRules.subjectValue,
                  String(userId),
                ),
                eq(
                  capabilityAssignmentRules.enabled,
                  true,
                ),
              ),
            );

        const participantGrants =
          rows.flatMap(
            (row) => {
              const config =
                objectValue(
                  row.config,
                );

              if (
                config.kind !==
                "pixel_reality_participant"
              ) {
                return [];
              }

              return [{
                ruleId:
                  row.id,
                responsibilityId:
                  row.capabilityId,
                actorId:
                  String(
                    config.actorId ??
                    "",
                  ),
                surfaces:
                  normalizeSurfaces(
                    config.surfaces,
                  ),
              }];
            },
          );

        return res.json({
          success: true,
          participantGrants,
        });
      },
    ),
  );

  router.put(
    "/employees/:id/participant-grants",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const userId =
          Number(req.params.id);

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

        const grants =
          normalizeParticipantGrants(
            req.body
              ?.participantGrants ??
            req.body?.grants,
          );

        const [
          employee,
        ] =
          await db
            .select({
              id: users.id,
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

        const responsibilityIds =
          [
            ...new Set(
              grants.map(
                (grant) =>
                  grant.responsibilityId,
              ),
            ),
          ];

        await validateResponsibilityIds(
          db,
          responsibilityIds,
        );

        const responsibilityRows =
          responsibilityIds.length
            ? await db
                .select({
                  id:
                    mobileCapabilities.id,
                  config:
                    mobileCapabilities.config,
                })
                .from(
                  mobileCapabilities,
                )
                .where(
                  inArray(
                    mobileCapabilities.id,
                    responsibilityIds,
                  ),
                )
            : [];

        const responsibilityMap =
          new Map(
            responsibilityRows.map(
              (row) => [
                row.id,
                row,
              ],
            ),
          );

        for (
          const grant of grants
        ) {
          const responsibility =
            responsibilityMap.get(
              grant.responsibilityId,
            );

          const actors =
            pixelRealityActors(
              responsibility?.config,
            );

          if (
            !actors.some(
              (actor) =>
                String(
                  actor.id,
                ) ===
                grant.actorId,
            )
          ) {
            return res
              .status(400)
              .json({
                success: false,
                error:
                  `Actor "${grant.actorId}" is not declared by Responsibility ${grant.responsibilityId}.`,
              });
          }
        }

        const existing =
          await db
            .select({
              id:
                capabilityAssignmentRules.id,
              config:
                capabilityAssignmentRules.config,
            })
            .from(
              capabilityAssignmentRules,
            )
            .where(
              and(
                eq(
                  capabilityAssignmentRules.subjectType,
                  "user",
                ),
                eq(
                  capabilityAssignmentRules.subjectValue,
                  String(userId),
                ),
              ),
            );

        const participantRuleIds =
          existing
            .filter(
              (row) =>
                objectValue(
                  row.config,
                ).kind ===
                "pixel_reality_participant",
            )
            .map(
              (row) => row.id,
            );

        if (
          participantRuleIds.length
        ) {
          await db
            .delete(
              capabilityAssignmentRules,
            )
            .where(
              inArray(
                capabilityAssignmentRules.id,
                participantRuleIds,
              ),
            );
        }

        if (grants.length) {
          await db
            .insert(
              capabilityAssignmentRules,
            )
            .values(
              grants.map(
                (grant) => ({
                  capabilityId:
                    grant.responsibilityId,
                  subjectType:
                    "user",
                  subjectValue:
                    String(userId),
                  effect:
                    "allow",
                  priority:
                    1000,
                  enabled:
                    true,
                  config: {
                    kind:
                      "pixel_reality_participant",
                    actorId:
                      grant.actorId,
                    surfaces:
                      grant.surfaces,
                  },
                  createdByUserId:
                    req.adminActor
                      ?.userId ??
                    null,
                }),
              ),
            );
        }

        await writeAudit(
          db,
          {
            actorUserId:
              req.adminActor
                ?.userId,
            action:
              "employee.pixel_reality_participants_replace",
            entityType:
              "employee",
            entityId:
              userId,
            afterState: {
              participantGrants:
                grants,
            },
          },
        );

        return res.json({
          success: true,
          participantGrants:
            grants,
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

          // BRIXTA_ADMIN_LOCKOUT_GUARD_V1
          const adminsBefore = await activeAdminCount(db);
          await db.execute(sql`SAVEPOINT brixta_roles_change`);

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

          if (adminsBefore > 0 && (await activeAdminCount(db)) === 0) {
            await db.execute(sql`ROLLBACK TO SAVEPOINT brixta_roles_change`);
            return res.status(400).json({
              success: false,
              code: "LAST_ADMIN",
              error:
                "Someone must keep full admin access. Give another person the admin role first.",
            });
          }

          if (
            req.adminActor?.userId === userId &&
            !(await hasDashboardPermissions(db, userId))
          ) {
            await db.execute(sql`ROLLBACK TO SAVEPOINT brixta_roles_change`);
            return res.status(400).json({
              success: false,
              code: "SELF_LOCKOUT",
              error:
                "These roles would lock you out of the dashboard. Keep at least one role with dashboard permissions.",
            });
          }

          await db.execute(sql`RELEASE SAVEPOINT brixta_roles_change`);

          // BRIXTA_REPORTING_ROLE_REFRESH
          await refreshReportingCaches(
            db,
          );

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
