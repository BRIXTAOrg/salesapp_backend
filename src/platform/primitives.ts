/**
 * BRIXTA renderer / workflow primitive catalog.
 *
 * IMPORTANT: renderer keys are transport metadata, not business routes.
 * Adding a new UI renderer normally does not require a new CRUD endpoint.
 * The CMS + Flutter renderer implementations are versioned separately.
 */
export const PLATFORM_PRIMITIVES = {
  version: "2026.08.1",

  input: [
    { key: "text", dataType: "string" },
    { key: "textarea", dataType: "string" },
    { key: "number", dataType: "number" },
    { key: "integer", dataType: "integer" },
    { key: "currency", dataType: "number" },
    { key: "date", dataType: "date" },
    { key: "datetime", dataType: "datetime" },
    { key: "select", dataType: "string" },
    { key: "multi_select", dataType: "array" },
    { key: "toggle", dataType: "boolean" },
    { key: "checkbox", dataType: "boolean" },
    { key: "photo", dataType: "media" },
    { key: "file", dataType: "media" },
    { key: "signature", dataType: "media" },
    { key: "location_point", dataType: "geo_point" },
    { key: "location_route", dataType: "array" },
    { key: "barcode", dataType: "string" },
    { key: "qr", dataType: "string" },
    { key: "audio", dataType: "media" },
  ],

  output: [
    { key: "detail" },
    { key: "table" },
    { key: "cards" },
    { key: "metric" },
    { key: "snapshot" },
    { key: "map_points" },
    { key: "map_route" },
    { key: "gallery" },
    { key: "timeline" },
    { key: "node_graph" },
  ],

  workflow: [
    { key: "action" },
    { key: "approval" },
  ],
} as const;

export type CrudOperation =
  | "create"
  | "read"
  | "update"
  | "delete";
