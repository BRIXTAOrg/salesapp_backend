/**
 * BRIXTA runtime primitive catalog.
 *
 * Keys are transport/runtime capabilities, never business-specific routes.
 * CMS can publish any composition of these primitives; Flutter decides how
 * to render them and the backend decides how to authorize/execute them.
 */
export const PLATFORM_PRIMITIVES = {
  version: "2026.08.2-kernel3",
  kernelVersion: 3,

  input: [
    { key: "text", dataType: "string" },
    { key: "short_text", dataType: "string" },
    { key: "textarea", dataType: "string" },
    { key: "long_text", dataType: "string" },
    { key: "number", dataType: "number" },
    { key: "integer", dataType: "integer" },
    { key: "currency", dataType: "number" },
    { key: "amount", dataType: "number" },
    { key: "date", dataType: "date" },
    { key: "datetime", dataType: "datetime" },
    { key: "select", dataType: "string" },
    { key: "choice", dataType: "string" },
    { key: "multi_select", dataType: "array" },
    { key: "toggle", dataType: "boolean" },
    { key: "checkbox", dataType: "boolean" },
    { key: "boolean", dataType: "boolean" },
    { key: "photo", dataType: "media" },
    { key: "video", dataType: "media" },
    { key: "file", dataType: "media" },
    { key: "signature", dataType: "media" },
    { key: "audio", dataType: "media" },
    { key: "location_point", dataType: "geo_point" },
    { key: "gps", dataType: "geo_point" },
    { key: "location_route", dataType: "array" },
    { key: "route", dataType: "array" },
    { key: "barcode", dataType: "string" },
    { key: "qr", dataType: "string" },
    { key: "nfc", dataType: "string" },
    { key: "person_reference", dataType: "object" },
    { key: "entity_reference", dataType: "object" },
    { key: "responsibility_reference", dataType: "object" },
    { key: "checklist", dataType: "array" },
    { key: "rating", dataType: "number" },
    { key: "timer", dataType: "object" },
    { key: "repeating_section", dataType: "array" },
  ],

  output: [
    { key: "detail" },
    { key: "card" },
    { key: "cards" },
    { key: "list" },
    { key: "table" },
    { key: "timeline" },
    { key: "calendar" },
    { key: "gallery" },
    { key: "map" },
    { key: "map_points" },
    { key: "route" },
    { key: "map_route" },
    { key: "metric" },
    { key: "chart" },
    { key: "document" },
    { key: "receipt" },
    { key: "dashboard" },
    { key: "notification" },
    { key: "snapshot" },
    { key: "node_graph" },
  ],

  kernelActions: [
    "create",
    "read",
    "update",
    "delete",
    "submit",
    "start",
    "stop",
    "pause",
    "resume",
    "approve",
    "reject",
    "return",
    "assign",
    "reassign",
    "delegate",
    "comment",
    "acknowledge",
    "sign",
    "notify",
    "trigger",
    "complete",
    "cancel",
  ],

  kernelEffects: [
    "change_state",
    "set_context",
    "remove_context",
    "create_record",
    "update_record",
    "delete_record",
    "assign_actor",
    "notify_actor",
    "query_data",
    "set_computed",
    "freeze_data",
    "trigger_action",
    "trigger_responsibility",
    "append_history",
  ],

  workflow: [
    { key: "action" },
    { key: "approval" },
  ],

  runtime: {
    publishedManifest: true,
    dataSources: true,
    entityMemory: true,
    deviceContext: true,
    offlineSyncRevision: true,
    workflowGate: true,
  },
} as const;

export type CrudOperation =
  | "create"
  | "read"
  | "update"
  | "delete";
