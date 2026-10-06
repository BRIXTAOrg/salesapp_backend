import type {
  Express,
  Response,
} from "express";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../db/db";

import {
  users,
} from "../db/schema";

import {
  entityRecords,
  entityTypes,
  platformAuditEvents,
  type EntityFieldDefinition,
} from "../db/platformVNextSchema";

import {
  authenticateToken,
  withTenantDb,
  type AuthRequest,
} from "../middleware/auth";

import {
  FIELD_APP_CONTRACT_VERSION,
  answerText,
  cleanSectionValues,
  displayValue,
  distanceMeters,
  nextStage,
  pointFrom,
  readFieldAppConfig,
  readFieldState,
  stageOf,
  type FieldAppConfig,
  type FieldState,
} from "../platform/fieldApp";

import {
  userIdFrom,
} from "./http";

/*
 * BRIXTA_FIELD_APP_V1 — field work on imported lists.
 * BRIXTA_FIELD_APP_CONTRACT_V2 — conditions, calculated values and the
 * new input types come from ../platform/fieldAppContract.ts.
 *
 *   GET  /api/salesApp/field/lists
 *   GET  /api/salesApp/field/lists/:key/records?lat&lng&lens&q&limit
 *   GET  /api/salesApp/field/records/:id
 *   POST /api/salesApp/field/records/:id/sections/:section
 */

type Lens = "mine" | "todo" | "active" | "followups" | "closed" | "all";

const LENSES: Lens[] = ["mine", "todo", "active", "followups", "closed", "all"];
const TODO_STAGES = new Set(["new", "visited"]);
const MAX_LIST_ROWS = 20_000;
const MUTATION_ID = /^[A-Za-z0-9_-]{8,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FieldUser = {
  id: number;
  name: string;
};

function fail(res: Response, status: number, error: string, code?: string, details?: unknown) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({ success: false, error, code, details });
}

function ok(res: Response, body: Record<string, unknown>, status = 200) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({ success: true, ...body });
}

async function fieldUser(db: AppDatabase, userId: number): Promise<FieldUser | null> {
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      status: users.status,
      isSalesAppUser: users.isSalesAppUser,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.status !== "active" || !user.isSalesAppUser) return null;
  return {
    id: user.id,
    name: user.displayName ?? user.username ?? `Employee ${user.id}`,
  };
}

async function fieldLists(db: AppDatabase) {
  const rows = await db
    .select()
    .from(entityTypes)
    .where(eq(entityTypes.isActive, true))
    .orderBy(asc(entityTypes.title));

  const lists: Array<{ row: (typeof rows)[number]; config: FieldAppConfig }> = [];
  for (const row of rows) {
    const config = readFieldAppConfig(row.config, row.title);
    if (config) lists.push({ row, config });
  }
  return lists;
}

function lensOf(config: FieldAppConfig, state: FieldState): Exclude<Lens, "all" | "mine" | "followups"> {
  const stage = stageOf(config, state.stage);
  if (stage.closed) return "closed";
  if (TODO_STAGES.has(stage.key)) return "todo";
  return "active";
}

function isFollowUp(config: FieldAppConfig, state: FieldState) {
  const stage = stageOf(config, state.stage);
  return !stage.closed && (stage.key === "follow_up" || Boolean(state.followUpAt));
}

function titleOf(config: FieldAppConfig, data: Record<string, unknown>, externalKey: string | null) {
  const fromField = config.titleField ? displayValue(data[config.titleField]) : "";
  return fromField || externalKey || "Untitled";
}

function subtitleOf(config: FieldAppConfig, data: Record<string, unknown>) {
  return config.subtitleFields
    .map((field) => displayValue(data[field]))
    .filter(Boolean)
    .map((value) => value.slice(0, 80));
}

function priorityOf(config: FieldAppConfig, data: Record<string, unknown>) {
  if (!config.priorityField) return null;
  const value = Number(data[config.priorityField]);
  return Number.isFinite(value) ? value : null;
}

function stagePayload(config: FieldAppConfig, state: FieldState) {
  const stage = stageOf(config, state.stage);
  return {
    stage: stage.key,
    stageLabel: stage.label,
    stageTone: stage.tone,
    closed: stage.closed,
  };
}

function summaryOf(
  config: FieldAppConfig,
  row: { id: string; externalKey: string | null; updatedAt: Date | string | null; data: Record<string, unknown> },
  origin: { lat: number; lng: number } | null,
  viewerId: number | null = null,
) {
  const state = readFieldState(row.data);
  const location = config.locationField ? pointFrom(row.data[config.locationField]) : null;
  return {
    id: row.id,
    key: row.externalKey,
    title: titleOf(config, row.data, row.externalKey),
    subtitle: subtitleOf(config, row.data),
    priority: priorityOf(config, row.data),
    location,
    distanceM: origin && location ? Math.round(distanceMeters(origin, location)) : null,
    ...stagePayload(config, state),
    followUpAt: state.followUpAt,
    lastVisitAt: state.lastVisitAt,
    lastVisitBy: state.lastVisitBy,
    assigneeName: state.assignee?.name ?? null,
    assignedToMe: viewerId !== null && state.assignee?.userId === viewerId,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

function originFrom(query: Record<string, unknown>) {
  const lat = Number(query.lat);
  const lng = Number(query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

async function loadRecord(db: AppDatabase, id: string, forUpdate = false) {
  if (!UUID.test(id)) return null;
  const query = db
    .select()
    .from(entityRecords)
    .where(eq(entityRecords.id, id))
    .limit(1);
  const [record] = forUpdate ? await query.for("update") : await query;
  if (!record || record.status !== "active") return null;

  const [type] = await db
    .select()
    .from(entityTypes)
    .where(eq(entityTypes.id, record.entityTypeId))
    .limit(1);
  if (!type || !type.isActive) return null;

  const config = readFieldAppConfig(type.config, type.title);
  if (!config) return null;

  return { record, type, config };
}

function sectionFieldKeys(config: FieldAppConfig) {
  return new Set(config.sections.flatMap((section) => section.fields.map((field) => field.key)));
}

function recordDetail(
  config: FieldAppConfig,
  type: { fieldDefinitions: EntityFieldDefinition[] | null },
  record: { id: string; externalKey: string | null; updatedAt: Date | string | null; data: Record<string, unknown> },
  viewerId: number | null = null,
) {
  const data = (record.data ?? {}) as Record<string, unknown>;
  const state = readFieldState(data);
  const inSections = sectionFieldKeys(config);

  const info = (type.fieldDefinitions ?? [])
    .filter(
      (field) =>
        !inSections.has(field.key) &&
        field.key !== config.locationField &&
        !field.key.startsWith("__"),
    )
    .map((field) => ({ key: field.key, label: field.label, value: displayValue(data[field.key]) }))
    .filter((item) => item.value !== "")
    .slice(0, 40);

  const values: Record<string, unknown> = {};
  for (const key of inSections) {
    if (data[key] !== undefined && data[key] !== null) values[key] = data[key];
  }

  return {
    ...summaryOf(config, { ...record, data }, null, viewerId),
    sections: state.sections,
    values,
    info,
  };
}

async function timelineFor(
  db: AppDatabase,
  recordId: string,
  data: Record<string, unknown>,
) {
  const events = await db
    .select({
      id: platformAuditEvents.id,
      eventType: platformAuditEvents.eventType,
      payload: platformAuditEvents.payload,
      createdAt: platformAuditEvents.createdAt,
      actorUserId: platformAuditEvents.actorUserId,
    })
    .from(platformAuditEvents)
    .where(
      and(
        eq(platformAuditEvents.subjectType, "entity_record"),
        eq(platformAuditEvents.subjectId, recordId),
      ),
    )
    .orderBy(desc(platformAuditEvents.createdAt))
    .limit(100);

  const actorIds = [...new Set(events.map((event) => event.actorUserId).filter((id): id is number => id !== null))];
  const actors = actorIds.length
    ? await db
        .select({ id: users.id, username: users.username, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, actorIds))
    : [];
  const nameOf = new Map(actors.map((actor) => [actor.id, actor.displayName ?? actor.username ?? `Employee ${actor.id}`]));

  const items = events.map((event) => {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const changes = Array.isArray(payload.changes) ? (payload.changes as Array<Record<string, unknown>>) : [];
    const detail = changes
      .slice(0, 3)
      .map((change) => `${change.label}: ${change.to || "cleared"}`)
      .join(" · ");
    const stageChanged = payload.stageFrom !== payload.stageTo && payload.stageLabel;
    return {
      id: event.id,
      at: new Date(event.createdAt).toISOString(),
      kind: event.eventType,
      title:
        event.eventType === "field.section_saved"
          ? `${payload.sectionTitle ?? "Update"} saved`
          : String(payload.title ?? event.eventType),
      detail: [stageChanged ? `Now: ${payload.stageLabel}` : "", detail].filter(Boolean).join(" · "),
      by: (event.actorUserId !== null ? nameOf.get(event.actorUserId) : null) ?? (payload.byName as string | undefined) ?? null,
    };
  });

  const trace = data.__brixta_trace;
  if (trace && typeof trace === "object") {
    const t = trace as Record<string, unknown>;
    if (typeof t.importedAt === "string") {
      items.push({
        id: `import-${recordId}`,
        at: t.importedAt,
        kind: "import",
        title: "Imported",
        detail: [t.fileName, t.rowNumber ? `row ${t.rowNumber}` : ""].filter(Boolean).join(" · "),
        by: null,
      });
    }
  }

  return items;
}

export function registerFieldRecordRoutes(app: Express) {
  app.get(
    "/api/salesApp/field/lists",
    authenticateToken,
    withTenantDb<AuthRequest>(async (req, res, db) => {
      const userId = userIdFrom(req);
      if (!userId) return fail(res, 401, "Unauthenticated.");
      if (!(await fieldUser(db, userId))) {
        return fail(res, 403, "Mobile access is disabled for this employee.", "FIELD_USER_INACTIVE");
      }

      const lists = await fieldLists(db);
      const result = [];
      for (const { row, config } of lists) {
        const counts = await db
          .select({
            stage: sql<string>`coalesce(${entityRecords.data} -> '__field' ->> 'stage', 'new')`,
            count: sql<number>`count(*)::int`,
          })
          .from(entityRecords)
          .where(and(eq(entityRecords.entityTypeId, row.id), eq(entityRecords.status, "active")))
          .groupBy(sql`1`);

        const byStage: Record<string, number> = {};
        for (const item of counts) byStage[item.stage] = Number(item.count);

        result.push({
          id: row.id,
          key: row.key,
          title: config.title,
          config,
          counts: byStage,
          total: Object.values(byStage).reduce((sum, value) => sum + value, 0),
        });
      }

      return ok(res, { contractVersion: FIELD_APP_CONTRACT_VERSION, lists: result });
    }),
  );

  app.get(
    "/api/salesApp/field/lists/:key/records",
    authenticateToken,
    withTenantDb<AuthRequest>(async (req, res, db) => {
      const userId = userIdFrom(req);
      if (!userId) return fail(res, 401, "Unauthenticated.");
      if (!(await fieldUser(db, userId))) {
        return fail(res, 403, "Mobile access is disabled for this employee.", "FIELD_USER_INACTIVE");
      }

      const listKey = String(req.params.key);
      const match = (await fieldLists(db)).find((item) => item.row.key === listKey);
      if (!match) return fail(res, 404, "This list is not in the field app.", "FIELD_LIST_NOT_FOUND");
      const { row: type, config } = match;

      const lens: Lens = LENSES.includes(req.query.lens as Lens) ? (req.query.lens as Lens) : "todo";
      const q = String(req.query.q ?? "").trim().toLowerCase().slice(0, 80);
      const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
      const origin = originFrom(req.query as Record<string, unknown>);

      const keys = [
        ...new Set(
          [
            config.titleField,
            ...config.subtitleFields,
            config.priorityField,
            config.locationField,
            "__field",
          ].filter((key): key is string => Boolean(key)),
        ),
      ];

      const rows = await db
        .select({
          id: entityRecords.id,
          externalKey: entityRecords.externalKey,
          updatedAt: entityRecords.updatedAt,
          data: sql<Record<string, unknown>>`jsonb_build_object(${sql.join(
            keys.map((key) => sql`${key}::text, ${entityRecords.data} -> ${key}::text`),
            sql`, `,
          )})`,
        })
        .from(entityRecords)
        .where(and(eq(entityRecords.entityTypeId, type.id), eq(entityRecords.status, "active")))
        .limit(MAX_LIST_ROWS);

      const counts: Record<Lens, number> = { mine: 0, todo: 0, active: 0, followups: 0, closed: 0, all: rows.length };
      const picked = [];
      for (const row of rows) {
        const data = (row.data ?? {}) as Record<string, unknown>;
        const state = readFieldState(data);
        const rowLens = lensOf(config, state);
        const followUp = isFollowUp(config, state);
        const mine = state.assignee?.userId === userId && rowLens !== "closed";
        counts[rowLens] += 1;
        if (followUp) counts.followups += 1;
        if (mine) counts.mine += 1;

        const inLens =
          lens === "all" ||
          (lens === "followups" ? followUp : lens === "mine" ? mine : rowLens === lens);
        if (!inLens) continue;

        const summary = summaryOf(config, { ...row, data }, origin, userId);
        if (q) {
          const haystack = [summary.key ?? "", summary.title, ...summary.subtitle].join(" ").toLowerCase();
          if (!haystack.includes(q)) continue;
        }
        picked.push(summary);
      }

      picked.sort((a, b) => {
        if (lens === "followups") {
          return String(a.followUpAt ?? "9999").localeCompare(String(b.followUpAt ?? "9999"));
        }
        if (origin) {
          const da = a.distanceM ?? Number.POSITIVE_INFINITY;
          const db_ = b.distanceM ?? Number.POSITIVE_INFINITY;
          if (da !== db_) return da - db_;
        }
        const pa = a.priority ?? Number.NEGATIVE_INFINITY;
        const pb = b.priority ?? Number.NEGATIVE_INFINITY;
        if (pa !== pb) return pb - pa;
        return String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
      });

      return ok(res, {
        list: { id: type.id, key: type.key, title: config.title, config },
        lens,
        counts,
        sortedBy: lens === "followups" ? "follow_up_date" : origin ? "distance" : "priority",
        items: picked.slice(0, limit),
        total: picked.length,
      });
    }),
  );

  app.get(
    "/api/salesApp/field/records/:id",
    authenticateToken,
    withTenantDb<AuthRequest>(async (req, res, db) => {
      const userId = userIdFrom(req);
      if (!userId) return fail(res, 401, "Unauthenticated.");
      if (!(await fieldUser(db, userId))) {
        return fail(res, 403, "Mobile access is disabled for this employee.", "FIELD_USER_INACTIVE");
      }

      const loaded = await loadRecord(db, String(req.params.id));
      if (!loaded) return fail(res, 404, "This record is not available in the field app.", "FIELD_RECORD_NOT_FOUND");
      const { record, type, config } = loaded;
      const data = (record.data ?? {}) as Record<string, unknown>;

      return ok(res, {
        list: { id: type.id, key: type.key, title: config.title, config },
        record: recordDetail(config, type, record, userId),
        timeline: await timelineFor(db, record.id, data),
      });
    }),
  );

  app.post(
    "/api/salesApp/field/records/:id/sections/:section",
    authenticateToken,
    withTenantDb<AuthRequest>(async (req, res, db) => {
      const userId = userIdFrom(req);
      if (!userId) return fail(res, 401, "Unauthenticated.");
      const user = await fieldUser(db, userId);
      if (!user) return fail(res, 403, "Mobile access is disabled for this employee.", "FIELD_USER_INACTIVE");

      const loaded = await loadRecord(db, String(req.params.id), true);
      if (!loaded) return fail(res, 404, "This record is not available in the field app.", "FIELD_RECORD_NOT_FOUND");
      const { record, type, config } = loaded;

      const section = config.sections.find((item) => item.key === String(req.params.section));
      if (!section) return fail(res, 404, "This step does not exist.", "FIELD_SECTION_NOT_FOUND");

      const data = { ...((record.data ?? {}) as Record<string, unknown>) };
      const state = readFieldState(data);

      const mutationId = String(req.body?.clientMutationId ?? "");
      if (MUTATION_ID.test(mutationId) && state.mutations.includes(mutationId)) {
        // Already applied (retry from an offline queue). Answer with the current state.
        return ok(res, {
          duplicate: true,
          record: recordDetail(config, type, record, user.id),
        });
      }

      const missing = section.requires.filter(
        (required) => !state.sections[required] && required !== section.key,
      );
      if (missing.length > 0 && !state.sections[section.key]) {
        const titles = missing.map(
          (required) => config.sections.find((item) => item.key === required)?.title ?? required,
        );
        return fail(res, 409, `Do ${titles.join(" and ")} first.`, "FIELD_SECTION_LOCKED", { requires: missing });
      }

      const sitePoint = config.locationField ? pointFrom(data[config.locationField]) : null;
      // The record's current answers let "show only when ..." questions look
      // at earlier steps (BRIXTA_FIELD_APP_CONTRACT_V2).
      const cleaned = cleanSectionValues(section, req.body?.values, sitePoint, data);
      if (cleaned.problems.length > 0) {
        return fail(res, 422, cleaned.problems[0].message, "FIELD_VALUES_INVALID", { problems: cleaned.problems });
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const changes = [];
      for (const field of section.fields) {
        if (!Object.prototype.hasOwnProperty.call(cleaned.values, field.key)) continue;
        const before = data[field.key];
        const after = cleaned.values[field.key];
        if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) continue;
        const show = (value: unknown) => answerText(field, value).slice(0, 80);
        changes.push({ field: field.key, label: field.label, from: show(before), to: show(after) });
      }

      Object.assign(data, cleaned.values);

      const stageFrom = state.stage;
      const ruleValues: Record<string, unknown> = {};
      for (const field of section.fields) ruleValues[field.key] = data[field.key];
      const stageTo = nextStage(config, stageFrom, section, ruleValues);

      const followUpAt =
        config.followUpField && Object.prototype.hasOwnProperty.call(cleaned.values, config.followUpField)
          ? (cleaned.values[config.followUpField] as string | null)
          : state.followUpAt;

      // Keep keys this route doesn't own (e.g. assignee set by the CMS).
      const previousField =
        data.__field && typeof data.__field === "object" && !Array.isArray(data.__field)
          ? (data.__field as Record<string, unknown>)
          : {};
      const nextField: Omit<FieldState, "assignee"> = {
        stage: stageTo,
        stageChangedAt: stageTo !== stageFrom ? nowIso : state.stageChangedAt,
        sections: {
          ...state.sections,
          [section.key]: { completedAt: nowIso, byUserId: user.id, byName: user.name },
        },
        lastVisitAt: nowIso,
        lastVisitBy: user.name,
        followUpAt: stageOf(config, stageTo).closed ? null : followUpAt,
        mutations: MUTATION_ID.test(mutationId)
          ? [...state.mutations, mutationId].slice(-50)
          : state.mutations,
      };
      data.__field = { ...previousField, ...nextField };

      const [updated] = await db
        .update(entityRecords)
        .set({ data, updatedAt: now, updatedByUserId: user.id })
        .where(eq(entityRecords.id, record.id))
        .returning();

      const stage = stageOf(config, stageTo);
      await db.insert(platformAuditEvents).values({
        actorUserId: user.id,
        eventType: "field.section_saved",
        subjectType: "entity_record",
        subjectId: record.id,
        payload: {
          entityTypeId: type.id,
          section: section.key,
          sectionTitle: section.title,
          stageFrom,
          stageTo,
          stageLabel: stage.label,
          changes: changes.slice(0, 20),
          byName: user.name,
          clientMutationId: MUTATION_ID.test(mutationId) ? mutationId : null,
        },
      });

      return ok(res, {
        record: recordDetail(config, type, updated ?? { ...record, data }, user.id),
        stageChanged: stageTo !== stageFrom,
      });
    }),
  );
}
