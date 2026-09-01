// BRIXTA_PIXEL_LOGIC_KERNEL_V1
import type {
  PixelLogicEffect,
  PixelLogicNode,
  PixelLogicProgram,
} from "./types";

export type PixelLogicEvent = {
  name: string;
  actionId?: string;
  payload?: unknown;
  at?: string;
};

export type PixelLogicRuntimeValues = {
  context?: Record<string, unknown>;
  capture?: Record<string, unknown>;
  actor?: Record<string, unknown>;
  state?: Record<string, unknown>;
  history?: Record<string, unknown>;
  computed?: Record<string, unknown>;
  query?: Record<string, unknown>;
  object?: Record<string, unknown>;
  variable?: Record<string, unknown>;
};

export type PixelLogicRuntimeContext = {
  event: PixelLogicEvent;
  values?: PixelLogicRuntimeValues;
};

export type PixelLogicRunResult = {
  matched: boolean;
  effects: PixelLogicEffect[];
  trace: Array<{
    nodeId: string;
    nodeType: string;
    outputs: Record<string, unknown>;
  }>;
};

export type PixelLogicExecutor = (args: {
  node: PixelLogicNode;
  inputs: Record<string, unknown>;
  runtime: PixelLogicRuntimeContext;
}) => Record<string, unknown>;

const CUSTOM_EXECUTORS = new Map<string, PixelLogicExecutor>();

/**
 * Escape hatch for packages. A package can register a new node type + executor
 * without changing the Pixel Logic graph schema.
 */
export function registerPixelLogicExecutor(
  type: string,
  executor: PixelLogicExecutor,
) {
  CUSTOM_EXECUTORS.set(type, executor);
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseLiteral(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function getPath(value: unknown, path?: string) {
  if (!path) return value;
  let current = value;
  for (const part of path.split(".").filter(Boolean)) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function localTemporalParts(
  value: unknown,
  timezone: string,
) {
  const date =
    new Date(
      String(
        value ?? "",
      ),
    );

  if (
    !Number.isFinite(
      date.getTime(),
    )
  ) {
    return null;
  }

  try {
    const parts =
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone:
            timezone,

          year:
            "numeric",

          month:
            "2-digit",

          day:
            "2-digit",

          weekday:
            "short",

          hour:
            "2-digit",

          minute:
            "2-digit",

          second:
            "2-digit",

          hourCycle:
            "h23",
        },
      ).formatToParts(
        date,
      );

    const values =
      Object.fromEntries(
        parts.map(
          (part) => [
            part.type,
            part.value,
          ],
        ),
      );

    return {
      year:
        Number(
          values.year,
        ),

      month:
        Number(
          values.month,
        ),

      day:
        Number(
          values.day,
        ),

      hour:
        Number(
          values.hour,
        ),

      minute:
        Number(
          values.minute,
        ),

      second:
        Number(
          values.second,
        ),

      weekday:
        String(
          values.weekday ??
            "",
        ),
    };
  } catch {
    return null;
  }
}

function executeCoreNode(
  node: PixelLogicNode,
  inputs: Record<string, unknown>,
  runtime: PixelLogicRuntimeContext,
  effects: PixelLogicEffect[],
) {
  const type = node.type;
  const cfg = node.config;

  if (type.startsWith("event.")) {
    return {
      event: runtime.event.payload ?? runtime.event,
      record: runtime.event.payload,
      flow: true,
    };
  }

  if (type === "value.literal") {
    return { value: parseLiteral(cfg.value) };
  }

  if (type === "value.ref") {
    const scope = String(cfg.scope ?? "context") as keyof PixelLogicRuntimeValues;
    const key = String(cfg.key ?? "");
    const bucket = runtime.values?.[scope] ?? {};
    const root = key ? bucket[key] : bucket;
    return { value: getPath(root, typeof cfg.path === "string" ? cfg.path : undefined) };
  }

  if (type === "math.add") return { value: asNumber(inputs.a) + asNumber(inputs.b) };
  if (type === "math.subtract") return { value: asNumber(inputs.a) - asNumber(inputs.b) };
  if (type === "math.multiply") return { value: asNumber(inputs.a) * asNumber(inputs.b) };
  if (type === "math.divide") {
    const divisor = asNumber(inputs.b);
    return { value: divisor === 0 ? 0 : asNumber(inputs.a) / divisor };
  }
  if (type === "math.min") return { value: Math.min(asNumber(inputs.a), asNumber(inputs.b)) };
  if (type === "math.max") return { value: Math.max(asNumber(inputs.a), asNumber(inputs.b)) };
  if (type === "math.round") return { value: Math.round(asNumber(inputs.value)) };

  if (type === "logic.and") return { value: Boolean(inputs.a) && Boolean(inputs.b) };
  if (type === "logic.or") return { value: Boolean(inputs.a) || Boolean(inputs.b) };
  if (type === "logic.not") return { value: !Boolean(inputs.value) };

  if (type === "logic.compare") {
    const left = inputs.left;
    const right = inputs.right;
    const operator = String(cfg.operator ?? "eq");
    let value = false;
    if (operator === "eq") value = left === right;
    else if (operator === "neq") value = left !== right;
    else if (operator === "gt") value = asNumber(left) > asNumber(right);
    else if (operator === "gte") value = asNumber(left) >= asNumber(right);
    else if (operator === "lt") value = asNumber(left) < asNumber(right);
    else if (operator === "lte") value = asNumber(left) <= asNumber(right);
    else if (operator === "exists") value = left !== null && left !== undefined;
    else if (operator === "not_exists") value = left === null || left === undefined;
    else if (operator === "contains") {
      value =
        typeof left === "string"
          ? left.includes(String(right ?? ""))
          : Array.isArray(left)
            ? left.includes(right)
            : false;
    }
    return { value };
  }

  if (type === "control.if") {
    return {
      true: Boolean(inputs.condition),
      false: !Boolean(inputs.condition),
    };
  }

  if (
    type ===
    "time.local_minutes"
  ) {
    const p =
      localTemporalParts(
        inputs.time,
        String(
          cfg.timezone ??
            "UTC",
        ),
      );

    return {
      value:
        p
          ? p.hour * 60 +
            p.minute +
            p.second / 60
          : 0,
    };
  }

  if (
    type ===
    "time.local_date"
  ) {
    const p =
      localTemporalParts(
        inputs.time,
        String(
          cfg.timezone ??
            "UTC",
        ),
      );

    return {
      value:
        p
          ? [
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
            ].join("-")
          : null,
    };
  }

  if (
    type ===
    "time.day_of_week"
  ) {
    const p =
      localTemporalParts(
        inputs.time,
        String(
          cfg.timezone ??
            "UTC",
        ),
      );

    const map:
      Record<
        string,
        number
      > = {
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
        Sun: 7,
      };

    return {
      value:
        p
          ? map[
              p.weekday
            ] ?? 0
          : 0,
    };
  }

  if (type === "time.difference_minutes") {
    const start = new Date(String(inputs.start ?? "")).getTime();
    const end = new Date(String(inputs.end ?? "")).getTime();
    return {
      value:
        Number.isFinite(start) && Number.isFinite(end)
          ? (end - start) / 60_000
          : 0,
    };
  }

  if (type === "time.add_minutes") {
    const time = new Date(String(inputs.time ?? "")).getTime();
    return {
      value: Number.isFinite(time)
        ? new Date(time + asNumber(inputs.minutes) * 60_000).toISOString()
        : null,
    };
  }

  if (type === "data.coalesce") {
    return { value: inputs.a ?? inputs.b };
  }

  if (type.startsWith("effect.")) {
    const kind = type.slice("effect.".length);
    const effect: PixelLogicEffect = {
      nodeId: node.id,
      kind,
      config: { ...cfg },
    };

    if (kind === "set_computed" || kind === "set_context") {
      effect.targetKey = String(cfg.targetKey ?? "");
      effect.value = inputs.value;
    } else if (kind === "change_state") {
      effect.targetKey = "process";
      effect.value = cfg.state;
    } else if (kind === "notify_actor") {
      effect.actorId = String(cfg.actorId ?? "");
      effect.value = cfg.message;
    } else if (kind === "trigger_action") {
      effect.targetKey = String(cfg.actionId ?? "");
    } else if (kind === "trigger_responsibility") {
      effect.targetKey = String(cfg.responsibilityKey ?? "");
    } else if (kind === "append_history") {
      effect.value = cfg.label;
    }

    effects.push(effect);
    return { flow: true };
  }

  const custom = CUSTOM_EXECUTORS.get(type);
  if (custom) return custom({ node, inputs, runtime });

  throw new Error(`No Pixel Logic executor registered for "${type}".`);
}

function eventMatches(node: PixelLogicNode, event: PixelLogicEvent) {
  if (node.type === "event.any") return true;
  if (node.type === "event.responsibility.action") {
    if (event.name !== "responsibility.action") return false;
    const actionId = String(node.config.actionId ?? "");
    return !actionId || actionId === event.actionId;
  }
  if (node.type === "event.record.created") return event.name === "record.created";
  if (node.type === "event.record.updated") return event.name === "record.updated";
  if (node.type === "event.schedule") return event.name === "schedule";
  return false;
}

/**
 * Deterministic graph evaluator.
 *
 * It intentionally EMITS effects rather than directly touching databases,
 * notifications, payroll, etc. The host decides which effects it is allowed
 * to apply. This makes Pixel Logic portable across CMS, server, Flutter, tests,
 * and future workers.
 */
export function runPixelLogic(
  program: PixelLogicProgram,
  runtime: PixelLogicRuntimeContext,
): PixelLogicRunResult {
  if (!program.enabled) return { matched: false, effects: [], trace: [] };

  const byId = new Map(program.nodes.map((node) => [node.id, node]));
  const incomingData = new Map<string, typeof program.edges>();
  const outgoingFlow = new Map<string, typeof program.edges>();

  for (const edge of program.edges) {
    if (edge.kind === "data") {
      const list = incomingData.get(edge.toNodeId) ?? [];
      list.push(edge);
      incomingData.set(edge.toNodeId, list);
    } else {
      const list = outgoingFlow.get(edge.fromNodeId) ?? [];
      list.push(edge);
      outgoingFlow.set(edge.fromNodeId, list);
    }
  }

  const effects: PixelLogicEffect[] = [];
  const trace: PixelLogicRunResult["trace"] = [];
  const cache = new Map<string, Record<string, unknown>>();
  const evaluating = new Set<string>();

  function evaluate(nodeId: string): Record<string, unknown> {
    const cached = cache.get(nodeId);
    if (cached) return cached;

    if (evaluating.has(nodeId)) {
      throw new Error(`Pixel Logic data cycle detected at node "${nodeId}".`);
    }

    const node = byId.get(nodeId);
    if (!node) throw new Error(`Pixel Logic node "${nodeId}" does not exist.`);

    evaluating.add(nodeId);
    const inputs: Record<string, unknown> = {};

    for (const edge of incomingData.get(nodeId) ?? []) {
      const source = evaluate(edge.fromNodeId);
      const value = source[edge.fromPort];
      if (Object.prototype.hasOwnProperty.call(inputs, edge.toPort)) {
        const existing = inputs[edge.toPort];
        inputs[edge.toPort] = Array.isArray(existing)
          ? [...existing, value]
          : [existing, value];
      } else {
        inputs[edge.toPort] = value;
      }
    }

    const outputs = executeCoreNode(node, inputs, runtime, effects);
    cache.set(nodeId, outputs);
    evaluating.delete(nodeId);
    trace.push({ nodeId: node.id, nodeType: node.type, outputs });
    return outputs;
  }

  const visitedFlow = new Set<string>();

  function walk(nodeId: string) {
    const node = byId.get(nodeId);
    if (!node) return;
    const outputs = evaluate(nodeId);

    for (const edge of outgoingFlow.get(nodeId) ?? []) {
      const flowKey = `${edge.id}:${nodeId}`;
      if (visitedFlow.has(flowKey)) continue;

      const shouldFollow =
        node.type === "control.if"
          ? outputs[edge.fromPort] === true
          : true;

      if (!shouldFollow) continue;
      visitedFlow.add(flowKey);
      walk(edge.toNodeId);
    }
  }

  const starts = program.nodes.filter(
    (node) => node.type.startsWith("event.") && eventMatches(node, runtime.event),
  );

  for (const start of starts) walk(start.id);

  return {
    matched: starts.length > 0,
    effects,
    trace,
  };
}
