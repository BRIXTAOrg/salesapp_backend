/*
 * BRIXTA_FIELD_APP_V1 → V2
 *
 * A list (entity type) becomes field work when the CMS publishes
 * entity_types.config.fieldApp = { enabled: true, ... }.
 *
 * Everything about field-app configs, answers and stages now lives in
 * ./fieldAppContract.ts, which is byte-identical to the CMS copy
 * (salesman_cms/src/lib/field-app-contract.ts). This file only re-exports
 * it so existing imports keep working.
 */

export * from "./fieldAppContract";
