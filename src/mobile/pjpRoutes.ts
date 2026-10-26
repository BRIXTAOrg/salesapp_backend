import type { Express } from "express";
import { eq } from "drizzle-orm";
import { authenticateToken, withTenantDb, type AuthRequest } from "../middleware/auth";
import { platformAuditEvents, platformMeta } from "../db/platformVNextSchema";
import { userIdFrom } from "./http";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const asObj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const keyFor = (userId: number, date: string) => `pjp:v1:${userId}:${date}`;

/** Read only the authenticated employee's published PJP. No peer access. */
export function registerPjpRoutes(app: Express) {
  app.get("/api/salesApp/pjp/today", authenticateToken, withTenantDb<AuthRequest>(async (req, res, db) => {
    const userId = userIdFrom(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthenticated." });
    const date = String(req.query.date ?? "");
    if (!DATE.test(date)) return res.status(400).json({ success: false, error: "Local date required: YYYY-MM-DD." });
    const [row] = await db.select().from(platformMeta).where(eq(platformMeta.key, keyFor(userId, date))).limit(1);
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, plan: Number(asObj(row?.value).revision ?? 0) > 0 ? row?.value : null });
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
    if (!row || Number(previous.revision ?? 0) !== expectedRevision) return res.status(409).json({ success: false, error: "Plan changed; refresh before completing this task." });
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
