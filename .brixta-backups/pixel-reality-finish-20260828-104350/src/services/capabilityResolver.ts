import {
  and,
  asc,
  eq,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../db/db";

import {
  mobileCapabilities,
  roles,
  userMobileCapabilities,
  userRoles,
  users,
} from "../db/schema";

import {
  capabilityAssignmentRules,
} from "../db/applianceSchema";

type EmployeeIdentity = {
  id: number;
  department: string | null;
  designation: string | null;
  legacyRole: string;
  roleIds: string[];
  roleLabels: string[];
};

export type ResolvedCapability = {
  id: number;
  key: string;
  title: string;
  type: string;
  description: string | null;
  icon: string | null;
  config: Record<string, unknown>;
  source: {
    kind:
      | "direct"
      | "user_rule"
      | "designation"
      | "department"
      | "role"
      | "all";
    ruleId?: number;
  };
  sortOrder: number;
};

const subjectWeight: Record<
  string,
  number
> = {
  all: 10,
  role: 40,
  department: 60,
  designation: 70,
  user: 90,
};

function ruleMatches(
  employee: EmployeeIdentity,
  subjectType: string,
  subjectValue: string | null,
) {
  switch (subjectType) {
    case "all":
      return true;
    case "user":
      return subjectValue ===
        String(employee.id);
    case "department":
      return Boolean(
        employee.department,
      ) &&
        employee.department ===
          subjectValue;
    case "designation":
      return Boolean(
        employee.designation,
      ) &&
        employee.designation ===
          subjectValue;
    case "role":
      return Boolean(
        subjectValue,
      ) &&
        (
          employee.roleIds.includes(
            String(subjectValue),
          ) ||
          employee.roleLabels.includes(
            String(subjectValue),
          ) ||
          employee.legacyRole ===
            subjectValue
        );
    default:
      return false;
  }
}

function sourceKind(
  subjectType: string,
): ResolvedCapability["source"]["kind"] {
  if (subjectType === "user") {
    return "user_rule";
  }
  if (
    subjectType ===
    "designation"
  ) {
    return "designation";
  }
  if (
    subjectType ===
    "department"
  ) {
    return "department";
  }
  if (subjectType === "role") {
    return "role";
  }
  return "all";
}

/**
 * Resolve the Responsibilities available to one employee.
 *
 * Role rules now prefer stable `roles.id` values through user_roles. The
 * old users.role string and role labels remain accepted as a migration
 * bridge, so existing tenants do not lose assignments while the CMS moves
 * to stable role IDs.
 */
export async function getResolvedCapabilitiesForUser(
  db: AppDatabase,
  userId: number,
): Promise<ResolvedCapability[]> {
  const [employee] = await db
    .select({
      id:
        users.id,
      department:
        users.department,
      designation:
        users.designation,
      legacyRole:
        users.role,
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
    return [];
  }

  const [
    employeeRoleRows,
    directRows,
    ruleRows,
  ] = await Promise.all([
    db
      .select({
        id:
          roles.id,
        orgRole:
          roles.orgRole,
        jobRole:
          roles.jobRole,
      })
      .from(userRoles)
      .innerJoin(
        roles,
        eq(
          userRoles.roleId,
          roles.id,
        ),
      )
      .where(
        eq(
          userRoles.userId,
          userId,
        ),
      ),

    db
      .select({
        id:
          mobileCapabilities.id,
        key:
          mobileCapabilities.key,
        title:
          mobileCapabilities.title,
        type:
          mobileCapabilities.type,
        description:
          mobileCapabilities.description,
        icon:
          mobileCapabilities.icon,
        config:
          mobileCapabilities.config,
        sortOrder:
          userMobileCapabilities.sortOrder,
      })
      .from(
        userMobileCapabilities,
      )
      .innerJoin(
        mobileCapabilities,
        eq(
          userMobileCapabilities.capabilityId,
          mobileCapabilities.id,
        ),
      )
      .where(
        and(
          eq(
            userMobileCapabilities.userId,
            userId,
          ),
          eq(
            mobileCapabilities.isActive,
            true,
          ),
        ),
      )
      .orderBy(
        asc(
          userMobileCapabilities.sortOrder,
        ),
        asc(
          mobileCapabilities.title,
        ),
      ),

    db
      .select({
        ruleId:
          capabilityAssignmentRules.id,
        subjectType:
          capabilityAssignmentRules.subjectType,
        subjectValue:
          capabilityAssignmentRules.subjectValue,
        effect:
          capabilityAssignmentRules.effect,
        priority:
          capabilityAssignmentRules.priority,
        capabilityId:
          mobileCapabilities.id,
        key:
          mobileCapabilities.key,
        title:
          mobileCapabilities.title,
        type:
          mobileCapabilities.type,
        description:
          mobileCapabilities.description,
        icon:
          mobileCapabilities.icon,
        config:
          mobileCapabilities.config,
      })
      .from(
        capabilityAssignmentRules,
      )
      .innerJoin(
        mobileCapabilities,
        eq(
          capabilityAssignmentRules.capabilityId,
          mobileCapabilities.id,
        ),
      )
      .where(
        and(
          eq(
            capabilityAssignmentRules.enabled,
            true,
          ),
          eq(
            mobileCapabilities.isActive,
            true,
          ),
        ),
      ),
  ]);

  const roleLabels = new Set<string>();

  for (const role of employeeRoleRows) {
    if (role.orgRole) {
      roleLabels.add(
        role.orgRole,
      );
    }
    if (role.jobRole) {
      roleLabels.add(
        role.jobRole,
      );
    }
    if (
      role.orgRole &&
      role.jobRole
    ) {
      roleLabels.add(
        `${role.orgRole} · ${role.jobRole}`,
      );
    }
  }

  const identity: EmployeeIdentity = {
    ...employee,
    roleIds:
      employeeRoleRows.map(
        (role) =>
          String(role.id),
      ),
    roleLabels:
      [...roleLabels],
  };

  const selectedRules = new Map<
    number,
    (typeof ruleRows)[number] & {
      score: number;
    }
  >();

  for (const rule of ruleRows) {
    if (
      !ruleMatches(
        identity,
        rule.subjectType,
        rule.subjectValue,
      )
    ) {
      continue;
    }

    const score =
      (subjectWeight[
        rule.subjectType
      ] ?? 0) *
        10_000 +
      rule.priority;

    const current =
      selectedRules.get(
        rule.capabilityId,
      );

    if (
      !current ||
      score > current.score
    ) {
      selectedRules.set(
        rule.capabilityId,
        {
          ...rule,
          score,
        },
      );
    }
  }

  const resolved = new Map<
    number,
    ResolvedCapability
  >();

  for (
    const rule of
    selectedRules.values()
  ) {
    if (rule.effect === "deny") {
      continue;
    }

    resolved.set(
      rule.capabilityId,
      {
        id:
          rule.capabilityId,
        key:
          rule.key,
        title:
          rule.title,
        type:
          rule.type,
        description:
          rule.description,
        icon:
          rule.icon,
        config:
          (rule.config as Record<
            string,
            unknown
          > | null) ?? {},
        source: {
          kind:
            sourceKind(
              rule.subjectType,
            ),
          ruleId:
            rule.ruleId,
        },
        sortOrder:
          10_000 -
          (subjectWeight[
            rule.subjectType
          ] ?? 0) *
            10 -
          rule.priority,
      },
    );
  }

  // Direct employee assignment is the highest-precedence final layer.
  for (const direct of directRows) {
    resolved.set(
      direct.id,
      {
        id:
          direct.id,
        key:
          direct.key,
        title:
          direct.title,
        type:
          direct.type,
        description:
          direct.description,
        icon:
          direct.icon,
        config:
          (direct.config as Record<
            string,
            unknown
          > | null) ?? {},
        source: {
          kind:
            "direct",
        },
        sortOrder:
          direct.sortOrder,
      },
    );
  }

  return [
    ...resolved.values(),
  ].sort(
    (a, b) =>
      a.sortOrder -
        b.sortOrder ||
      a.title.localeCompare(
        b.title,
      ),
  );
}
