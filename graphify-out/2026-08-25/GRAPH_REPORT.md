# Graph Report - salesapp_backend  (2026-08-25)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 271 nodes · 629 edges · 12 communities (11 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d228cd06`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- workflowEngine.ts
- package.json
- applianceSchema.ts
- recordEngine.ts
- applianceEmployees.ts
- responsibility.ts
- schema.ts
- dependencies
- compilerOptions
- start.sh

## God Nodes (most connected - your core abstractions)
1. `AppDatabase` - 13 edges
2. `setupMobilePlatformRoutes()` - 13 edges
3. `createRecord()` - 12 edges
4. `compilerOptions` - 12 edges
5. `updateRecord()` - 11 edges
6. `getResolvedCapabilitiesForUser()` - 11 edges
7. `resolveAssignedResponsibility()` - 10 edges
8. `responsibilityActionKey()` - 10 edges
9. `withAdminTenantDb()` - 10 edges
10. `ensureResponsibilityActions()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `setupMobileBootstrapRoutes()` --indirect_call--> `authenticateToken()`  [INFERRED]
  src/auth/bootstrap.ts → src/middleware/auth.ts
- `setupMobilePlatformRoutes()` --indirect_call--> `authenticateToken()`  [INFERRED]
  src/mobile/platform.ts → src/middleware/auth.ts
- `registerRuntimeAdminRoutes()` --calls--> `userCanApprovePolicy()`  [EXTRACTED]
  src/admin/applianceRuntime.ts → src/services/approvalPolicyResolver.ts
- `getWorkflowBootstrapForUser()` --calls--> `userCanApprovePolicy()`  [EXTRACTED]
  src/services/workflowBootstrap.ts → src/services/approvalPolicyResolver.ts
- `decideWorkflowApproval()` --calls--> `userCanApprovePolicy()`  [EXTRACTED]
  src/services/workflowEngine.ts → src/services/approvalPolicyResolver.ts

## Import Cycles
- None detected.

## Communities (12 total, 1 thin omitted)

### Community 0 - "workflowEngine.ts"
Cohesion: 0.12
Nodes (37): CreateVersionInput, CRUD_OPERATIONS, approvalRequests, AppDatabase, combinedSchema, globalForDb, mobileCapabilities, roles (+29 more)

### Community 1 - "package.json"
Cohesion: 0.06
Nodes (32): cross-env, drizzle-kit, author, description, devDependencies, cross-env, drizzle-kit, @types/cors (+24 more)

### Community 2 - "applianceSchema.ts"
Cohesion: 0.10
Nodes (26): getJwtSecret(), isMobileJwtPayload(), MobileJwtPayload, signMobileToken(), verifyMobileToken(), LoginOutcome, setupAuthRoutes(), UserRow (+18 more)

### Community 3 - "recordEngine.ts"
Cohesion: 0.19
Nodes (27): sendResult(), setupMobilePlatformRoutes(), userIdFrom(), appActionVisibilityAllowed(), createRecord(), crudDisabled(), deleteRecord(), emptyAppValue() (+19 more)

### Community 4 - "applianceEmployees.ts"
Cohesion: 0.15
Nodes (22): setupApplianceAdminRoutes(), normalizeIds(), registerEmployeeAdminRoutes(), validateResponsibilityIds(), validateRoleIds(), normalizeKey(), objectValue(), registerResponsibilityAdminRoutes() (+14 more)

### Community 5 - "responsibility.ts"
Cohesion: 0.14
Nodes (23): app, parsedPort, setupMobileBootstrapRoutes(), withTenantDb(), CrudOperation, PLATFORM_PRIMITIVES, IMPORTANT: renderer keys are transport metadata, not business routes., ensureResponsibilityActions() (+15 more)

### Community 6 - "schema.ts"
Cohesion: 0.09
Nodes (25): capabilityAssignmentRules, dailyVisitReports, dealers, distributors, geoTracking, influencers, institutions, journeyBreadcrumbs (+17 more)

### Community 7 - "dependencies"
Cohesion: 0.08
Nodes (25): bcryptjs, cors, dotenv, drizzle-orm, drizzle-zod, express, jsonwebtoken, multer (+17 more)

### Community 8 - "compilerOptions"
Cohesion: 0.10
Nodes (20): dist, drizzle.config.ts, index.ts, node, node_modules, src/**/*.ts, compilerOptions, allowSyntheticDefaultImports (+12 more)

## Knowledge Gaps
- **98 isolated node(s):** `CreateVersionInput`, `ActionAuthorization`, `PolicyResolution`, `ActionBinding`, `ExistingActionState` (+93 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `AppDatabase` connect `workflowEngine.ts` to `applianceSchema.ts`, `recordEngine.ts`, `applianceEmployees.ts`, `responsibility.ts`, `schema.ts`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **What connects `CreateVersionInput`, `ActionAuthorization`, `PolicyResolution` to the rest of the system?**
  _98 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `workflowEngine.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11616161616161616 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06060606060606061 - nodes in this community are weakly interconnected._
- **Should `applianceSchema.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1010752688172043 - nodes in this community are weakly interconnected._
- **Should `responsibility.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1396011396011396 - nodes in this community are weakly interconnected._