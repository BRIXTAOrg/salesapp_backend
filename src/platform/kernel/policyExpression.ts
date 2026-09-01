// BRIXTA_DYNAMIC_POLICY_ENGINE_V1
//
// Declarative server-side business policy evaluator.
//
// NO eval.
// NO JavaScript supplied by tenants.
// NO arbitrary code execution.
//
// A Responsibility may express deep pre-action predicates as a safe JSON AST.

import type { KernelRuntimeWorld } from "./types";

function obj(v: unknown): Record<string, unknown> {
  return v &&
    typeof v === "object" &&
    !Array.isArray(v)
    ? v as Record<string, unknown>
    : {};
}

function path(v: unknown, p?: string) {
  if (!p) return v;

  let x = v;

  for (const part of p.split(".").filter(Boolean)) {
    if (!x || typeof x !== "object") {
      return undefined;
    }

    x = (x as Record<string, unknown>)[part];
  }

  return x;
}

function num(v: unknown) {
  const n = Number(v);

  if (!Number.isFinite(n)) {
    throw new Error(
      `Expected finite number, got ${String(v)}.`,
    );
  }

  return n;
}

function instant(v: unknown) {
  const n = new Date(
    String(v ?? ""),
  ).getTime();

  if (!Number.isFinite(n)) {
    throw new Error(
      `Expected valid date/time, got ${String(v)}.`,
    );
  }

  return n;
}

function localParts(
  v: unknown,
  timezone: string,
) {
  const d = new Date(
    String(v ?? ""),
  );

  if (!Number.isFinite(d.getTime())) {
    throw new Error(
      "Invalid temporal value.",
    );
  }

  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: timezone,

        year: "numeric",
        month: "2-digit",
        day: "2-digit",

        weekday: "short",

        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",

        hourCycle: "h23",
      },
    ).formatToParts(d);

  const m =
    Object.fromEntries(
      parts.map(
        (x) => [
          x.type,
          x.value,
        ],
      ),
    );

  return {
    year: Number(m.year),
    month: Number(m.month),
    day: Number(m.day),

    hour: Number(m.hour),
    minute: Number(m.minute),
    second: Number(m.second),

    weekday:
      String(
        m.weekday ?? "",
      ),
  };
}

function same(
  a: unknown,
  b: unknown,
) {
  if (a === b) {
    return true;
  }

  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object"
  ) {
    try {
      return (
        JSON.stringify(a) ===
        JSON.stringify(b)
      );
    } catch {
      return false;
    }
  }

  return false;
}

function ordered(
  v: unknown,
): number | string {
  if (typeof v === "number") {
    return v;
  }

  if (typeof v === "string") {
    const n = Number(v);

    if (
      v.trim() &&
      Number.isFinite(n)
    ) {
      return n;
    }

    const d =
      Date.parse(v);

    if (
      Number.isFinite(d)
    ) {
      return d;
    }

    return v;
  }

  return String(v);
}

function ref(
  world: KernelRuntimeWorld,
  scope: string,
  key: string,
) {
  if (scope === "server") {
    const v:
      Record<string, unknown> = {
        now:
          world.now,

        actorUserId:
          world.actorUserId,

        subjectUserId:
          world.subjectUserId,

        responsibilityId:
          world.responsibilityId,

        recordId:
          world.recordId,
      };

    return key
      ? v[key]
      : v;
  }

  if (
    scope === "history"
  ) {
    return key
      ? path(
          {
            entries:
              world.history,
          },
          key,
        )
      : world.history;
  }

  const buckets:
    Record<
      string,
      Record<string, unknown>
    > = {
      context:
        world.context,

      capture:
        world.captures,

      actor:
        world.actors,

      state:
        world.state,

      query:
        world.queries,

      computed:
        world.computed,

      object:
        world.objects,
    };

  const bucket =
    buckets[scope];

  if (!bucket) {
    throw new Error(
      `Unsupported policy ref scope "${scope}".`,
    );
  }

  return key
    ? bucket[key]
    : bucket;
}

export function evaluatePolicyExpression(
  raw: unknown,
  world: KernelRuntimeWorld,
  depth = 0,
): unknown {
  if (
    depth > 40
  ) {
    throw new Error(
      "Policy expression exceeded maximum depth.",
    );
  }

  if (
    raw === null ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return raw;
  }

  const e =
    obj(raw);

  const op =
    String(
      e.op ?? "",
    ).trim();

  if (!op) {
    throw new Error(
      "Policy expression requires op.",
    );
  }

  const ev = (
    v: unknown,
  ) =>
    evaluatePolicyExpression(
      v,
      world,
      depth + 1,
    );

  if (
    op === "literal"
  ) {
    return e.value;
  }

  if (
    op === "server_now"
  ) {
    return world.now;
  }

  if (
    op === "ref"
  ) {
    return path(
      ref(
        world,
        String(
          e.scope ??
            "context",
        ),
        String(
          e.key ??
            "",
        ),
      ),

      typeof e.path ===
        "string"
        ? e.path
        : undefined,
    );
  }

  if (
    op === "coalesce"
  ) {
    const values =
      Array.isArray(
        e.values,
      )
        ? e.values
        : [
            e.left,
            e.right,
          ];

    for (
      const value
      of values
    ) {
      const x =
        ev(value);

      if (
        x !== null &&
        x !== undefined &&
        x !== ""
      ) {
        return x;
      }
    }

    return null;
  }

  if (
    op === "and"
  ) {
    return (
      Array.isArray(
        e.values,
      )
        ? e.values
        : [
            e.left,
            e.right,
          ]
    ).every(
      (v) =>
        Boolean(
          ev(v),
        ),
    );
  }

  if (
    op === "or"
  ) {
    return (
      Array.isArray(
        e.values,
      )
        ? e.values
        : [
            e.left,
            e.right,
          ]
    ).some(
      (v) =>
        Boolean(
          ev(v),
        ),
    );
  }

  if (
    op === "not"
  ) {
    return !Boolean(
      ev(
        e.value,
      ),
    );
  }

  if (
    op === "if"
  ) {
    return Boolean(
      ev(
        e.condition,
      ),
    )
      ? ev(
          e.then,
        )
      : ev(
          e.else,
        );
  }

  if (
    op === "eq"
  ) {
    return same(
      ev(
        e.left,
      ),
      ev(
        e.right,
      ),
    );
  }

  if (
    op === "neq"
  ) {
    return !same(
      ev(
        e.left,
      ),
      ev(
        e.right,
      ),
    );
  }

  if (
    [
      "gt",
      "gte",
      "lt",
      "lte",
    ].includes(op)
  ) {
    const a =
      ordered(
        ev(
          e.left,
        ),
      );

    const b =
      ordered(
        ev(
          e.right,
        ),
      );

    if (
      op === "gt"
    ) {
      return a > b;
    }

    if (
      op === "gte"
    ) {
      return a >= b;
    }

    if (
      op === "lt"
    ) {
      return a < b;
    }

    return a <= b;
  }

  if (
    op === "between"
  ) {
    const v =
      ordered(
        ev(
          e.value,
        ),
      );

    const a =
      ordered(
        ev(
          e.min,
        ),
      );

    const b =
      ordered(
        ev(
          e.max,
        ),
      );

    return (
      v >= a &&
      v <= b
    );
  }

  if (
    op === "contains"
  ) {
    const a =
      ev(
        e.container ??
          e.left,
      );

    const b =
      ev(
        e.value ??
          e.right,
      );

    if (
      typeof a === "string"
    ) {
      return a.includes(
        String(
          b ?? "",
        ),
      );
    }

    if (
      Array.isArray(a)
    ) {
      return a.some(
        (x) =>
          same(
            x,
            b,
          ),
      );
    }

    return false;
  }

  if (
    op === "exists"
  ) {
    const v =
      ev(
        e.value,
      );

    return (
      v !== null &&
      v !== undefined &&
      v !== ""
    );
  }

  if (
    op === "add"
  ) {
    return (
      num(
        ev(
          e.left,
        ),
      ) +
      num(
        ev(
          e.right,
        ),
      )
    );
  }

  if (
    op === "subtract"
  ) {
    return (
      num(
        ev(
          e.left,
        ),
      ) -
      num(
        ev(
          e.right,
        ),
      )
    );
  }

  if (
    op === "multiply"
  ) {
    return (
      num(
        ev(
          e.left,
        ),
      ) *
      num(
        ev(
          e.right,
        ),
      )
    );
  }

  if (
    op === "divide"
  ) {
    const d =
      num(
        ev(
          e.right,
        ),
      );

    if (
      d === 0
    ) {
      throw new Error(
        "Division by zero.",
      );
    }

    return (
      num(
        ev(
          e.left,
        ),
      ) /
      d
    );
  }

  if (
    op === "mod"
  ) {
    const d =
      num(
        ev(
          e.right,
        ),
      );

    if (
      d === 0
    ) {
      throw new Error(
        "Modulo by zero.",
      );
    }

    return (
      num(
        ev(
          e.left,
        ),
      ) %
      d
    );
  }

  if (
    op === "min"
  ) {
    return Math.min(
      num(
        ev(
          e.left,
        ),
      ),
      num(
        ev(
          e.right,
        ),
      ),
    );
  }

  if (
    op === "max"
  ) {
    return Math.max(
      num(
        ev(
          e.left,
        ),
      ),
      num(
        ev(
          e.right,
        ),
      ),
    );
  }

  if (
    op === "round"
  ) {
    return Math.round(
      num(
        ev(
          e.value,
        ),
      ),
    );
  }

  if (
    op === "abs"
  ) {
    return Math.abs(
      num(
        ev(
          e.value,
        ),
      ),
    );
  }

  if (
    op ===
    "time.local_minutes"
  ) {
    const p =
      localParts(
        ev(
          e.value ?? {
            op:
              "server_now",
          },
        ),

        String(
          e.timezone ??
            "UTC",
        ),
      );

    return (
      p.hour * 60 +
      p.minute +
      p.second / 60
    );
  }

  if (
    op ===
    "time.local_date"
  ) {
    const p =
      localParts(
        ev(
          e.value ?? {
            op:
              "server_now",
          },
        ),

        String(
          e.timezone ??
            "UTC",
        ),
      );

    return [
      String(
        p.year,
      ).padStart(
        4,
        "0",
      ),

      String(
        p.month,
      ).padStart(
        2,
        "0",
      ),

      String(
        p.day,
      ).padStart(
        2,
        "0",
      ),
    ].join("-");
  }

  if (
    op ===
    "time.day_of_week"
  ) {
    const p =
      localParts(
        ev(
          e.value ?? {
            op:
              "server_now",
          },
        ),

        String(
          e.timezone ??
            "UTC",
        ),
      );

    return (
      {
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
        Sun: 7,
      } as Record<
        string,
        number
      >
    )[
      p.weekday
    ] ?? 0;
  }

  if (
    op ===
    "time.difference_minutes"
  ) {
    return (
      instant(
        ev(
          e.end,
        ),
      ) -
      instant(
        ev(
          e.start,
        ),
      )
    ) / 60000;
  }

  if (
    op ===
    "time.add_minutes"
  ) {
    return new Date(
      instant(
        ev(
          e.value,
        ),
      ) +
      num(
        ev(
          e.minutes,
        ),
      ) *
        60000,
    ).toISOString();
  }

  throw new Error(
    `Unsupported policy expression op "${op}".`,
  );
}

export function evaluatePolicyExpressionBoolean(
  raw: unknown,
  world: KernelRuntimeWorld,
) {
  const v =
    evaluatePolicyExpression(
      raw,
      world,
    );

  if (
    typeof v !==
    "boolean"
  ) {
    throw new Error(
      "Policy expression must resolve to boolean.",
    );
  }

  return v;
}
