// BRIXTA_PIXEL_LOGIC_KERNEL_V1
/**
 * BRIXTA Pixel Logic
 *
 * This is intentionally an OPEN graph format.
 * `PixelLogicNode.type` is a string so installing/registering a new capability
 * does not require changing a central business-logic enum.
 */

export type PixelLogicValueType =
  | "any"
  | "number"
  | "string"
  | "boolean"
  | "date"
  | "datetime"
  | "duration"
  | "money"
  | "location"
  | "object"
  | "array"
  | "record"
  | "reference"
  | "void";

export type PixelLogicPortKind = "data" | "flow";

export type PixelLogicPortSpec = {
  key: string;
  label: string;
  kind: PixelLogicPortKind;
  valueType?: PixelLogicValueType;
  required?: boolean;
  many?: boolean;
};

export type PixelLogicConfigField = {
  key: string;
  label: string;
  kind: "text" | "number" | "boolean" | "select";
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
};

export type PixelLogicNodeKind =
  | "event"
  | "value"
  | "operation"
  | "control"
  | "effect"
  | "integration"
  | "custom";

export type PixelLogicNodeSpec = {
  type: string;
  label: string;
  description: string;
  category: string;
  kind: PixelLogicNodeKind;
  inputs: PixelLogicPortSpec[];
  outputs: PixelLogicPortSpec[];
  configFields?: PixelLogicConfigField[];
};

export type PixelLogicExecutionPlacement =
  | "auto"
  | "device"
  | "server";

export type PixelLogicExecution = {
  placement: PixelLogicExecutionPlacement;
  rationale?: string;
};

export type PixelLogicNode = {
  id: string;
  type: string;
  label?: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  execution?: PixelLogicExecution;
};

export type PixelLogicEdge = {
  id: string;
  kind: PixelLogicPortKind;
  fromNodeId: string;
  fromPort: string;
  toNodeId: string;
  toPort: string;
};

export type PixelLogicVariable = {
  key: string;
  label: string;
  valueType: PixelLogicValueType;
  initialValue?: unknown;
};

export type PixelLogicProgram = {
  version: 1;
  enabled: boolean;
  name: string;
  nodes: PixelLogicNode[];
  edges: PixelLogicEdge[];
  variables: PixelLogicVariable[];
  metadata: {
    description?: string;
    generatedBy?: string;
    updatedAt?: string;
  };
};

export type PixelLogicEffect = {
  nodeId: string;
  kind: string;
  targetKey?: string;
  actorId?: string;
  value?: unknown;
  config: Record<string, unknown>;
};

export const PIXEL_LOGIC_METADATA_KEY = "pixelLogic";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function blankPixelLogicProgram(name = "Pixel Logic"): PixelLogicProgram {
  return {
    version: 1,
    enabled: true,
    name,
    nodes: [],
    edges: [],
    variables: [],
    metadata: {},
  };
}

export function normalizePixelLogicProgram(
  raw: unknown,
  fallbackName = "Pixel Logic",
): PixelLogicProgram {
  const value = asObject(raw);
  const nodes = Array.isArray(value.nodes)
    ? value.nodes
        .map((item) => {
          const node = asObject(item);
          const position = asObject(node.position);
          const id = typeof node.id === "string" ? node.id : "";
          const type = typeof node.type === "string" ? node.type : "";
          if (!id || !type) return null;
          return {
            id,
            type,
            label: typeof node.label === "string" ? node.label : undefined,
            position: {
              x: Number.isFinite(Number(position.x)) ? Number(position.x) : 0,
              y: Number.isFinite(Number(position.y)) ? Number(position.y) : 0,
            },
            config: asObject(node.config),

            execution: (() => {
              const rawExecution =
                asObject(
                  node.execution,
                );

              const placement =
                rawExecution.placement ===
                    "device" ||
                rawExecution.placement ===
                    "server"
                  ? rawExecution.placement
                  : "auto";

              return {
                placement,

                rationale:
                  typeof rawExecution.rationale ===
                  "string"
                    ? rawExecution.rationale
                    : undefined,
              };
            })(),
          } satisfies PixelLogicNode;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : [];

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(value.edges)
    ? value.edges
        .map((item) => {
          const edge = asObject(item);
          const id = typeof edge.id === "string" ? edge.id : "";
          const fromNodeId =
            typeof edge.fromNodeId === "string" ? edge.fromNodeId : "";
          const toNodeId =
            typeof edge.toNodeId === "string" ? edge.toNodeId : "";
          const fromPort = typeof edge.fromPort === "string" ? edge.fromPort : "";
          const toPort = typeof edge.toPort === "string" ? edge.toPort : "";
          const kind = edge.kind === "flow" ? "flow" : "data";
          if (
            !id ||
            !nodeIds.has(fromNodeId) ||
            !nodeIds.has(toNodeId) ||
            !fromPort ||
            !toPort
          ) {
            return null;
          }
          return {
            id,
            kind,
            fromNodeId,
            fromPort,
            toNodeId,
            toPort,
          } satisfies PixelLogicEdge;
        })
        .filter((item): item is PixelLogicEdge => Boolean(item))
    : [];

  const variables = Array.isArray(value.variables)
    ? value.variables
        .map((item) => {
          const variable = asObject(item);
          const key = typeof variable.key === "string" ? variable.key : "";
          if (!key) return null;
          return {
            key,
            label:
              typeof variable.label === "string" ? variable.label : key,
            valueType:
              typeof variable.valueType === "string"
                ? (variable.valueType as PixelLogicValueType)
                : "any",
            initialValue: variable.initialValue,
          } satisfies PixelLogicVariable;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : [];

  const metadata = asObject(value.metadata);

  return {
    version: 1,
    enabled: value.enabled !== false,
    name: typeof value.name === "string" && value.name.trim()
      ? value.name
      : fallbackName,
    nodes,
    edges,
    variables,
    metadata: {
      description:
        typeof metadata.description === "string"
          ? metadata.description
          : undefined,
      generatedBy:
        typeof metadata.generatedBy === "string"
          ? metadata.generatedBy
          : undefined,
      updatedAt:
        typeof metadata.updatedAt === "string"
          ? metadata.updatedAt
          : undefined,
    },
  };
}
