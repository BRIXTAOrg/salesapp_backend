import {
  and,
  asc,
  eq,
  inArray,
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

const PREFIX =
  "employee.reporting-policy.";

export type ReportingPolicyMode =
  | "unset"
  | "specific_user"
  | "role"
  | "top_level";

export type ReportingScope =
  | "same_department"
  | "same_area"
  | "same_zone"
  | "same_department_area"
  | "same_department_zone"
  | "organization";

export type ReportingPolicy = {
  version: 1;
  mode: ReportingPolicyMode;
  userId?: number;
  roleId?: number;
  scope?: ReportingScope;
};

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
}

function positiveInteger(
  value: unknown,
) {
  const number =
    Number(value);

  return Number.isInteger(number) &&
    number > 0
      ? number
      : undefined;
}

export function normalizeReportingPolicy(
  value: unknown,
): ReportingPolicy {
  const raw =
    objectValue(value);

  const mode =
    String(
      raw.mode ?? "",
    );

  if (
    mode === "specific_user"
  ) {
    return {
      version: 1,
      mode:
        "specific_user",
      userId:
        positiveInteger(
          raw.userId,
        ),
    };
  }

  if (mode === "role") {
    const rawScope =
      String(
        raw.scope ??
        "same_department",
      );

    const allowed:
      ReportingScope[] = [
        "same_department",
        "same_area",
        "same_zone",
        "same_department_area",
        "same_department_zone",
        "organization",
      ];

    return {
      version: 1,
      mode: "role",
      roleId:
        positiveInteger(
          raw.roleId,
        ),
      scope:
        allowed.includes(
          rawScope as ReportingScope,
        )
          ? rawScope as ReportingScope
          : "same_department",
    };
  }

  if (
    mode === "top_level"
  ) {
    return {
      version: 1,
      mode:
        "top_level",
    };
  }

  return {
    version: 1,
    mode: "unset",
  };
}

function keyFor(
  userId: number,
) {
  return (
    PREFIX +
    String(userId)
  );
}

function normalized(
  value: unknown,
) {
  return String(
    value ?? "",
  )
    .trim()
    .toLowerCase();
}

function departmentSet(
  value: unknown,
) {
  return new Set(
    String(
      value ?? "",
    )
      .split(",")
      .map(
        (item) =>
          normalized(item),
      )
      .filter(Boolean),
  );
}

function sameDepartment(
  left: unknown,
  right: unknown,
) {
  const a =
    departmentSet(left);

  const b =
    departmentSet(right);

  for (
    const item of a
  ) {
    if (b.has(item)) {
      return true;
    }
  }

  return false;
}

function same(
  left: unknown,
  right: unknown,
) {
  const a =
    normalized(left);

  const b =
    normalized(right);

  return Boolean(a) &&
    a === b;
}

function matchesScope(
  subject: {
    department: string | null;
    area: string | null;
    zone: string | null;
  },
  candidate: {
    department: string | null;
    area: string | null;
    zone: string | null;
  },
  scope: ReportingScope,
) {
  switch (scope) {
    case "same_department":
      return sameDepartment(
        subject.department,
        candidate.department,
      );

    case "same_area":
      return same(
        subject.area,
        candidate.area,
      );

    case "same_zone":
      return same(
        subject.zone,
        candidate.zone,
      );

    case "same_department_area":
      return (
        sameDepartment(
          subject.department,
          candidate.department,
        ) &&
        same(
          subject.area,
          candidate.area,
        )
      );

    case "same_department_zone":
      return (
        sameDepartment(
          subject.department,
          candidate.department,
        ) &&
        same(
          subject.zone,
          candidate.zone,
        )
      );

    case "organization":
      return true;
  }
}

async function getPerson(
  db: AppDatabase,
  userId: number,
) {
  const [row] =
    await db
      .select({
        id:
          users.id,

        employeeCode:
          users.salesmanLoginId,

        name:
          users.displayName,

        department:
          users.department,

        designation:
          users.designation,

        area:
          users.area,

        zone:
          users.zone,

        status:
          users.status,

        mobileAccess:
          users.isSalesAppUser,

        reportsToId:
          users.reportsToId,
      })
      .from(users)
      .where(
        eq(
          users.id,
          userId,
        ),
      )
      .limit(1);

  return row ?? null;
}

export async function getReportingPolicy(
  db: AppDatabase,
  userId: number,
): Promise<ReportingPolicy> {
  const [stored] =
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
          keyFor(userId),
        ),
      )
      .limit(1);

  if (stored) {
    return normalizeReportingPolicy(
      stored.value,
    );
  }

  /*
   * Compatibility with historical reports_to_id records.
   */
  const employee =
    await getPerson(
      db,
      userId,
    );

  if (
    employee?.reportsToId
  ) {
    return {
      version: 1,
      mode:
        "specific_user",
      userId:
        employee.reportsToId,
    };
  }

  /*
   * NULL does not automatically mean Top Level.
   * It means old/unconfigured until explicitly selected.
   */
  return {
    version: 1,
    mode: "unset",
  };
}

export async function resolveReportingManager(
  db: AppDatabase,
  userId: number,
  policyOverride?: unknown,
) {
  const employee =
    await getPerson(
      db,
      userId,
    );

  const policy =
    policyOverride === undefined
      ? await getReportingPolicy(
          db,
          userId,
        )
      : normalizeReportingPolicy(
          policyOverride,
        );

  if (!employee) {
    return {
      policy,
      status:
        "invalid" as const,
      managerId:
        null as number | null,
      candidateIds:
        [] as number[],
      reason:
        "Employee does not exist.",
    };
  }

  if (
    policy.mode ===
    "unset"
  ) {
    return {
      policy,
      status:
        "unset" as const,
      managerId: null,
      candidateIds:
        [] as number[],
      reason:
        "Reporting method has not been configured.",
    };
  }

  if (
    policy.mode ===
    "top_level"
  ) {
    return {
      policy,
      status:
        "top_level" as const,
      managerId: null,
      candidateIds:
        [] as number[],
      reason:
        "Employee is intentionally top level.",
    };
  }

  if (
    policy.mode ===
    "specific_user"
  ) {
    if (!policy.userId) {
      return {
        policy,
        status:
          "invalid" as const,
        managerId: null,
        candidateIds:
          [] as number[],
        reason:
          "Choose a manager.",
      };
    }

    if (
      policy.userId ===
      userId
    ) {
      return {
        policy,
        status:
          "invalid" as const,
        managerId: null,
        candidateIds:
          [] as number[],
        reason:
          "An employee cannot report to themselves.",
      };
    }

    const manager =
      await getPerson(
        db,
        policy.userId,
      );

    if (
      !manager ||
      !manager.mobileAccess ||
      manager.status !==
        "active"
    ) {
      return {
        policy,
        status:
          "invalid" as const,
        managerId: null,
        candidateIds:
          [] as number[],
        reason:
          "The selected manager is not an active employee.",
      };
    }

    return {
      policy,
      status:
        "resolved" as const,
      managerId:
        manager.id,
      candidateIds: [
        manager.id,
      ],
      reason:
        undefined,
    };
  }

  if (!policy.roleId) {
    return {
      policy,
      status:
        "invalid" as const,
      managerId: null,
      candidateIds:
        [] as number[],
      reason:
        "Choose a Manager Role.",
    };
  }

  const candidates =
    await db
      .select({
        id:
          users.id,

        department:
          users.department,

        area:
          users.area,

        zone:
          users.zone,
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
            policy.roleId,
          ),

          eq(
            users.isSalesAppUser,
            true,
          ),

          eq(
            users.status,
            "active",
          ),
        ),
      )
      .orderBy(
        asc(users.id),
      );

  const scope =
    policy.scope ??
    "same_department";

  const matching =
    candidates.filter(
      (candidate) =>
        candidate.id !==
          userId &&
        matchesScope(
          employee,
          candidate,
          scope,
        ),
    );

  const candidateIds =
    matching.map(
      (candidate) =>
        candidate.id,
    );

  if (
    candidateIds.length ===
    0
  ) {
    return {
      policy,
      status:
        "no_match" as const,
      managerId: null,
      candidateIds,
      reason:
        "No active employee matches this Role and scope.",
    };
  }

  if (
    candidateIds.length >
    1
  ) {
    return {
      policy,
      status:
        "ambiguous" as const,
      managerId: null,
      candidateIds,
      reason:
        `${candidateIds.length} employees match this Role and scope.`,
    };
  }

  return {
    policy,
    status:
      "resolved" as const,
    managerId:
      candidateIds[0],
    candidateIds,
    reason:
      undefined,
  };
}

async function reportingPathIds(
  db: AppDatabase,
  userId: number,
  firstPolicyOverride?: unknown,
) {
  const result: number[] = [
    userId,
  ];

  const seen =
    new Set<number>([
      userId,
    ]);

  let current =
    userId;

  for (
    let depth = 0;
    depth < 50;
    depth++
  ) {
    const resolution =
      await resolveReportingManager(
        db,
        current,
        depth === 0
          ? firstPolicyOverride
          : undefined,
      );

    if (
      !resolution.managerId
    ) {
      return {
        ids:
          result,
        status:
          resolution.status,
      };
    }

    if (
      seen.has(
        resolution.managerId,
      )
    ) {
      return {
        ids: [
          ...result,
          resolution.managerId,
        ],
        status:
          "cycle" as const,
      };
    }

    seen.add(
      resolution.managerId,
    );

    result.push(
      resolution.managerId,
    );

    current =
      resolution.managerId;
  }

  return {
    ids:
      result,
    status:
      "cycle" as const,
  };
}

async function peopleForIds(
  db: AppDatabase,
  ids: number[],
) {
  if (!ids.length) {
    return [];
  }

  return db
    .select({
      id:
        users.id,

      employeeCode:
        users.salesmanLoginId,

      name:
        users.displayName,

      department:
        users.department,

      designation:
        users.designation,

      area:
        users.area,

      zone:
        users.zone,

      status:
        users.status,
    })
    .from(users)
    .where(
      inArray(
        users.id,
        ids,
      ),
    );
}

export async function getReportingSnapshot(
  db: AppDatabase,
  userId: number,
  policyOverride?: unknown,
) {
  const resolution =
    await resolveReportingManager(
      db,
      userId,
      policyOverride,
    );

  const path =
    await reportingPathIds(
      db,
      userId,
      policyOverride,
    );

  const ids = [
    ...new Set([
      ...resolution.candidateIds,
      ...path.ids,
      ...(resolution.managerId
        ? [
            resolution.managerId,
          ]
        : []),
    ]),
  ];

  const people =
    await peopleForIds(
      db,
      ids,
    );

  const byId =
    new Map(
      people.map(
        (person) => [
          person.id,
          person,
        ],
      ),
    );

  return {
    policy:
      resolution.policy,

    resolution: {
      status:
        resolution.status,

      managerId:
        resolution.managerId,

      candidateIds:
        resolution.candidateIds,

      reason:
        resolution.reason,
    },

    manager:
      resolution.managerId
        ? byId.get(
            resolution.managerId,
          ) ?? null
        : null,

    candidates:
      resolution.candidateIds
        .map(
          (id) =>
            byId.get(id),
        )
        .filter(
          (
            item,
          ): item is NonNullable<
            typeof item
          > =>
            Boolean(item),
        ),

    path:
      path.ids
        .map(
          (id) =>
            byId.get(id),
        )
        .filter(
          (
            item,
          ): item is NonNullable<
            typeof item
          > =>
            Boolean(item),
        ),

    pathStatus:
      path.status,
  };
}

export async function saveReportingPolicy(
  db: AppDatabase,
  input: {
    userId: number;
    policy: unknown;
    actorUserId?: number | null;
  },
) {
  const policy =
    normalizeReportingPolicy(
      input.policy,
    );

  const employee =
    await getPerson(
      db,
      input.userId,
    );

  if (!employee) {
    throw new Error(
      "Employee not found.",
    );
  }

  const resolution =
    await resolveReportingManager(
      db,
      input.userId,
      policy,
    );

  if (
    policy.mode ===
      "specific_user" &&
    resolution.status !==
      "resolved"
  ) {
    throw new Error(
      resolution.reason ??
      "Unable to resolve manager.",
    );
  }

  if (
    policy.mode ===
      "role" &&
    resolution.status ===
      "invalid"
  ) {
    throw new Error(
      resolution.reason ??
      "Invalid Role reporting policy.",
    );
  }

  const path =
    await reportingPathIds(
      db,
      input.userId,
      policy,
    );

  if (
    path.status ===
    "cycle"
  ) {
    throw new Error(
      "REPORTING_HIERARCHY_CYCLE: This change would create a circular reporting hierarchy.",
    );
  }

  const now =
    new Date();

  await db
    .insert(
      workspaceSettings,
    )
    .values({
      key:
        keyFor(
          input.userId,
        ),

      value:
        policy,

      updatedByUserId:
        input.actorUserId ??
        null,

      updatedAt:
        now,
    })
    .onConflictDoUpdate({
      target:
        workspaceSettings.key,

      set: {
        value:
          policy,

        updatedByUserId:
          input.actorUserId ??
          null,

        updatedAt:
          now,
      },
    });

  /*
   * Compatibility/cache for old screens and record scoping.
   * Kernel manager_of() will use the resolver directly.
   */
  await db
    .update(users)
    .set({
      reportsToId:
        resolution.status ===
          "resolved"
          ? resolution.managerId
          : null,

      updatedAt:
        new Date()
          .toISOString(),
    })
    .where(
      eq(
        users.id,
        input.userId,
      ),
    );

  return getReportingSnapshot(
    db,
    input.userId,
  );
}

export async function refreshReportingCaches(
  db: AppDatabase,
) {
  const rows =
    await db
      .select({
        id:
          users.id,
      })
      .from(users)
      .where(
        eq(
          users.isSalesAppUser,
          true,
        ),
      );

  for (
    const row of rows
  ) {
    const resolution =
      await resolveReportingManager(
        db,
        row.id,
      );

    await db
      .update(users)
      .set({
        reportsToId:
          resolution.status ===
            "resolved"
            ? resolution.managerId
            : null,

        updatedAt:
          new Date()
            .toISOString(),
      })
      .where(
        eq(
          users.id,
          row.id,
        ),
      );
  }
}
