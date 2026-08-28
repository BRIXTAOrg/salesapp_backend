import {
  and,
  desc,
  eq,
  inArray,
  ne,
} from "drizzle-orm";

import type {
  AppDatabase,
} from "../db/db";

import {
  dynamicSubmissions,
  workItems,
} from "../db/applianceSchema";

import {
  mobileCapabilities,
} from "../db/schema";

import {
  executeKernelAction,
  getKernelRuntime,
} from "../platform/kernel/runtimeEngine";

const ACTIVE_WORK_STATUSES = [
  "assigned",
  "in_progress",
];

const DECISION_KINDS =
  new Set([
    "approve",
    "reject",
    "return",
    "acknowledge",
    "sign",
    "complete",
    "cancel",
  ]);

const APPROVE_ORDER = [
  "approve",
  "acknowledge",
  "sign",
  "complete",
];

const REJECT_ORDER = [
  "reject",
  "return",
  "cancel",
];

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value as Record<string, unknown>
    : {};
}

function maps(
  value: unknown,
) {
  return Array.isArray(value)
    ? value
        .filter(
          (
            item,
          ): item is Record<string, unknown> =>
            Boolean(
              item &&
              typeof item === "object" &&
              !Array.isArray(item),
            ),
        )
        .map(
          (item) => ({
            ...item,
          }),
        )
    : [];
}

function decisionActions(
  runtime:
    Record<string, unknown>,
) {
  const possibilities =
    objectValue(
      runtime.possibilities,
    );

  return maps(
    possibilities.actions,
  ).filter(
    (action) =>
      DECISION_KINDS.has(
        String(
          action.kind ?? "",
        ),
      ),
  );
}

async function ensureDecisionWorkItem(
  db: AppDatabase,
  input: {
    userId: number;
    requesterUserId: number;
    capabilityId: number;
    responsibilityKey: string;
    responsibilityTitle: string;
    recordId: string;
    actions: Record<string, unknown>[];
  },
) {
  const candidates =
    await db
      .select()
      .from(workItems)
      .where(
        and(
          eq(
            workItems.assigneeUserId,
            input.userId,
          ),
          eq(
            workItems.capabilityId,
            input.capabilityId,
          ),
          inArray(
            workItems.status,
            ACTIVE_WORK_STATUSES,
          ),
        ),
      )
      .orderBy(
        desc(
          workItems.createdAt,
        ),
      )
      .limit(100);

  const existing =
    candidates.find(
      (item) => {
        const payload =
          objectValue(
            item.payload,
          );

        return (
          String(
            payload.recordId ??
            "",
          ) ===
          input.recordId
        );
      },
    );

  const actionIds =
    input.actions
      .map(
        (action) =>
          String(
            action.id ??
            "",
          ),
      )
      .filter(Boolean);

  const actionKinds =
    input.actions
      .map(
        (action) =>
          String(
            action.kind ??
            "",
          ),
      )
      .filter(Boolean);

  const payload = {
    ...(existing
      ? objectValue(
          existing.payload,
        )
      : {}),

    kind:
      "kernel_decision",

    responsibilityKey:
      input.responsibilityKey,

    recordId:
      input.recordId,

    requesterUserId:
      input.requesterUserId,

    actionIds,

    actionKinds,

    source:
      "kernel_actor_projection",
  };

  if (existing) {
    const [updated] =
      await db
        .update(workItems)
        .set({
          approvalRequired:
            true,

          payload,

          updatedAt:
            new Date(),
        })
        .where(
          eq(
            workItems.id,
            existing.id,
          ),
        )
        .returning();

    return (
      updated ??
      existing
    );
  }

  const [created] =
    await db
      .insert(workItems)
      .values({
        capabilityId:
          input.capabilityId,

        assigneeUserId:
          input.userId,

        createdByUserId:
          input.requesterUserId,

        title:
          `Review: ${input.responsibilityTitle}`,

        description:
          "A Responsibility requires your decision.",

        status:
          "assigned",

        approvalRequired:
          true,

        payload,
      })
      .returning();

  return created;
}

function normalizedDecision(
  input: {
    workItem:
      typeof workItems.$inferSelect;

    requesterUserId:
      number;

    responsibilityKey:
      string;

    responsibilityTitle:
      string;

    recordId:
      string;

    actions:
      Record<string, unknown>[];

    status?:
      "pending" |
      "approved" |
      "rejected";

    note?:
      string | null;
  },
) {
  const payload =
    objectValue(
      input.workItem.payload,
    );

  return {
    id:
      `kernel:${input.workItem.id}`,

    sourceType:
      "kernel_decision",

    sourceId:
      input.recordId,

    areaKey:
      `responsibility:${input.responsibilityKey}`,

    title:
      input.workItem.title ||
      `Review: ${input.responsibilityTitle}`,

    requesterUserId:
      input.requesterUserId,

    assignedAdminUserId:
      input.workItem.assigneeUserId,

    status:
      input.status ??
      "pending",

    payload: {
      ...payload,

      kernelDecision:
        true,

      workItemId:
        input.workItem.id,

      responsibilityKey:
        input.responsibilityKey,

      responsibilityTitle:
        input.responsibilityTitle,

      recordId:
        input.recordId,

      actionIds:
        input.actions.map(
          (action) =>
            String(
              action.id ??
              "",
            ),
        ).filter(Boolean),

      actionKinds:
        input.actions.map(
          (action) =>
            String(
              action.kind ??
              "",
            ),
        ).filter(Boolean),
    },

    workflowName:
      input.responsibilityTitle,

    responsibilityKey:
      input.responsibilityKey,

    recordId:
      input.recordId,

    requestedAt:
      input.workItem.createdAt,

    decidedAt:
      input.workItem.completedAt,

    decisionNote:
      input.note ??
      (
        typeof payload
          .decisionNote ===
          "string"
          ? payload
              .decisionNote
          : null
      ),
  };
}

/*
 * DISCOVERY IS DELIBERATE.
 *
 * We do not require effect.assign_actor to have run successfully.
 *
 * Every recent non-deleted Responsibility record is asked:
 *
 *   "Does THIS user currently have a decision-class Kernel action?"
 *
 * If YES:
 *   materialize/refresh a work item and return it.
 *
 * This is what makes existing pending records and future arbitrary
 * Responsibilities self-healing.
 */
export async function listKernelDecisions(
  db: AppDatabase,
  userId: number,
  mode:
    | "pending"
    | "all" =
    "pending",
) {
  const records =
    await db
      .select({
        id:
          dynamicSubmissions.id,

        requesterUserId:
          dynamicSubmissions.userId,

        status:
          dynamicSubmissions.status,

        capabilityId:
          dynamicSubmissions.capabilityId,

        responsibilityKey:
          mobileCapabilities.key,

        responsibilityTitle:
          mobileCapabilities.title,

        updatedAt:
          dynamicSubmissions.updatedAt,
      })
      .from(
        dynamicSubmissions,
      )
      .innerJoin(
        mobileCapabilities,
        eq(
          mobileCapabilities.id,
          dynamicSubmissions.capabilityId,
        ),
      )
      .where(
        ne(
          dynamicSubmissions.status,
          "deleted",
        ),
      )
      .orderBy(
        desc(
          dynamicSubmissions.updatedAt,
        ),
      )
      .limit(500);

  const pending:
    Record<string, unknown>[] =
    [];

  for (
    const record of records
  ) {
    const runtime =
      await getKernelRuntime(
        db,
        {
          userId,

          responsibilityKey:
            record.responsibilityKey,

          recordId:
            record.id,
        },
      );

    if (!runtime.ok) {
      continue;
    }

    const actions =
      decisionActions(
        runtime.value,
      );

    if (!actions.length) {
      continue;
    }

    const item =
      await ensureDecisionWorkItem(
        db,
        {
          userId,

          requesterUserId:
            record.requesterUserId,

          capabilityId:
            record.capabilityId,

          responsibilityKey:
            record.responsibilityKey,

          responsibilityTitle:
            record.responsibilityTitle,

          recordId:
            record.id,

          actions,
        },
      );

    if (!item) {
      continue;
    }

    pending.push(
      normalizedDecision({
        workItem:
          item,

        requesterUserId:
          record.requesterUserId,

        responsibilityKey:
          record.responsibilityKey,

        responsibilityTitle:
          record.responsibilityTitle,

        recordId:
          record.id,

        actions,
      }),
    );
  }

  if (
    mode ===
    "pending"
  ) {
    return pending;
  }

  /*
   * History comes from the durable work item after decideKernelDecision()
   * stores the outcome there.
   */
  const completed =
    await db
      .select({
        item:
          workItems,

        responsibilityKey:
          mobileCapabilities.key,

        responsibilityTitle:
          mobileCapabilities.title,
      })
      .from(
        workItems,
      )
      .innerJoin(
        mobileCapabilities,
        eq(
          mobileCapabilities.id,
          workItems.capabilityId,
        ),
      )
      .where(
        and(
          eq(
            workItems.assigneeUserId,
            userId,
          ),
          eq(
            workItems.status,
            "completed",
          ),
        ),
      )
      .orderBy(
        desc(
          workItems.completedAt,
        ),
      )
      .limit(500);

  const history:
    Record<string, unknown>[] =
    [];

  for (
    const row of completed
  ) {
    const payload =
      objectValue(
        row.item.payload,
      );

    if (
      payload.kind !==
      "kernel_decision"
    ) {
      continue;
    }

    const outcome =
      String(
        payload.decisionOutcome ??
        "",
      );

    if (
      outcome !== "approved" &&
      outcome !== "rejected"
    ) {
      continue;
    }

    const recordId =
      String(
        payload.recordId ??
        "",
      );

    const requesterUserId =
      Number(
        payload.requesterUserId,
      );

    if (
      !recordId ||
      !Number.isInteger(
        requesterUserId,
      )
    ) {
      continue;
    }

    history.push(
      normalizedDecision({
        workItem:
          row.item,

        requesterUserId,

        responsibilityKey:
          String(
            payload
              .responsibilityKey ??
            row
              .responsibilityKey,
          ),

        responsibilityTitle:
          row.responsibilityTitle,

        recordId,

        actions:
          [],

        status:
          outcome,

        note:
          typeof payload
            .decisionNote ===
            "string"
            ? payload
                .decisionNote
            : null,
      }),
    );
  }

  return [
    ...pending,
    ...history,
  ];
}

export async function decideKernelDecision(
  db: AppDatabase,
  input: {
    approvalId: string;
    actorUserId: number;
    decision:
      | "approved"
      | "rejected";
    note?: string | null;
  },
) {
  const workItemId =
    input.approvalId
      .replace(
        /^kernel:/,
        "",
      )
      .trim();

  const [item] =
    await db
      .select()
      .from(workItems)
      .where(
        and(
          eq(
            workItems.id,
            workItemId,
          ),
          eq(
            workItems.assigneeUserId,
            input.actorUserId,
          ),
          inArray(
            workItems.status,
            ACTIVE_WORK_STATUSES,
          ),
        ),
      )
      .limit(1);

  if (!item) {
    return {
      ok: false as const,

      status:
        404,

      code:
        "KERNEL_DECISION_NOT_FOUND",

      error:
        "This decision is no longer waiting for this user.",
    };
  }

  const payload =
    objectValue(
      item.payload,
    );

  const responsibilityKey =
    String(
      payload
        .responsibilityKey ??
      "",
    ).trim();

  const recordId =
    String(
      payload.recordId ??
      "",
    ).trim();

  if (
    !responsibilityKey ||
    !recordId
  ) {
    return {
      ok: false as const,

      status:
        409,

      code:
        "KERNEL_DECISION_INVALID",

      error:
        "Decision work item is missing its Responsibility record.",
    };
  }

  const runtime =
    await getKernelRuntime(
      db,
      {
        userId:
          input.actorUserId,

        responsibilityKey,

        recordId,
      },
    );

  if (!runtime.ok) {
    return {
      ok: false as const,

      status:
        runtime.status,

      code:
        runtime.code,

      error:
        runtime.error,
    };
  }

  const actions =
    decisionActions(
      runtime.value,
    );

  const order =
    input.decision ===
      "approved"
      ? APPROVE_ORDER
      : REJECT_ORDER;

  let selected:
    Record<string, unknown> |
    undefined;

  for (
    const kind of order
  ) {
    selected =
      actions.find(
        (action) =>
          String(
            action.kind ??
            "",
          ) === kind,
      );

    if (selected) {
      break;
    }
  }

  if (!selected) {
    return {
      ok: false as const,

      status:
        409,

      code:
        "KERNEL_DECISION_ACTION_UNAVAILABLE",

      error:
        input.decision ===
          "approved"
          ? "This Responsibility currently has no approval action available to you."
          : "This Responsibility currently has no rejection/return action available to you.",
    };
  }

  const actionId =
    String(
      selected.id ??
      "",
    );

  if (!actionId) {
    return {
      ok: false as const,

      status:
        409,

      code:
        "KERNEL_DECISION_ACTION_INVALID",

      error:
        "The published decision action has no ID.",
    };
  }

  const result =
    await executeKernelAction(
      db,
      {
        userId:
          input.actorUserId,

        responsibilityKey,

        actionId,

        recordId,

        payload:
          input.note
            ? {
                decision_note:
                  input.note,
              }
            : {},
      },
    );

  if (!result.ok) {
    return {
      ok: false as const,

      status:
        result.status,

      code:
        result.code,

      error:
        result.error,
    };
  }

  const runtimeRecord =
    objectValue(
      runtime.value.record,
    );

  const requesterUserId =
    Number(
      runtimeRecord.userId ??
      payload.requesterUserId,
    );

  const nextPayload = {
    ...payload,

    kind:
      "kernel_decision",

    responsibilityKey,

    recordId,

    requesterUserId:
      Number.isInteger(
        requesterUserId,
      )
        ? requesterUserId
        : null,

    decisionOutcome:
      input.decision,

    decisionNote:
      input.note ??
      null,

    decidedActionId:
      actionId,

    decidedActionKind:
      String(
        selected.kind ??
        "",
      ),

    decidedAt:
      new Date()
        .toISOString(),
  };

  const [completed] =
    await db
      .update(workItems)
      .set({
        status:
          "completed",

        completedAt:
          new Date(),

        payload:
          nextPayload,

        updatedAt:
          new Date(),
      })
      .where(
        eq(
          workItems.id,
          item.id,
        ),
      )
      .returning();

  return {
    ok: true as const,

    approval: {
      id:
        `kernel:${item.id}`,

      sourceType:
        "kernel_decision",

      sourceId:
        recordId,

      areaKey:
        `responsibility:${responsibilityKey}`,

      title:
        item.title,

      requesterUserId:
        Number.isInteger(
          requesterUserId,
        )
          ? requesterUserId
          : null,

      assignedAdminUserId:
        input.actorUserId,

      status:
        input.decision,

      payload:
        nextPayload,

      requestedAt:
        item.createdAt,

      decidedAt:
        completed
          ?.completedAt ??
        new Date(),

      decidedByUserId:
        input.actorUserId,

      decisionNote:
        input.note ??
        null,
    },

    kernelResult:
      result.value,
  };
}
