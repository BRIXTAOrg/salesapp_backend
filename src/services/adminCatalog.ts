export const ADMIN_ACTION_CATALOG = [
  { key: "employees", label: "Employees", href: "/dashboard/usersAndTeam", icon: "users" },
  { key: "attendance", label: "Attendance", href: "/dashboard/slmAttendance", icon: "calendar-check" },
  { key: "live_location", label: "Live Location", href: "/dashboard/slmGeotracking", icon: "map-pin" },
  { key: "approvals", label: "Approvals", href: "/dashboard/usersAndTeam?tab=mobile-workspace", icon: "badge-check" },
  { key: "responsibilities", label: "Responsibilities", href: "/dashboard/usersAndTeam?tab=mobile-workspace", icon: "blocks" },
  { key: "assignments", label: "Assignments", href: "/dashboard/usersAndTeam?tab=mobile-workspace", icon: "clipboard-list" },
  { key: "leave", label: "Leave", href: "/dashboard/slmLeaves", icon: "calendar-off" },
  { key: "ta_da", label: "TA / DA", href: "/dashboard/tadaBill", icon: "receipt" },
  { key: "journey_plans", label: "Journey Plans", href: "/dashboard/permanentJourneyPlan", icon: "route" },
  { key: "reports", label: "Reports", href: "/dashboard/reports", icon: "chart-no-axes-column" },
  { key: "devices", label: "Devices", href: "/dashboard/usersAndTeam?tab=mobile-workspace", icon: "smartphone" },
] as const;
