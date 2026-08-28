import {
  and,
  eq,
  inArray,
} from "drizzle-orm";

import type { AppDatabase } from "../db/db";
import {
  userRoles,
  users,
} from "../db/schema";
import {
  approvalPolicies,
  approvalPolicyActors,
} from "../db/workflowSchema";

type PolicyResolution = {
  policyId: number;
  mode: string;
  minimumApprovals: number;
  eligibleUserIds: number[];
};

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function activeUserIds(
  db: AppDatabase,
  ids: number[],
) {
  const unique = [
    ...new Set(
      ids.filter(
        (id) =>
          Number.isInteger(id) &&
          id > 0,
      ),
    ),
  ];

  if (!unique.length) {
    return [];
  }

  const rows = await db
    .select({
      id: users.id,
    })
    .from(users)
    .where(
      and(
        inArray(users.id, unique),
        eq(users.status, "active"),
      ),
    );

  return rows.map(
    (row) => row.id,
  );
}

/**
 * Resolve the concrete users eligible for a workflow approval policy.
 *
 * The current CMS Workflow Builder creates `role` actors using stable
 * tenant role IDs. The additional subjects are supported for expansion.
 */
export async function resolveApprovalPolicy(
  db: AppDatabase,
  input: {
    policyId: number;
    subjectUserId: number;
  },
): Promise<PolicyResolution | null> {
  const [policy] = await db
    .select()
    .from(approvalPolicies)
    .where(
      and(
        eq(
          approvalPolicies.id,
          input.policyId,
        ),
        eq(
          approvalPolicies.enabled,
          true,
        ),
      ),
    )
    .limit(1);

  if (!policy) {
    return null;
  }

  const [subjectRows, actors] =
    await Promise.all([
      db
        .select({
          id: users.id,
          department: users.department,
          designation: users.designation,
          reportsToId: users.reportsToId,
        })
        .from(users)
        .where(
          eq(
            users.id,
            input.subjectUserId,
          ),
        )
        .limit(1),

      db
        .select()
        .from(approvalPolicyActors)
        .where(
          and(
            eq(
              approvalPolicyActors.policyId,
              input.policyId,
            ),
            eq(
              approvalPolicyActors.enabled,
              true,
            ),
          ),
        ),
    ]);

  const subject = subjectRows[0];

  if (!subject) {
    return null;
  }

  const candidates =
    new Set<number>();

  const roleIds = actors
    .filter(
      (actor) =>
        actor.subjectType === "role" &&
        actor.roleId,
    )
    .map(
      (actor) =>
        Number(actor.roleId),
    );

  if (roleIds.length) {
    const rows = await db
      .select({
        userId: userRoles.userId,
      })
      .from(userRoles)
      .innerJoin(
        users,
        eq(
          userRoles.userId,
          users.id,
        ),
      )
      .where(
        and(
          inArray(
            userRoles.roleId,
            roleIds,
          ),
          eq(
            users.status,
            "active",
          ),
        ),
      );

    for (const row of rows) {
      candidates.add(row.userId);
    }
  }

  for (const actor of actors) {
    if (
      actor.subjectType === "user" &&
      actor.userId
    ) {
      candidates.add(actor.userId);
    }

    if (
      actor.subjectType === "reports_to" &&
      subject.reportsToId
    ) {
      candidates.add(subject.reportsToId);
    }

    const config =
      objectValue(actor.scopeConfig);

    if (
      actor.subjectType === "designation"
    ) {
      const designation =
        typeof config.designation === "string"
          ? config.designation.trim()
          : "";

      if (designation) {
        const rows = await db
          .select({
            id: users.id,
          })
          .from(users)
          .where(
            and(
              eq(
                users.designation,
                designation,
              ),
              eq(
                users.status,
                "active",
              ),
            ),
          );

        for (const row of rows) {
          candidates.add(row.id);
        }
      }
    }

    if (
      actor.subjectType === "department_manager" &&
      subject.department
    ) {
      const roleId =
        Number(config.roleId);

      if (
        Number.isInteger(roleId) &&
        roleId > 0
      ) {
        const rows = await db
          .select({
            id: users.id,
          })
          .from(userRoles)
          .innerJoin(
            users,
            eq(
              userRoles.userId,
              users.id,
            ),
          )
          .where(
            and(
              eq(
                userRoles.roleId,
                roleId,
              ),
              eq(
                users.department,
                subject.department,
              ),
              eq(
                users.status,
                "active",
              ),
            ),
          );

        for (const row of rows) {
          candidates.add(row.id);
        }
      }
    }
  }

  return {
    policyId: policy.id,
    mode: policy.mode,
    minimumApprovals:
      policy.minimumApprovals,
    eligibleUserIds:
      await activeUserIds(
        db,
        [...candidates],
      ),
  };
}

export async function userCanApprovePolicy(
  db: AppDatabase,
  input: {
    policyId: number;
    subjectUserId: number;
    actorUserId: number;
  },
) {
  const resolution =
    await resolveApprovalPolicy(
      db,
      {
        policyId: input.policyId,
        subjectUserId:
          input.subjectUserId,
      },
    );

  return Boolean(
    resolution &&
      resolution.eligibleUserIds.includes(
        input.actorUserId,
      ),
  );
}
