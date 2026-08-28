// ═══════════════════════════════════════════════════════════════
// GET /api/reports — catalogue of report presets
// ═══════════════════════════════════════════════════════════════
// Replaces a stub that advertised twelve report types and then returned a
// summary of hardcoded zeros for all of them, alongside an export endpoint
// that invented a job id and reported "processing" without queueing anything.
//
// Reports are now built and run through /api/reports/run against the catalogue
// in src/lib/reporting/builder.ts. This route lists the presets that populate
// the report picker; each is a real, executable definition rather than a label.

import { NextResponse, type NextRequest } from "next/server";
import { SOURCES, type ReportDefinition } from "@/lib/reporting/builder";
import { ROLE_PERMISSIONS, type Role } from "@/lib/rbac";
import { authErrorResponse } from "@/lib/server-auth";
import { requireApiContext } from "@/lib/api-context";

interface Preset {
  id: string;
  name: string;
  description: string;
  /** Withheld from callers lacking this permission. */
  requiresPermission?: string;
  definition: ReportDefinition;
}

const PRESETS: Preset[] = [
  {
    id: "headcount-by-department",
    name: "Headcount by department",
    description: "Active employees grouped by department",
    definition: {
      source: "employees",
      fields: ["department"],
      filters: [{ field: "status", operator: "in", value: ["active", "probation", "on_leave"] }],
      groupBy: ["department"],
      aggregations: [{ field: "headcount", function: "count", alias: "employees" }],
      sortBy: [{ field: "employees", direction: "desc" }],
    },
  },
  {
    id: "headcount-by-status",
    name: "Headcount by status",
    description: "Every employee grouped by employment status",
    definition: {
      source: "employees",
      fields: ["status"],
      groupBy: ["status"],
      aggregations: [{ field: "headcount", function: "count", alias: "employees" }],
      sortBy: [{ field: "employees", direction: "desc" }],
    },
  },
  {
    id: "joiners-this-year",
    name: "Joiners this year",
    description: "Employees who joined since 1 January",
    definition: {
      source: "employees",
      fields: ["employeeCode", "designation", "department", "joinDate"],
      filters: [
        { field: "joinDate", operator: "gte", value: `${new Date().getFullYear()}-01-01` },
      ],
      sortBy: [{ field: "joinDate", direction: "desc" }],
    },
  },
  {
    id: "exits",
    name: "Exits",
    description: "Employees who have left, most recent first",
    definition: {
      source: "employees",
      fields: ["employeeCode", "designation", "department", "joinDate", "exitDate"],
      filters: [{ field: "exitDate", operator: "is_not_null" }],
      sortBy: [{ field: "exitDate", direction: "desc" }],
    },
  },
  {
    id: "leave-utilisation",
    name: "Leave utilisation",
    description: "Approved leave days by type",
    definition: {
      source: "leave",
      fields: ["leaveType"],
      filters: [{ field: "status", operator: "eq", value: "approved" }],
      groupBy: ["leaveType"],
      aggregations: [{ field: "totalDays", function: "sum", alias: "days" }],
      sortBy: [{ field: "days", direction: "desc" }],
    },
  },
  {
    id: "pending-approvals",
    name: "Pending leave approvals",
    description: "Leave requests still awaiting a decision",
    definition: {
      source: "leave",
      fields: ["employeeCode", "department", "leaveType", "startDate", "endDate", "totalDays"],
      filters: [{ field: "status", operator: "eq", value: "pending" }],
      sortBy: [{ field: "startDate", direction: "asc" }],
    },
  },
  {
    id: "overtime-by-employee",
    name: "Overtime by employee",
    description: "Total overtime minutes per employee",
    definition: {
      source: "attendance",
      fields: ["employeeCode"],
      groupBy: ["employeeCode"],
      aggregations: [{ field: "overtimeMinutes", function: "sum", alias: "overtimeMinutes" }],
      sortBy: [{ field: "overtimeMinutes", direction: "desc" }],
      limit: 100,
    },
  },
  {
    id: "lateness-by-department",
    name: "Lateness by department",
    description: "Average minutes late, by department",
    definition: {
      source: "attendance",
      fields: ["department"],
      filters: [{ field: "status", operator: "eq", value: "late" }],
      groupBy: ["department"],
      aggregations: [{ field: "lateByMinutes", function: "avg", alias: "averageMinutesLate" }],
      sortBy: [{ field: "averageMinutesLate", direction: "desc" }],
    },
  },
  {
    id: "salary-by-department",
    name: "Salary cost by department",
    description: "Total and average CTC per department",
    // Being able to run reports is not authority to see compensation. The
    // field catalogue enforces this again at compile time, so a hand-written
    // definition cannot route around it either.
    requiresPermission: "payroll.view",
    definition: {
      source: "employees",
      fields: ["department"],
      filters: [{ field: "status", operator: "in", value: ["active", "probation", "on_leave"] }],
      groupBy: ["department"],
      aggregations: [
        { field: "ctc", function: "sum", alias: "totalCtc" },
        { field: "ctc", function: "avg", alias: "averageCtc" },
      ],
      sortBy: [{ field: "totalCtc", direction: "desc" }],
    },
  },
];

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireApiContext(request, ["owner", "admin", "hr", "manager"]);
  } catch (e) {
    const { body, status } = authErrorResponse(e);
    return NextResponse.json(body, { status });
  }

  const known: Role[] = ["admin", "hr", "manager", "employee"];
  const permissions = new Set<string>(
    known.includes(ctx.role as Role) ? ROLE_PERMISSIONS[ctx.role as Role] : []
  );

  const presets = PRESETS.filter(
    (p) => !p.requiresPermission || permissions.has(p.requiresPermission)
  ).map(({ id, name, description, definition }) => ({ id, name, description, definition }));

  return NextResponse.json({
    sources: Object.values(SOURCES).map((s) => ({ key: s.key, label: s.label })),
    presets,
  });
}
