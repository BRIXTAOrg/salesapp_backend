import { and, asc, eq } from "drizzle-orm";

import { db } from "../db/db";
import { users } from "../db/schema";
import {
  adminOwnershipRules,
  workspaceSettings,
} from "../db/applianceSchema";

export type OwnerResolution = {
  userId: number | null;
  source:
    | "primary"
    | "fallback"
    | "default_admin"
    | "automatic_admin"
    | "none";
  ruleId?: number;
};

async function isUsableAdmin(userId: number | null) {
  if (!userId) return false;

  const [user] = await db
    .select({
      id: users.id,
      status: users.status,
      isDashboardUser: users.isDashboardUser,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return Boolean(
    user &&
      user.status === "active" &&
      user.isDashboardUser,
  );
}

async function getDefaultAdminId() {
  const [row] = await db
    .select({ value: workspaceSettings.value })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.key, "default_admin_user_id"))
    .limit(1);

  const value = row?.value;

  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);

  if (
    value &&
    typeof value === "object" &&
    "userId" in (value as Record<string, unknown>)
  ) {
    const parsed = Number(
      (value as Record<string, unknown>).userId,
    );
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

export async function resolveAdminOwner(input: {
  areaKey: string;
  scopeType?: string;
  scopeValue?: string | null;
}): Promise<OwnerResolution> {
  const scopeType = input.scopeType ?? "organization";

  const rules = await db
    .select()
    .from(adminOwnershipRules)
    .where(eq(adminOwnershipRules.enabled, true));

  const matching = rules
    .filter((rule) => {
      const areaMatches =
        rule.areaKey === input.areaKey ||
        rule.areaKey === "*";

      if (!areaMatches) return false;

      if (
        rule.scopeType === "organization" ||
        rule.scopeType === "*"
      ) {
        return true;
      }

      return (
        rule.scopeType === scopeType &&
        rule.scopeValue === (input.scopeValue ?? null)
      );
    })
    .sort((a, b) => {
      const score = (rule: typeof a) =>
        (rule.areaKey === input.areaKey ? 100 : 0) +
        (rule.scopeType === scopeType ? 50 : 0) +
        rule.priority;

      return score(b) - score(a);
    });

  for (const rule of matching) {
    if (await isUsableAdmin(rule.primaryAdminUserId)) {
      return {
        userId: rule.primaryAdminUserId,
        source: "primary",
        ruleId: rule.id,
      };
    }

    if (await isUsableAdmin(rule.fallbackAdminUserId)) {
      return {
        userId: rule.fallbackAdminUserId,
        source: "fallback",
        ruleId: rule.id,
      };
    }
  }

  const defaultAdminId = await getDefaultAdminId();

  if (await isUsableAdmin(defaultAdminId)) {
    return {
      userId: defaultAdminId,
      source: "default_admin",
    };
  }

  const [automaticAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.isDashboardUser, true),
        eq(users.status, "active"),
      ),
    )
    .orderBy(asc(users.id))
    .limit(1);

  if (automaticAdmin) {
    return {
      userId: automaticAdmin.id,
      source: "automatic_admin",
    };
  }

  return {
    userId: null,
    source: "none",
  };
}
