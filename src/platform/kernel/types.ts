export type KernelId = string;

export type KernelValueRef =
  | { kind: "literal"; value: unknown }
  | { kind: "context"; key: string; path?: string }
  | { kind: "state"; key: string }
  | { kind: "object"; key: string; path?: string }
  | { kind: "actor"; key: string; path?: string }
  | { kind: "capture"; key: string; path?: string }
  | { kind: "query"; key: string; path?: string }
  | { kind: "history"; key: string; path?: string }
  | { kind: "computed"; key: string; path?: string };

export type KernelOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "exists"
  | "not_exists"
  | "contains"
  | "in"
  | "between";

export type KernelCondition = {
  id: KernelId;
  left: KernelValueRef;
  operator: KernelOperator;
  right?: KernelValueRef;
};

export type KernelConditionGroup = {
  mode: "all" | "any";
  conditions: KernelCondition[];
};

export type KernelActorResolver =
  | { kind: "current_user" }
  | { kind: "record_creator" }
  | { kind: "specific_user"; userId?: number }
  | { kind: "role"; roleId?: number }
  | { kind: "manager_of"; value: KernelValueRef }
  | { kind: "selected_reference"; referenceKey: string }
  | { kind: "query_result"; queryKey: string; path?: string }
  | { kind: "relationship"; source: KernelValueRef; relation: string }
  | { kind: "system" };

export type KernelActor = {
  id: KernelId;
  label: string;
  resolver: KernelActorResolver;
  description?: string;
};

export type KernelObject = {
  id: KernelId;
  label: string;
  kind:
    | "current_record"
    | "entity"
    | "responsibility_record"
    | "employee"
    | "device"
    | "session"
    | "external";
  sourceKey?: string;
  description?: string;
};

export type KernelContext = {
  id: KernelId;
  label: string;
  source:
    | "current_user"
    | "current_manager"
    | "current_device"
    | "organization"
    | "current_time"
    | "current_location"
    | "record"
    | "relationship"
    | "history"
    | "session"
    | "query"
    | "object"
    | "external";
  sourceKey?: string;
  path?: string;
  mutable: boolean;
  frozenAfterState?: string;
};

export type KernelState = {
  id: KernelId;
  label: string;
  dimension: string;
  initial?: boolean;
  terminal?: boolean;
  description?: string;
};

export type KernelCapture = {
  id: KernelId;
  label: string;
  kind: string;
  required?: boolean;
  sourceKey?: string;
  storeAs?: string;
  config: Record<string, unknown>;
};

export type KernelAction = {
  id: KernelId;
  label: string;
  kind: string;
  actorId?: string;
  objectId?: string;
  requires?: KernelConditionGroup;
  captureIds: string[];
  config: Record<string, unknown>;
};

export type KernelOutput = {
  id: KernelId;
  label: string;
  kind: string;
  actorIds: string[];
  stateIds: string[];
  visibleKeys: string[];
  config: Record<string, unknown>;
};

export type KernelPossibility =
  | {
      id: KernelId;
      type: "capture";
      capture: KernelCapture;
      when?: KernelConditionGroup;
    }
  | {
      id: KernelId;
      type: "action";
      action: KernelAction;
      when?: KernelConditionGroup;
    }
  | {
      id: KernelId;
      type: "output";
      output: KernelOutput;
      when?: KernelConditionGroup;
    };

export type KernelEvent = {
  id: KernelId;
  label: string;
  kind: string;
  actionId?: string;
  sourceKey?: string;
};

export type KernelEffect = {
  id: KernelId;
  kind: string;
  targetKey?: string;
  value?: KernelValueRef;
  actorId?: string;
  config: Record<string, unknown>;
};

export type KernelRule = {
  id: KernelId;
  label: string;
  eventId?: string;
  when: KernelConditionGroup;
  effects: KernelEffect[];
  priority: number;
  enabled: boolean;
};

export type ResponsibilityKernel = {
  kernelVersion: number;
  runtimeWorld: {
    actors: KernelActor[];
    objects: KernelObject[];
    contexts: KernelContext[];
    states: KernelState[];
  };
  possibilities: KernelPossibility[];
  events: KernelEvent[];
  rules: KernelRule[];
  metadata: Record<string, unknown>;
};

export type KernelDeviceContext = {
  deviceId?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  online?: boolean;
  metadata?: Record<string, unknown>;
};

export type KernelRuntimeWorld = {
  actorUserId: number;
  subjectUserId: number;
  responsibilityId: number;
  responsibilityKey: string;
  recordId: string | null;
  state: Record<string, string>;
  captures: Record<string, unknown>;
  context: Record<string, unknown>;
  objects: Record<string, unknown>;
  actors: Record<string, unknown>;
  queries: Record<string, unknown>;
  computed: Record<string, unknown>;
  history: unknown[];
  device: KernelDeviceContext;
  now: string;
};
