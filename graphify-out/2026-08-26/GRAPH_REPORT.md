# Graph Report - salesapp_backend  (2026-08-26)

## Corpus Check
- 64 files · ~81,199 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 431 nodes · 1110 edges · 19 communities (17 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `da7638e7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- src/platform/recordEngine.ts
- schema.ts
- runtimeEngine.ts
- workflowEngine.ts
- package.json
- dataSourceRuntime.ts
- dependencies
- compilerOptions
- README.md
- semantic-runtime-v2-20260826-033804/src/platform/recordEngine.ts
- responsibility.ts
- src/admin/applianceWorkflows.ts
- inline-human-review-20260826-040158/src/admin/applianceWorkflows.ts
- start.sh
- upload.ts
- archived-responsibilities-20260826-004719/src/admin/applianceResponsibilities.ts
- responsibility-delete-20260826-003442/src/admin/applianceResponsibilities.ts

## God Nodes (most connected - your core abstractions)
1. `AppDatabase` - 23 edges
2. `authenticateToken()` - 19 edges
3. `queryRuntimeDataSource()` - 17 edges
4. `getResolvedCapabilitiesForUser()` - 17 edges
5. `registerRuntimeRoutes()` - 16 edges
6. `executeKernelAction()` - 16 edges
7. `withTenantDb()` - 14 edges
8. `users` - 13 edges
9. `mobileCapabilities` - 13 edges
10. `registerDataRoutes()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `setupMobileBootstrapRoutes()` --indirect_call--> `authenticateToken()`  [INFERRED]
  .brixta-backups/cms-sovereignty-20260825-231628/src/auth/bootstrap.ts → src/middleware/auth.ts
- `setupMobileBootstrapRoutes()` --indirect_call--> `authenticateToken()`  [INFERRED]
  src/auth/bootstrap.ts → src/middleware/auth.ts
- `registerRuntimeRoutes()` --indirect_call--> `authenticateToken()`  [INFERRED]
  src/mobile/runtimeRoutes.ts → src/middleware/auth.ts
- `setupUploadRoutes()` --indirect_call--> `authenticateToken()`  [INFERRED]
  src/photoUpload/upload.ts → src/middleware/auth.ts
- `setupApplianceAdminRoutes()` --calls--> `registerEmployeeAdminRoutes()`  [EXTRACTED]
  src/admin/appliance.ts → src/admin/applianceEmployees.ts

## Import Cycles
- None detected.

## Communities (19 total, 2 thin omitted)

### Community 0 - "src/platform/recordEngine.ts"
Cohesion: 0.12
Nodes (44): setupMobileBootstrapRoutes(), authenticateToken(), AuthRequest, AuthUserPayload, withTenantDb(), registerDataRoutes(), registerDeviceRoutes(), parseFilters() (+36 more)

### Community 1 - "schema.ts"
Cohesion: 0.07
Nodes (40): normalizeIds(), registerEmployeeAdminRoutes(), validateResponsibilityIds(), validateRoleIds(), adminOwnershipRules, applianceAuditLog, attentionItems, capabilityAssignmentRules (+32 more)

### Community 2 - "runtimeEngine.ts"
Cohesion: 0.06
Nodes (63): workItems, sourceAllowed(), registerRuntimeRoutes(), actorCanAct(), conditionResult(), evaluateConditionGroup(), numeric(), objectValue() (+55 more)

### Community 3 - "workflowEngine.ts"
Cohesion: 0.13
Nodes (34): objectValue(), registerRuntimeAdminRoutes(), approvalRequests, AppDatabase, users, actionDefinitions, approvalPolicies, approvalPolicyActors (+26 more)

### Community 4 - "package.json"
Cohesion: 0.06
Nodes (32): cross-env, drizzle-kit, author, description, devDependencies, cross-env, drizzle-kit, @types/cors (+24 more)

### Community 5 - "dataSourceRuntime.ts"
Cohesion: 0.12
Nodes (28): compiledResponsibilityManifests, dataSources, EntityFieldDefinition, entityFieldMemory, entityRecords, entityTypes, platformAuditEvents, recordLinks (+20 more)

### Community 6 - "dependencies"
Cohesion: 0.08
Nodes (25): bcryptjs, cors, dotenv, drizzle-orm, drizzle-zod, express, jsonwebtoken, multer (+17 more)

### Community 7 - "compilerOptions"
Cohesion: 0.10
Nodes (20): dist, drizzle.config.ts, index.ts, node, node_modules, src/**/*.ts, compilerOptions, allowSyntheticDefaultImports (+12 more)

### Community 9 - "semantic-runtime-v2-20260826-033804/src/platform/recordEngine.ts"
Cohesion: 0.21
Nodes (19): appActionVisibilityAllowed(), createRecord(), crudDisabled(), deleteRecord(), emptyAppValue(), enforceAppAction(), getOwnRecord(), latestResponsibilityRecord() (+11 more)

### Community 10 - "responsibility.ts"
Cohesion: 0.19
Nodes (19): buildWorkspace(), setupMobileBootstrapRoutes(), workspaceRevision(), ensureResponsibilityActions(), inferDataType(), normalizeField(), normalizeResponsibilityConfig(), objectValue() (+11 more)

### Community 11 - "src/admin/applianceWorkflows.ts"
Cohesion: 0.10
Nodes (33): app, parsedPort, setupApplianceAdminRoutes(), normalizeKey(), objectValue(), registerResponsibilityAdminRoutes(), createPublishedVersion(), CreateVersionInput (+25 more)

### Community 12 - "inline-human-review-20260826-040158/src/admin/applianceWorkflows.ts"
Cohesion: 0.43
Nodes (7): createPublishedVersion(), CreateVersionInput, CRUD_OPERATIONS, normalizeKey(), numberArray(), objectValue(), registerWorkflowAdminRoutes()

### Community 16 - "upload.ts"
Cohesion: 0.70
Nodes (4): safeExtension(), setupUploadRoutes(), storageClient(), upload

### Community 17 - "archived-responsibilities-20260826-004719/src/admin/applianceResponsibilities.ts"
Cohesion: 0.83
Nodes (3): normalizeKey(), objectValue(), registerResponsibilityAdminRoutes()

### Community 18 - "responsibility-delete-20260826-003442/src/admin/applianceResponsibilities.ts"
Cohesion: 0.83
Nodes (3): normalizeKey(), objectValue(), registerResponsibilityAdminRoutes()

## Knowledge Gaps
- **125 isolated node(s):** `CRUD_OPERATIONS`, `CreateVersionInput`, `RecordEngineError`, `RecordEngineSuccess`, `RecordEngineResult` (+120 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppDatabase` connect `workflowEngine.ts` to `src/platform/recordEngine.ts`, `schema.ts`, `runtimeEngine.ts`, `dataSourceRuntime.ts`, `responsibility.ts`, `src/admin/applianceWorkflows.ts`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `authenticateToken()` connect `src/platform/recordEngine.ts` to `runtimeEngine.ts`, `upload.ts`, `responsibility.ts`, `src/admin/applianceWorkflows.ts`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `getResolvedCapabilitiesForUser()` connect `schema.ts` to `src/platform/recordEngine.ts`, `workflowEngine.ts`, `responsibility.ts`, `runtimeEngine.ts`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `authenticateToken()` (e.g. with `setupMobileBootstrapRoutes()` and `setupMobileBootstrapRoutes()`) actually correct?**
  _`authenticateToken()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **What connects `CRUD_OPERATIONS`, `CreateVersionInput`, `RecordEngineError` to the rest of the system?**
  _125 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `src/platform/recordEngine.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11949685534591195 - nodes in this community are weakly interconnected._
- **Should `schema.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06765327695560254 - nodes in this community are weakly interconnected._