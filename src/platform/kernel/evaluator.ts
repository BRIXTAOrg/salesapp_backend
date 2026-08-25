import {
  and,
  eq,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../../db/db";

import {
  roles,
  userRoles,
  users,
} from "../../db/schema";

import type {
  KernelActor,
  KernelConditionGroup,
  KernelRuntimeWorld,
  KernelValueRef,
  ResponsibilityKernel,
} from "./types";

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function readPath(
  value: unknown,
  path?: string,
): unknown {
  if (!path) return value;

  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, segment) => {
      if (
        current &&
        typeof current === "object" &&
        !Array.isArray(current)
      ) {
        return (current as Record<string, unknown>)[segment];
      }
      return undefined;
    }, value);
}

function numeric(
  value: unknown,
) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number
    : null;
}

export function resolveValueRef(
  world: KernelRuntimeWorld,
  ref?: KernelValueRef,
): unknown {
  if (!ref) return undefined;

  switch (ref.kind) {
    case "literal":
      return ref.value;
    case "context":
      return readPath(
        world.context[ref.key],
        ref.path,
      );
    case "state":
      return world.state[ref.key] ??
        (Object.values(world.state).includes(ref.key)
          ? ref.key
          : undefined);
    case "object":
      return readPath(
        world.objects[ref.key],
        ref.path,
      );
    case "actor":
      return readPath(
        world.actors[ref.key],
        ref.path,
      );
    case "capture":
      return readPath(
        world.captures[ref.key],
        ref.path,
      );
    case "query":
      return readPath(
        world.queries[ref.key],
        ref.path,
      );
    case "computed":
      return readPath(
        world.computed[ref.key],
        ref.path,
      );
    case "history":
      return readPath(
        world.history,
        ref.path ?? ref.key,
      );
    default:
      return undefined;
  }
}

function conditionResult(
  left: unknown,
  operator: string,
  right: unknown,
) {
  switch (operator) {
    case "neq":
      return left !== right;
    case "gt": {
      const l = numeric(left);
      const r = numeric(right);
      return l !== null && r !== null && l > r;
    }
    case "gte": {
      const l = numeric(left);
      const r = numeric(right);
      return l !== null && r !== null && l >= r;
    }
    case "lt": {
      const l = numeric(left);
      const r = numeric(right);
      return l !== null && r !== null && l < r;
    }
    case "lte": {
      const l = numeric(left);
      const r = numeric(right);
      return l !== null && r !== null && l <= r;
    }
    case "exists":
      return left !== null && left !== undefined && left !== "";
    case "not_exists":
      return left === null || left === undefined || left === "";
    case "contains":
      return Array.isArray(left)
        ? left.includes(right)
        : String(left ?? "")
            .toLowerCase()
            .includes(String(right ?? "").toLowerCase());
    case "in":
      return Array.isArray(right) && right.includes(left);
    case "between":
      if (!Array.isArray(right) || right.length < 2) return false;
      return Number(left) >= Number(right[0]) &&
        Number(left) <= Number(right[1]);
    default:
      return left === right;
  }
}

export function evaluateConditionGroup(
  world: KernelRuntimeWorld,
  group?: KernelConditionGroup,
) {
  if (!group || !group.conditions.length) {
    return true;
  }

  const values = group.conditions.map((condition) =>
    conditionResult(
      resolveValueRef(world, condition.left),
      condition.operator,
      resolveValueRef(world, condition.right),
    ),
  );

  return group.mode === "any"
    ? values.some(Boolean)
    : values.every(Boolean);
}

function referenceUserId(
  value: unknown,
) {
  if (Number.isInteger(Number(value))) {
    return Number(value);
  }

  const raw = objectValue(value);
  const candidates = [
    raw.userId,
    raw.user_id,
    raw.id,
    raw.value,
  ];

  for (const candidate of candidates) {
    const id = Number(candidate);
    if (Number.isInteger(id) && id > 0) {
      return id;
    }
  }

  return null;
}

export async function resolveActorUserIds(
  db: AppDatabase,
  kernel: ResponsibilityKernel,
  actorId: string,
  world: KernelRuntimeWorld,
): Promise<number[]> {
  const actor = kernel.runtimeWorld.actors.find(
    (candidate) => candidate.id === actorId,
  );

  if (!actor) return [];

  // This conventional key always means the employee whose record/process is
  // being operated on. That keeps manager/reviewer actions unambiguous.
  if (actor.id === "current_employee") {
    return [world.subjectUserId];
  }

  return resolveActorResolver(
    db,
    kernel,
    actor,
    world,
  );
}

async function resolveActorResolver(
  db: AppDatabase,
  kernel: ResponsibilityKernel,
  actor: KernelActor,
  world: KernelRuntimeWorld,
): Promise<number[]> {
  const resolver = actor.resolver;

  switch (resolver.kind) {
    case "current_user":
      return [world.actorUserId];

    case "record_creator":
      return [world.subjectUserId];

    case "specific_user":
      return Number.isInteger(resolver.userId)
        ? [Number(resolver.userId)]
        : [];

    case "role": {
      if (!Number.isInteger(resolver.roleId)) return [];

      const rows = await db
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .innerJoin(
          roles,
          eq(roles.id, userRoles.roleId),
        )
        .innerJoin(
          users,
          eq(users.id, userRoles.userId),
        )
        .where(
          and(
            eq(userRoles.roleId, Number(resolver.roleId)),
            eq(users.status, "active"),
          ),
        );

      return rows.map((row) => row.userId);
    }

    case "manager_of": {
      const subject =
        referenceUserId(
          resolveValueRef(
            world,
            resolver.value,
          ),
        ) ??
        world.subjectUserId;

      const [row] = await db
        .select({ reportsToId: users.reportsToId })
        .from(users)
        .where(eq(users.id, subject))
        .limit(1);

      return row?.reportsToId
        ? [row.reportsToId]
        : [];
    }

    case "selected_reference": {
      const id = referenceUserId(
        world.captures[resolver.referenceKey] ??
        world.context[resolver.referenceKey],
      );
      return id ? [id] : [];
    }

    case "query_result": {
      const id = referenceUserId(
        readPath(
          world.queries[resolver.queryKey],
          resolver.path,
        ),
      );
      return id ? [id] : [];
    }

    case "relationship": {
      const sourceUserId = referenceUserId(
        resolveValueRef(world, resolver.source),
      );

      if (!sourceUserId) return [];

      if (
        resolver.relation === "manager" ||
        resolver.relation === "reports_to"
      ) {
        const [row] = await db
          .select({ reportsToId: users.reportsToId })
          .from(users)
          .where(eq(users.id, sourceUserId))
          .limit(1);

        return row?.reportsToId
          ? [row.reportsToId]
          : [];
      }

      return [];
    }

    case "system":
      return [];

    default:
      return [];
  }
}

export async function actorCanAct(
  db: AppDatabase,
  kernel: ResponsibilityKernel,
  actorId: string | undefined,
  world: KernelRuntimeWorld,
) {
  if (!actorId) return true;

  const ids = await resolveActorUserIds(
    db,
    kernel,
    actorId,
    world,
  );

  return ids.includes(world.actorUserId);
}
