// BRIXTA_COMPANY_ORG_UI_20261101
// BRIXTA_CRM_ACCESS_UX_V1_20261101
// BRIXTA_PJP_LOCAL_FIX_20261101
import type { Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { readFieldAppConfig, readFieldState } from "../platform/fieldApp";
import { authenticateToken, withTenantDb, type AuthRequest } from "../middleware/auth";
import { platformAuditEvents, platformMeta, entityRecords, entityTypes } from "../db/platformVNextSchema";
import { userIdFrom } from "./http";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const asObj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const keyFor = (userId: number, date: string) => `pjp:v1:${userId}:${date}`;

/** PJP stops are references, not copies. Enrich from authoritative CRM verification. */
async function planWithCurrentVerification(db: import("../db/db").AppDatabase, raw: unknown) {
  const plan = asObj(raw);
  const stops = Array.isArray(plan.stops) ? plan.stops.map(asObj) : [];
  const ids = stops.filter(stop => stop.type === "site" && /^site:[0-9a-f-]{36}$/i.test(String(stop.id ?? "")))
    .map(stop => String(stop.id).slice(5).toLowerCase());
  if (!ids.length) return plan;
  const records = await db.select({id:entityRecords.id,entityTypeId:entityRecords.entityTypeId,
    data:entityRecords.data}).from(entityRecords).where(inArray(entityRecords.id,ids));
  const byId = new Map(records.map(record => [record.id.toLowerCase(), record]));
  const types = await db.select({id:entityTypes.id,config:entityTypes.config,title:entityTypes.title}).from(entityTypes);
  const configs = new Map(types.map(type => [type.id,readFieldAppConfig(type.config,type.title)] as const));
  return {...plan,stops:stops.map(stop => {
    if (stop.type !== "site") return stop;
    const record = byId.get(String(stop.id).slice(5).toLowerCase());
    if (!record) return {...stop,verified:false,verifiedAt:null,verifiedBy:null};
    const field = readFieldState(record.data);
    const config = configs.get(record.entityTypeId);
    const section = config?.sections.find(section => /^(verify|verification)(_|$)/i.test(section.key) ||
      /^verify\b/i.test(section.title));
    const completion = section ? field.sections[section.key] : undefined;
    return {...stop,verified:Boolean(completion?.completedAt),verifiedAt:completion?.completedAt??null,
      verifiedBy:completion?.byName??null,crmStage:field.stage};
  })};
}

/** Read only the authenticated employee's published PJP. No peer access. */
export function registerPjpRoutes(app: Express) {
  // Company identity follows the authenticated employee; no public tenant enumeration.
  app.get("/api/salesApp/company/profile", authenticateToken, withTenantDb<AuthRequest>(async (req,res,db) => {
    const id = userIdFrom(req);
    if (!id) return res.status(401).json({success:false,error:"Unauthenticated."});
    const [row] = await db.select({value:platformMeta.value}).from(platformMeta)
      .where(eq(platformMeta.key,"company.profile.v1")).limit(1);
    const value=asObj(row?.value);
    res.setHeader("Cache-Control","private, no-store");
    return res.json({success:true,profile:{
      displayName:typeof value.displayName==="string"?value.displayName:"Your company",
      logoDataUrl:typeof value.logoDataUrl==="string"?value.logoDataUrl:null,
    }});
  }));
  app.get("/api/salesApp/pjp/today", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {
    const userId = userIdFrom(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthenticated." });
    const date = String(req.query.date ?? "");
    if (!DATE.test(date)) return res.status(400).json({ success: false, error: "Local date required: YYYY-MM-DD." });
    const [row] = await db.select().from(platformMeta).where(eq(platformMeta.key, keyFor(userId, date))).limit(1);
    res.setHeader("Cache-Control", "no-store");
    const rawPlan = asObj(row?.value);
    const policyKey = `field-access:v1:${userId}`;
    const [policyRow] = await db.select().from(platformMeta).where(eq(platformMeta.key,policyKey)).limit(1);
    const policy = asObj(policyRow?.value);
    const allowed = Array.isArray(policy.listIds) ? policy.listIds : null;
    const [moduleRow] = await db.select({config:entityTypes.config,title:entityTypes.title})
      .from(entityTypes).where(eq(entityTypes.id,Number(rawPlan.listId)||0)).limit(1);
    const isLinked=Boolean(moduleRow?.config?.fieldSource &&
      readFieldAppConfig(moduleRow.config,moduleRow.title));
    const moduleEmployees = moduleRow?.config?.fieldModuleAccess as {mode?:string;employeeIds?:number[]} | undefined;
    const linkedAllowed = Array.isArray(moduleEmployees?.employeeIds) && moduleEmployees.employeeIds.includes(userId);
    // BRIXTA_MAIN_EXPERIENCE_EMPLOYEE_ACCESS_V1_20261102: PJP must
    // respect an explicit selected-only Main roster as well as linked grants.
    const mainSelected = !isLinked && moduleEmployees?.mode === "selected";
    const mainAllowed = Array.isArray(moduleEmployees?.employeeIds) && moduleEmployees.employeeIds.includes(userId);
    const denied = isLinked ? !linkedAllowed : mainSelected ? !mainAllowed :
      allowed !== null && !allowed.includes(Number(rawPlan.listId));
    const plan = !denied && Number(rawPlan.revision ?? 0) > 0 && rawPlan.cancelled !== true
      ? await planWithCurrentVerification(db,rawPlan) : null;
    return res.json({ success: true, plan });
  }));

  /** Only explicit tasks can be completed here. CRM site verification stays in the Field flow. */
  app.post("/api/salesApp/pjp/task/complete", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {
    const userId = userIdFrom(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthenticated." });
    const date = String(req.body?.date ?? "");
    const stopId = String(req.body?.stopId ?? "");
    const expectedRevision = Number(req.body?.expectedRevision);
    if (!DATE.test(date) || !/^task:[0-9a-z_-]{8,80}$/i.test(stopId) || !Number.isSafeInteger(expectedRevision)) {
      return res.status(400).json({ success: false, error: "Invalid task completion request." });
    }
    const key = keyFor(userId, date);
    const [row] = await db.select().from(platformMeta).where(eq(platformMeta.key, key)).limit(1).for("update");
    const previous = asObj(row?.value);
    if (!row || previous.cancelled === true || Number(previous.revision ?? 0) !== expectedRevision)
      return res.status(409).json({ success: false, error: "Plan cancelled or changed; refresh before completing this task." });
    const stops = previous.stops;
    if (!Array.isArray(stops)) return res.status(409).json({ success: false, error: "Invalid published PJP." });
    const target = stops.map(asObj).find(s => s.id === stopId && s.type === "task");
    if (!target) return res.status(404).json({ success: false, error: "This task is not in your published PJP." });
    if (target.doneAt) return res.json({ success: true, plan: previous, alreadyCompleted: true });
    const at = new Date().toISOString();
    const next = {
      ...previous,
      revision: expectedRevision + 1,
      stops: stops.map(item => { const s = asObj(item); return s.id === stopId ? { ...s, doneAt: at, doneBy: userId } : s; }),
    };
    await db.update(platformMeta).set({ value: next, updatedAt: new Date() }).where(eq(platformMeta.key, key));
    await db.insert(platformAuditEvents).values({
      actorUserId: userId, eventType: "pjp.task_completed", subjectType: "pjp", subjectId: key,
      payload: { stopId, at, revision: next.revision, previousRevision: expectedRevision, title: String(target.title ?? "Task") },
    });
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, plan: next });
  }));
}
