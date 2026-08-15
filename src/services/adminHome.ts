import {
  and,
  count,
  desc,
  eq,
  gte,
  sql,
} from "drizzle-orm";

import { db, pool } from "../db/db";
import {
  salesmanAttendance,
  salesmanLeaveApplications,
  tadaBills,
  users,
} from "../db/schema";
import {
  approvalRequests,
  attentionItems,
  deviceRegistrations,
  usageEvents,
  userPins,
  workspaceSettings,
} from "../db/applianceSchema";
import { getResolvedCapabilitiesForUser } from "./capabilityResolver";
import { ADMIN_ACTION_CATALOG } from "./adminCatalog";

export async function getSetupHealth() {
  const activeEmployees = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.isSalesAppUser, true),
        eq(users.status, "active"),
      ),
    );

  const activeCapabilities = await pool.query<{ count: string }>(
    `select count(*)::text as count
     from kamdhenu.mobile_capabilities
     where is_active = true`,
  );

  const [defaultAdmin] = await db
    .select({ value: workspaceSettings.value })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.key, "default_admin_user_id"))
    .limit(1);

  let employeesWithoutWork = 0;

  for (const employee of activeEmployees) {
    const capabilities =
      await getResolvedCapabilitiesForUser(employee.id);

    if (capabilities.length === 0) {
      employeesWithoutWork += 1;
    }
  }

  const staleCutoff = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  );

  const [staleDevices] = await db
    .select({ count: count() })
    .from(deviceRegistrations)
    .where(
      and(
        eq(deviceRegistrations.isActive, true),
        sql`${deviceRegistrations.lastSeenAt} < ${staleCutoff}`,
      ),
    );

  const capabilityCount = Number(
    activeCapabilities.rows[0]?.count ?? 0,
  );

  const checks = [
    {
      key: "employees",
      status: activeEmployees.length > 0 ? "good" : "warning",
      label:
        activeEmployees.length > 0
          ? `${activeEmployees.length} active mobile employee(s)`
          : "No mobile employees configured",
      actionKey: "employees",
    },
    {
      key: "responsibilities",
      status: capabilityCount > 0 ? "good" : "warning",
      label:
        capabilityCount > 0
          ? `${capabilityCount} active responsibility definition(s)`
          : "No responsibilities configured",
      actionKey: "responsibilities",
    },
    {
      key: "employee_assignments",
      status: employeesWithoutWork === 0 ? "good" : "warning",
      label:
        employeesWithoutWork === 0
          ? "Every active employee has work configured"
          : `${employeesWithoutWork} active employee(s) have no responsibilities`,
      actionKey: "responsibilities",
    },
    {
      key: "default_admin",
      status: defaultAdmin ? "good" : "info",
      label:
        defaultAdmin
          ? "Default admin fallback configured"
          : "No default admin set; backend will automatically use the first active dashboard admin",
      actionKey: "employees",
    },
    {
      key: "devices",
      status:
        Number(staleDevices?.count ?? 0) === 0
          ? "good"
          : "warning",
      label:
        Number(staleDevices?.count ?? 0) === 0
          ? "No stale active devices"
          : `${staleDevices?.count ?? 0} device(s) have not checked in for 24h`,
      actionKey: "devices",
    },
  ];

  return {
    ready:
      checks.filter((item) => item.status === "warning").length === 0,
    checks,
  };
}

async function getFrequentActions(actorUserId: number | null) {
  const pins = actorUserId
    ? await db
        .select()
        .from(userPins)
        .where(
          and(
            eq(userPins.userId, actorUserId),
            eq(userPins.surface, "admin_home"),
          ),
        )
        .orderBy(userPins.sortOrder)
    : [];

  const cutoff = new Date(
    Date.now() - 45 * 24 * 60 * 60 * 1000,
  );

  const usageRows = actorUserId
    ? await db
        .select({
          actionKey: usageEvents.actionKey,
          usageCount: count(),
        })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.actorUserId, actorUserId),
            eq(usageEvents.surface, "admin"),
            gte(usageEvents.occurredAt, cutoff),
          ),
        )
        .groupBy(usageEvents.actionKey)
    : [];

  const pinOrder = new Map<string, number>(
    pins.map((pin, index) => [pin.itemKey, index]),
  );

  const usageMap = new Map<string, number>(
    usageRows.map((row) => [
      row.actionKey,
      Number(row.usageCount),
    ]),
  );

  return [...ADMIN_ACTION_CATALOG]
    .sort((a, b) => {
      const aPinned = pinOrder.has(a.key);
      const bPinned = pinOrder.has(b.key);

      if (aPinned !== bPinned) return aPinned ? -1 : 1;

      if (aPinned && bPinned) {
        return (
          (pinOrder.get(a.key) ?? 0) -
          (pinOrder.get(b.key) ?? 0)
        );
      }

      return (
        (usageMap.get(b.key) ?? 0) -
        (usageMap.get(a.key) ?? 0)
      );
    })
    .slice(0, 6)
    .map((item) => ({
      ...item,
      pinned: pinOrder.has(item.key),
      usageCount: usageMap.get(item.key) ?? 0,
    }));
}

export async function getAdminHome(actorUserId: number | null) {
  const today = new Date().toISOString().slice(0, 10);

  const [
    [employeeCount],
    [presentCount],
    [leaveCount],
    [pendingTada],
    [pendingApprovals],
    [openAttentionCount],
  ] = await Promise.all([
    db
      .select({ count: count() })
      .from(users)
      .where(
        and(
          eq(users.isSalesAppUser, true),
          eq(users.status, "active"),
        ),
      ),

    db
      .select({ count: count() })
      .from(salesmanAttendance)
      .where(
        sql`${salesmanAttendance.attendanceDate} = ${today}`,
      ),

    db
      .select({ count: count() })
      .from(salesmanLeaveApplications)
      .where(
        and(
          sql`${salesmanLeaveApplications.startDate} <= ${today}`,
          sql`${salesmanLeaveApplications.endDate} >= ${today}`,
          sql`upper(${salesmanLeaveApplications.status}) in ('APPROVED', 'ACCEPTED')`,
        ),
      ),

    db
      .select({ count: count() })
      .from(tadaBills)
      .where(
        sql`upper(coalesce(${tadaBills.status}, 'PENDING')) = 'PENDING'`,
      ),

    db
      .select({ count: count() })
      .from(approvalRequests)
      .where(eq(approvalRequests.status, "pending")),

    db
      .select({ count: count() })
      .from(attentionItems)
      .where(eq(attentionItems.status, "open")),
  ]);

  const totalEmployees = Number(employeeCount?.count ?? 0);
  const present = Number(presentCount?.count ?? 0);
  const onLeave = Number(leaveCount?.count ?? 0);
  const missing = Math.max(totalEmployees - present - onLeave, 0);

  const staleCutoff = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  );

  const [staleDevices] = await db
    .select({ count: count() })
    .from(deviceRegistrations)
    .where(
      and(
        eq(deviceRegistrations.isActive, true),
        sql`${deviceRegistrations.lastSeenAt} < ${staleCutoff}`,
      ),
    );

  const recentAttention = await db
    .select()
    .from(attentionItems)
    .where(eq(attentionItems.status, "open"))
    .orderBy(desc(attentionItems.createdAt))
    .limit(8);

  const needsAttention = [
    ...(missing > 0
      ? [{
          key: "missing_check_in",
          severity: "warning",
          title: `${missing} employee(s) have not checked in`,
          actionKey: "attendance",
        }]
      : []),

    ...(Number(pendingApprovals?.count ?? 0) > 0
      ? [{
          key: "pending_approvals",
          severity: "warning",
          title: `${pendingApprovals?.count ?? 0} approval(s) are waiting`,
          actionKey: "approvals",
        }]
      : []),

    ...(Number(pendingTada?.count ?? 0) > 0
      ? [{
          key: "pending_tada",
          severity: "info",
          title: `${pendingTada?.count ?? 0} TA/DA claim(s) are pending`,
          actionKey: "ta_da",
        }]
      : []),

    ...(Number(staleDevices?.count ?? 0) > 0
      ? [{
          key: "stale_devices",
          severity: "warning",
          title: `${staleDevices?.count ?? 0} device(s) have not checked in for 24h`,
          actionKey: "devices",
        }]
      : []),

    ...recentAttention.map((item) => ({
      key: `attention:${item.id}`,
      severity: item.severity,
      title: item.title,
      body: item.body,
      actionKey: item.areaKey,
      entityType: item.entityType,
      entityId: item.entityId,
    })),
  ];

  return {
    generatedAt: new Date().toISOString(),

    today: {
      date: today,
      activeEmployees: totalEmployees,
      present,
      onLeave,
      notCheckedIn: missing,
      pendingApprovals: Number(pendingApprovals?.count ?? 0),
      pendingTada: Number(pendingTada?.count ?? 0),
      openAttention: Number(openAttentionCount?.count ?? 0),
    },

    needsAttention,
    frequentActions: await getFrequentActions(actorUserId),
    setupHealth: await getSetupHealth(),
  };
}
