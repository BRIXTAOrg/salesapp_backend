import crypto from "node:crypto";

import type {
  Router,
} from "express";

import {
  withAdminTenantDb,
  type AdminRequest,
} from "../middleware/adminService";

import {
  departmentMemberCounts,
  getDepartments,
  normalizeDepartmentAuthority,
  normalizeDepartmentKey,
  resolveDepartmentAuthority,
  saveDepartments,
} from "../services/departments";

import {
  writeAudit,
} from "../services/audit";

export function registerDepartmentAdminRoutes(
  router: Router,
) {
  router.get(
    "/departments",
    withAdminTenantDb<AdminRequest>(
      async (
        _req,
        res,
        db,
      ) => {
        const [
          departments,
          counts,
        ] =
          await Promise.all([
            getDepartments(
              db,
            ),
            departmentMemberCounts(
              db,
            ),
          ]);

        const enriched =
          await Promise.all(
            departments.map(
              async (
                department,
              ) => {
                const resolved =
                  await resolveDepartmentAuthority(
                    db,
                    department.id,
                  );

                return {
                  ...department,

                  memberCount:
                    counts.get(
                      department.key,
                    ) ?? 0,

                  resolvedUserIds:
                    resolved
                      .eligibleUserIds,
                };
              },
            ),
          );

        return res.json({
          success: true,
          departments:
            enriched,
        });
      },
    ),
  );

  router.post(
    "/departments",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const name =
          String(
            req.body
              ?.name ??
            "",
          ).trim();

        if (!name) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "Department name is required.",
            });
        }

        const departments =
          await getDepartments(
            db,
          );

        const key =
          normalizeDepartmentKey(
            name,
          );

        if (
          departments.some(
            (item) =>
              item.key === key,
          )
        ) {
          return res
            .status(409)
            .json({
              success: false,
              error:
                "A Department with this name already exists.",
            });
        }

        const now =
          new Date()
            .toISOString();

        const department = {
          id:
            `department_${crypto.randomUUID()}`,
          key,
          name,

          defaultAuthority:
            normalizeDepartmentAuthority(
              req.body
                ?.defaultAuthority,
            ),

          createdAt:
            now,
          updatedAt:
            now,
        };

        const next = [
          ...departments,
          department,
        ].sort(
          (
            a,
            b,
          ) =>
            a.name.localeCompare(
              b.name,
            ),
        );

        await saveDepartments(
          db,
          next,
          req.adminActor
            ?.userId,
        );

        await writeAudit(
          db,
          {
            actorUserId:
              req.adminActor
                ?.userId,

            action:
              "department.create",

            entityType:
              "department",

            entityId:
              department.id,

            afterState:
              department,
          },
        );

        return res
          .status(201)
          .json({
            success: true,
            department,
          });
      },
    ),
  );

  router.patch(
    "/departments/:id",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const id =
          String(
            req.params.id ??
            "",
          );

        const departments =
          await getDepartments(
            db,
          );

        const index =
          departments.findIndex(
            (item) =>
              item.id === id,
          );

        if (index < 0) {
          return res
            .status(404)
            .json({
              success: false,
              error:
                "Department not found.",
            });
        }

        const current =
          departments[index];

        const nextName =
          "name" in
            (req.body ?? {})
            ? String(
                req.body
                  .name ??
                "",
              ).trim()
            : current.name;

        if (!nextName) {
          return res
            .status(400)
            .json({
              success: false,
              error:
                "Department name cannot be empty.",
            });
        }

        const nextKey =
          normalizeDepartmentKey(
            nextName,
          );

        if (
          departments.some(
            (
              item,
              itemIndex,
            ) =>
              itemIndex !==
                index &&
              item.key ===
                nextKey,
          )
        ) {
          return res
            .status(409)
            .json({
              success: false,
              error:
                "Another Department already uses this name.",
            });
        }

        const updated = {
          ...current,

          name:
            nextName,

          key:
            nextKey,

          defaultAuthority:
            "defaultAuthority" in
              (req.body ?? {})
              ? normalizeDepartmentAuthority(
                  req.body
                    .defaultAuthority,
                )
              : current
                  .defaultAuthority,

          updatedAt:
            new Date()
              .toISOString(),
        };

        departments[index] =
          updated;

        await saveDepartments(
          db,
          departments,
          req.adminActor
            ?.userId,
        );

        await writeAudit(
          db,
          {
            actorUserId:
              req.adminActor
                ?.userId,

            action:
              "department.update",

            entityType:
              "department",

            entityId:
              id,

            afterState:
              updated,
          },
        );

        return res.json({
          success: true,
          department:
            updated,
        });
      },
    ),
  );

  router.delete(
    "/departments/:id",
    withAdminTenantDb<AdminRequest>(
      async (
        req,
        res,
        db,
      ) => {
        const id =
          String(
            req.params.id ??
            "",
          );

        const [
          departments,
          counts,
        ] =
          await Promise.all([
            getDepartments(
              db,
            ),
            departmentMemberCounts(
              db,
            ),
          ]);

        const department =
          departments.find(
            (item) =>
              item.id === id,
          );

        if (!department) {
          return res
            .status(404)
            .json({
              success: false,
              error:
                "Department not found.",
            });
        }

        if (
          (
            counts.get(
              department.key,
            ) ?? 0
          ) > 0
        ) {
          return res
            .status(409)
            .json({
              success: false,
              error:
                "Move employees out of this Department before deleting it.",
            });
        }

        await saveDepartments(
          db,
          departments.filter(
            (item) =>
              item.id !== id,
          ),
          req.adminActor
            ?.userId,
        );

        await writeAudit(
          db,
          {
            actorUserId:
              req.adminActor
                ?.userId,

            action:
              "department.delete",

            entityType:
              "department",

            entityId:
              id,

            beforeState:
              department,
          },
        );

        return res.json({
          success: true,
        });
      },
    ),
  );
}
