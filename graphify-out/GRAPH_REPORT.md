# Graph Report - salesapp_backend  (2026-08-25)

## Corpus Check
- 59 files · ~74,889 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 390 nodes · 1049 edges · 15 communities (13 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d228cd06`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- bootstrap.ts
- schema.ts
- runtimeEngine.ts
- workflowEngine.ts
- package.json
- dataSourceRuntime.ts
- dependencies
- compilerOptions
- README.md
- runtimeManifest.ts
- recordEngine.ts
- index.ts
- start.sh

## God Nodes (most connected - your core abstractions)
1. `AppDatabase` - 22 edges
2. `authenticateToken()` - 18 edges
3. `queryRuntimeDataSource()` - 17 edges
4. `getResolvedCapabilitiesForUser()` - 17 edges
5. `registerRuntimeRoutes()` - 16 edges
6. `executeKernelAction()` - 16 edges
7. `withTenantDb()` - 14 edges
8. `setupMobileBootstrapRoutes()` - 13 edges
9. `users` - 13 edges
10. `mobileCapabilities` - 13 edges

## Surprising Connections (you probably didn't know these)
- `setupUploadRoutes()` --indirect_call--> `authenticateToken()`  [INFERRED]
  src/photoUpload/upload.ts → src/middleware/auth.ts
- `setupApplianceAdminRoutes()` --calls--> `registerRuntimeAdminRoutes()`  [EXTRACTED]
  src/admin/appliance.ts → src/admin/applianceRuntime.ts
- `setupApplianceAdminRoutes()` --indirect_call--> `requireAdminService()`  [INFERRED]
  src/admin/appliance.ts → src/middleware/adminService.ts
- `registerResponsibilityAdminRoutes()` --calls--> `ensureResponsibilityActions()`  [EXTRACTED]
  src/admin/applianceResponsibilities.ts → src/platform/responsibility.ts
- `registerResponsibilityAdminRoutes()` --calls--> `normalizeResponsibilityConfig()`  [EXTRACTED]
  src/admin/applianceResponsibilities.ts → src/platform/responsibility.ts

## Import Cycles
- None detected.

## Communities (15 total, 2 thin omitted)

### Community 0 - "bootstrap.ts"
Cohesion: 0.19
Nodes (29): setupMobileBootstrapRoutes(), employeeRuntimeState, withTenantSchema(), entityFieldMemory, authenticateToken(), AuthRequest, AuthUserPayload, withTenantDb() (+21 more)

### Community 1 - "schema.ts"
Cohesion: 0.07
Nodes (46): setupApplianceAdminRoutes(), normalizeIds(), registerEmployeeAdminRoutes(), validateResponsibilityIds(), validateRoleIds(), normalizeKey(), objectValue(), registerResponsibilityAdminRoutes() (+38 more)

### Community 2 - "runtimeEngine.ts"
Cohesion: 0.08
Nodes (48): actorCanAct(), conditionResult(), evaluateConditionGroup(), numeric(), objectValue(), readPath(), referenceUserId(), resolveActorResolver() (+40 more)

### Community 3 - "workflowEngine.ts"
Cohesion: 0.08
Nodes (49): objectValue(), registerRuntimeAdminRoutes(), adminOwnershipRules, applianceAuditLog, approvalRequests, attentionItems, capabilityAssignmentRules, deviceRegistrations (+41 more)

### Community 4 - "package.json"
Cohesion: 0.06
Nodes (32): cross-env, drizzle-kit, author, description, devDependencies, cross-env, drizzle-kit, @types/cors (+24 more)

### Community 5 - "dataSourceRuntime.ts"
Cohesion: 0.14
Nodes (24): compiledResponsibilityManifests, dataSources, EntityFieldDefinition, entityRecords, entityTypes, platformAuditEvents, recordLinks, responsibilityExtensions (+16 more)

### Community 6 - "dependencies"
Cohesion: 0.08
Nodes (25): bcryptjs, cors, dotenv, drizzle-orm, drizzle-zod, express, jsonwebtoken, multer (+17 more)

### Community 7 - "compilerOptions"
Cohesion: 0.10
Nodes (20): dist, drizzle.config.ts, index.ts, node, node_modules, src/**/*.ts, compilerOptions, allowSyntheticDefaultImports (+12 more)

### Community 9 - "runtimeManifest.ts"
Cohesion: 0.30
Nodes (12): sourceAllowed(), extractResponsibilityKernel(), looksLikeKernel(), objectValue(), computeWorkspaceRevision(), getPublishedRuntimeManifest(), getPublishedRuntimeManifests(), manifestReferencesDataSource() (+4 more)

### Community 10 - "recordEngine.ts"
Cohesion: 0.12
Nodes (38): CrudOperation, PLATFORM_PRIMITIVES, appActionVisibilityAllowed(), createRecord(), crudDisabled(), deleteRecord(), emptyAppValue(), enforceAppAction() (+30 more)

### Community 11 - "index.ts"
Cohesion: 0.16
Nodes (15): app, parsedPort, getJwtSecret(), isMobileJwtPayload(), MobileJwtPayload, signMobileToken(), verifyMobileToken(), LoginOutcome (+7 more)

## Knowledge Gaps
- **119 isolated node(s):** `app`, `parsedPort`, `name`, `version`, `description` (+114 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppDatabase` connect `workflowEngine.ts` to `bootstrap.ts`, `schema.ts`, `runtimeEngine.ts`, `dataSourceRuntime.ts`, `runtimeManifest.ts`, `recordEngine.ts`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `getResolvedCapabilitiesForUser()` connect `schema.ts` to `bootstrap.ts`, `runtimeEngine.ts`, `workflowEngine.ts`, `runtimeManifest.ts`, `recordEngine.ts`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `authenticateToken()` (e.g. with `setupMobileBootstrapRoutes()` and `registerDataRoutes()`) actually correct?**
  _`authenticateToken()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `app`, `parsedPort`, `name` to the rest of the system?**
  _119 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `schema.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07477288609364081 - nodes in this community are weakly interconnected._
- **Should `runtimeEngine.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0815686274509804 - nodes in this community are weakly interconnected._