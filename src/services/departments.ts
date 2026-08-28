import crypto from "node:crypto";

import {
  and,
  eq,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../db/db";

import {
  workspaceSettings,
} from "../db/applianceSchema";

import {
  userRoles,
  users,
} from "../db/schema";

const DEPARTMENT_SETTINGS_KEY =
  "organization.departments.v1";

export type DepartmentAuthority =
  | {
      kind: "none";
    }
  | {
      kind: "employee";
      userId: number;
    }
  | {
      kind: "role";
      roleId: number;
    };

export type DepartmentDefinition = {
  id: string;
  key: string;
  name: string;
  defaultAuthority: DepartmentAuthority;
  createdAt: string;
  updatedAt: string;
};

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value as Record<string, unknown>
    : {};
}

function positiveInteger(
  value: unknown,
) {
  const number =
    Number(value);

  return (
    Number.isInteger(number) &&
    number > 0
  )
    ? number
    : undefined;
}

export function normalizeDepartmentKey(
  value: string,
) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeDepartmentAuthority(
  value: unknown,
): DepartmentAuthority {
  const raw =
    objectValue(value);

  const kind =
    String(
      raw.kind ?? "none",
    );

  if (
    kind === "employee"
  ) {
    const userId =
      positiveInteger(
        raw.userId,
      );

    return userId
      ? {
          kind: "employee",
          userId,
        }
      : {
          kind: "none",
        };
  }

  if (
    kind === "role"
  ) {
    const roleId =
      positiveInteger(
        raw.roleId,
      );

    return roleId
      ? {
          kind: "role",
          roleId,
        }
      : {
          kind: "none",
        };
  }

  return {
    kind: "none",
  };
}

function normalizeDepartment(
  value: unknown,
): DepartmentDefinition | null {
  const raw =
    objectValue(value);

  const name =
    String(
      raw.name ?? "",
    ).trim();

  if (!name) {
    return null;
  }

  const now =
    new Date().toISOString();

  const key =
    normalizeDepartmentKey(
      String(
        raw.key ?? name,
      ),
    );

  return {
    id:
      String(
        raw.id ??
        `department_${crypto.randomUUID()}`,
      ),

    key:
      key ||
      `department_${crypto.randomUUID()}`,

    name,

    defaultAuthority:
      normalizeDepartmentAuthority(
        raw.defaultAuthority,
      ),

    createdAt:
      typeof raw.createdAt ===
        "string"
        ? raw.createdAt
        : now,

    updatedAt:
      typeof raw.updatedAt ===
        "string"
        ? raw.updatedAt
        : now,
  };
}

async function rawDepartments(
  db: AppDatabase,
) {
  const [row] =
    await db
      .select({
        value:
          workspaceSettings.value,
      })
      .from(
        workspaceSettings,
      )
      .where(
        eq(
          workspaceSettings.key,
          DEPARTMENT_SETTINGS_KEY,
        ),
      )
      .limit(1);

  if (
    !row ||
    !Array.isArray(
      row.value,
    )
  ) {
    return [];
  }

  const result:
    DepartmentDefinition[] = [];

  for (
    const value of row.value
  ) {
    const normalized =
      normalizeDepartment(
        value,
      );

    if (normalized) {
      result.push(
        normalized,
      );
    }
  }

  return result;
}

export async function saveDepartments(
  db: AppDatabase,
  departments: DepartmentDefinition[],
  actorUserId?: number | null,
) {
  const now =
    new Date();

  await db
    .insert(
      workspaceSettings,
    )
    .values({
      key:
        DEPARTMENT_SETTINGS_KEY,

      value:
        departments,

      updatedByUserId:
        actorUserId ??
        null,

      updatedAt:
        now,
    })
    .onConflictDoUpdate({
      target:
        workspaceSettings.key,

      set: {
        value:
          departments,

        updatedByUserId:
          actorUserId ??
          null,

        updatedAt:
          now,
      },
    });

  return departments;
}

/*
 * Existing employee.department strings are automatically imported
 * the first time the Department catalog is opened.
 *
 * This keeps old data compatible while giving Departments a real
 * organization-level home from now on.
 */
export async function getDepartments(
  db: AppDatabase,
) {
  const stored =
    await rawDepartments(
      db,
    );

  const employees =
    await db
      .select({
        department:
          users.department,
      })
      .from(users);

  const names =
    new Map<
      string,
      string
    >();

  for (
    const employee of employees
  ) {
    for (
      const part of
      String(
        employee.department ??
        "",
      ).split(",")
    ) {
      const name =
        part.trim();

      const normalized =
        normalizeDepartmentKey(
          name,
        );

      if (
        name &&
        normalized &&
        !names.has(
          normalized,
        )
      ) {
        names.set(
          normalized,
          name,
        );
      }
    }
  }

  const byKey =
    new Map(
      stored.map(
        (department) => [
          department.key,
          department,
        ],
      ),
    );

  let changed =
    false;

  for (
    const [
      key,
      name,
    ] of names
  ) {
    if (
      byKey.has(key)
    ) {
      continue;
    }

    const now =
      new Date()
        .toISOString();

    const department:
      DepartmentDefinition = {
        id:
          `department_${crypto.randomUUID()}`,
        key,
        name,
        defaultAuthority: {
          kind: "none",
        },
        createdAt:
          now,
        updatedAt:
          now,
      };

    stored.push(
      department,
    );

    byKey.set(
      key,
      department,
    );

    changed =
      true;
  }

  stored.sort(
    (a, b) =>
      a.name.localeCompare(
        b.name,
      ),
  );

  if (changed) {
    await saveDepartments(
      db,
      stored,
      null,
    );
  }

  return stored;
}

export async function resolveDepartmentAuthority(
  db: AppDatabase,
  departmentId: string,
) {
  const departments =
    await getDepartments(
      db,
    );

  const department =
    departments.find(
      (item) =>
        item.id ===
          departmentId ||
        item.key ===
          departmentId,
    );

  if (!department) {
    return {
      department:
        null,
      eligibleUserIds:
        [] as number[],
    };
  }

  const authority =
    department.defaultAuthority;

  if (
    authority.kind ===
    "none"
  ) {
    return {
      department,
      eligibleUserIds:
        [] as number[],
    };
  }

  if (
    authority.kind ===
    "employee"
  ) {
    const [employee] =
      await db
        .select({
          id:
            users.id,
        })
        .from(users)
        .where(
          and(
            eq(
              users.id,
              authority.userId,
            ),
            eq(
              users.status,
              "active",
            ),
          ),
        )
        .limit(1);

    return {
      department,
      eligibleUserIds:
        employee
          ? [
              employee.id,
            ]
          : [],
    };
  }

  const rows =
    await db
      .select({
        id:
          users.id,
      })
      .from(userRoles)
      .innerJoin(
        users,
        eq(
          users.id,
          userRoles.userId,
        ),
      )
      .where(
        and(
          eq(
            userRoles.roleId,
            authority.roleId,
          ),
          eq(
            users.status,
            "active",
          ),
        ),
      );

  return {
    department,
    eligibleUserIds: [
      ...new Set(
        rows.map(
          (row) =>
            row.id,
        ),
      ),
    ],
  };
}

export async function departmentMemberCounts(
  db: AppDatabase,
) {
  const employees =
    await db
      .select({
        department:
          users.department,
      })
      .from(users);

  const result =
    new Map<
      string,
      number
    >();

  for (
    const employee of employees
  ) {
    for (
      const part of
      String(
        employee.department ??
        "",
      ).split(",")
    ) {
      const key =
        normalizeDepartmentKey(
          part,
        );

      if (!key) {
        continue;
      }

      result.set(
        key,
        (
          result.get(
            key,
          ) ?? 0
        ) + 1,
      );
    }
  }

  return result;
}
