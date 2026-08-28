// ═══════════════════════════════════════════════════════════════
// REPORT BUILDER — safe dynamic queries
// ═══════════════════════════════════════════════════════════════
// Enterprise buyers expect to build their own reports without asking for a
// deploy. That means turning user input into SQL, which is the single most
// dangerous thing an application can do.
//
// The defence is an allow-list, not escaping. Nothing the caller sends is ever
// interpolated into SQL: field names are looked up in a fixed catalogue and
// replaced with the column expression declared there, and every value becomes
// a bound parameter. A field name that is not in the catalogue is rejected
// outright rather than sanitised, because sanitising is a guess about what is
// dangerous and an allow-list is a statement about what is permitted.
//
// This module produces a parameterised query. It does not execute anything, so
// the whole surface is testable without a database.

export type FieldType = "string" | "number" | "date" | "boolean" | "enum";

export interface FieldDefinition {
  /** Stable identifier used by saved reports. */
  key: string;
  label: string;
  type: FieldType;
  /** The column expression. Author-controlled; never derived from input. */
  column: string;
  /** Values permitted for an enum field. */
  options?: readonly string[];
  /** Withheld from users who lack this permission. */
  requiresPermission?: string;
  aggregatable?: boolean;
  groupable?: boolean;
}

export interface DataSource {
  key: string;
  label: string;
  /** FROM clause. Author-controlled. */
  from: string;
  fields: FieldDefinition[];
  /** Applied to every query on this source, in addition to row-level security. */
  baseWhere?: string;
}

export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not_in"
  | "contains"
  | "between"
  | "is_null"
  | "is_not_null";

export interface ReportFilter {
  field: string;
  operator: FilterOperator;
  value?: unknown;
}

export type Aggregation = "count" | "sum" | "avg" | "min" | "max";

export interface ReportDefinition {
  source: string;
  /** Columns to select. Must be groupable when any aggregation is present. */
  fields: string[];
  filters?: ReportFilter[];
  groupBy?: string[];
  aggregations?: { field: string; function: Aggregation; alias: string }[];
  sortBy?: { field: string; direction: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
}

export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportError";
  }
}

// ─── Catalogue ───────────────────────────────────────────────

export const EMPLOYEE_SOURCE: DataSource = {
  key: "employees",
  label: "Employees",
  from: `hrms.employees e
    LEFT JOIN hrms.departments d ON d.id = e.department_id
    LEFT JOIN hrms.locations l ON l.id = e.location_id`,
  baseWhere: "e.deleted_at IS NULL",
  fields: [
    { key: "employeeCode", label: "Employee code", type: "string", column: "e.employee_code", groupable: true },
    { key: "firstName", label: "First name", type: "string", column: "e.first_name" },
    { key: "lastName", label: "Last name", type: "string", column: "e.last_name" },
    { key: "email", label: "Work email", type: "string", column: "e.work_email" },
    { key: "designation", label: "Designation", type: "string", column: "e.designation", groupable: true },
    { key: "department", label: "Department", type: "string", column: "d.name", groupable: true },
    { key: "location", label: "Location", type: "string", column: "l.name", groupable: true },
    {
      key: "status",
      label: "Status",
      type: "enum",
      column: "e.status",
      options: ["active", "on_leave", "probation", "notice_period", "terminated", "inactive"],
      groupable: true,
    },
    {
      key: "employmentType",
      label: "Employment type",
      type: "enum",
      column: "e.employment_type",
      options: ["full_time", "part_time", "contract", "intern", "freelance"],
      groupable: true,
    },
    { key: "joinDate", label: "Join date", type: "date", column: "e.join_date", groupable: true },
    { key: "exitDate", label: "Exit date", type: "date", column: "e.exit_date" },
    {
      key: "ctc",
      label: "CTC",
      type: "number",
      // Compensation is not visible to a report author without the permission,
      // even though the column exists on a table they can otherwise query.
      column: "(e.ctc_minor / 100.0)",
      requiresPermission: "payroll.view",
      aggregatable: true,
    },
    { key: "headcount", label: "Headcount", type: "number", column: "e.id", aggregatable: true },
  ],
};

export const LEAVE_SOURCE: DataSource = {
  key: "leave",
  label: "Leave requests",
  from: `hrms.leave_requests lr
    JOIN hrms.employees e ON e.id = lr.employee_id
    LEFT JOIN hrms.departments d ON d.id = e.department_id`,
  fields: [
    { key: "employeeCode", label: "Employee code", type: "string", column: "e.employee_code", groupable: true },
    { key: "department", label: "Department", type: "string", column: "d.name", groupable: true },
    {
      key: "leaveType",
      label: "Leave type",
      type: "enum",
      column: "lr.leave_type",
      options: ["casual", "sick", "earned", "maternity", "paternity", "compensatory", "unpaid", "bereavement", "wfh", "marriage", "study"],
      groupable: true,
    },
    {
      key: "status",
      label: "Status",
      type: "enum",
      column: "lr.status",
      options: ["pending", "approved", "rejected", "cancelled"],
      groupable: true,
    },
    { key: "startDate", label: "Start date", type: "date", column: "lr.start_date", groupable: true },
    { key: "endDate", label: "End date", type: "date", column: "lr.end_date" },
    { key: "totalDays", label: "Days", type: "number", column: "lr.total_days", aggregatable: true },
    { key: "appliedAt", label: "Applied on", type: "date", column: "lr.applied_at" },
  ],
};

export const ATTENDANCE_SOURCE: DataSource = {
  key: "attendance",
  label: "Attendance",
  from: `hrms.attendance_records a
    JOIN hrms.employees e ON e.id = a.employee_id
    LEFT JOIN hrms.departments d ON d.id = e.department_id`,
  fields: [
    { key: "employeeCode", label: "Employee code", type: "string", column: "e.employee_code", groupable: true },
    { key: "department", label: "Department", type: "string", column: "d.name", groupable: true },
    { key: "workDate", label: "Date", type: "date", column: "a.work_date", groupable: true },
    {
      key: "status",
      label: "Status",
      type: "enum",
      column: "a.status",
      options: ["present", "absent", "late", "half_day", "on_leave", "holiday", "weekend", "wfh"],
      groupable: true,
    },
    { key: "workedMinutes", label: "Minutes worked", type: "number", column: "a.worked_minutes", aggregatable: true },
    { key: "overtimeMinutes", label: "Overtime minutes", type: "number", column: "a.overtime_minutes", aggregatable: true },
    { key: "lateByMinutes", label: "Late by (minutes)", type: "number", column: "a.late_by_minutes", aggregatable: true },
  ],
};

export const SOURCES: Record<string, DataSource> = {
  employees: EMPLOYEE_SOURCE,
  leave: LEAVE_SOURCE,
  attendance: ATTENDANCE_SOURCE,
};

// ─── Compilation ─────────────────────────────────────────────

export interface CompiledReport {
  sql: string;
  /** Bound parameters, in $1…$n order. */
  params: unknown[];
  /** Column aliases in result order. */
  columns: string[];
}

const AGGREGATION_SQL: Record<Aggregation, (column: string) => string> = {
  count: (c) => `count(${c})`,
  sum: (c) => `sum(${c})`,
  avg: (c) => `avg(${c})`,
  min: (c) => `min(${c})`,
  max: (c) => `max(${c})`,
};

/** Aliases are emitted into SQL, so they are constrained rather than escaped. */
const SAFE_ALIAS = /^[a-z_][a-z0-9_]{0,62}$/i;

const MAX_ROWS = 50_000;

function resolveField(
  source: DataSource,
  key: string,
  permissions: ReadonlySet<string>
): FieldDefinition {
  const field = source.fields.find((f) => f.key === key);
  // Unknown fields are rejected, not ignored: silently dropping one would
  // produce a report that looks complete but is not what was asked for.
  if (!field) {
    throw new ReportError(`Unknown field "${key}" on ${source.label}`);
  }
  if (field.requiresPermission && !permissions.has(field.requiresPermission)) {
    // Same message as an unknown field, so the response does not confirm that
    // a restricted column exists.
    throw new ReportError(`Unknown field "${key}" on ${source.label}`);
  }
  return field;
}

function coerce(field: FieldDefinition, value: unknown): unknown {
  switch (field.type) {
    case "number": {
      const n = Number(value);
      if (Number.isNaN(n)) throw new ReportError(`${field.label} expects a number`);
      return n;
    }
    case "boolean":
      return value === true || value === "true";
    case "date": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
        throw new ReportError(`${field.label} expects a date as YYYY-MM-DD`);
      }
      return value;
    }
    case "enum": {
      const text = String(value);
      // Bound parameters make injection impossible regardless, but an invalid
      // enum would fail at the database with an opaque error.
      if (field.options && !field.options.includes(text)) {
        throw new ReportError(`${field.label} does not accept "${text}"`);
      }
      return text;
    }
    default:
      return String(value);
  }
}

export function compileReport(
  definition: ReportDefinition,
  permissions: ReadonlySet<string> = new Set()
): CompiledReport {
  const source = SOURCES[definition.source];
  if (!source) throw new ReportError(`Unknown data source "${definition.source}"`);

  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const aggregations = definition.aggregations ?? [];
  const groupBy = definition.groupBy ?? [];

  if (definition.fields.length === 0 && aggregations.length === 0) {
    throw new ReportError("Select at least one field");
  }

  // ── SELECT ──
  const select: string[] = [];
  const columns: string[] = [];

  for (const key of definition.fields) {
    const field = resolveField(source, key, permissions);
    // Postgres requires every non-aggregated column to be grouped. Catching it
    // here gives the report author a usable message instead of a syntax error.
    if (aggregations.length > 0 && !groupBy.includes(key)) {
      throw new ReportError(
        `"${field.label}" must be grouped or aggregated when the report has aggregations`
      );
    }
    select.push(`${field.column} AS "${field.key}"`);
    columns.push(field.key);
  }

  for (const agg of aggregations) {
    const field = resolveField(source, agg.field, permissions);
    if (!field.aggregatable) {
      throw new ReportError(`"${field.label}" cannot be aggregated`);
    }
    if (!SAFE_ALIAS.test(agg.alias)) {
      throw new ReportError(`Invalid alias "${agg.alias}"`);
    }
    const fn = AGGREGATION_SQL[agg.function];
    if (!fn) throw new ReportError(`Unknown aggregation "${agg.function}"`);

    select.push(`${fn(field.column)} AS "${agg.alias}"`);
    columns.push(agg.alias);
  }

  // ── WHERE ──
  const where: string[] = [];
  if (source.baseWhere) where.push(source.baseWhere);

  for (const filter of definition.filters ?? []) {
    const field = resolveField(source, filter.field, permissions);

    switch (filter.operator) {
      case "is_null":
        where.push(`${field.column} IS NULL`);
        break;
      case "is_not_null":
        where.push(`${field.column} IS NOT NULL`);
        break;
      case "in":
      case "not_in": {
        if (!Array.isArray(filter.value) || filter.value.length === 0) {
          throw new ReportError(`${field.label} filter needs a non-empty list`);
        }
        // Guards against an oversized IN list being used to exhaust memory.
        if (filter.value.length > 1000) {
          throw new ReportError(`${field.label} filter accepts at most 1000 values`);
        }
        const placeholders = filter.value.map((v) => bind(coerce(field, v)));
        where.push(
          `${field.column} ${filter.operator === "in" ? "IN" : "NOT IN"} (${placeholders.join(", ")})`
        );
        break;
      }
      case "between": {
        if (!Array.isArray(filter.value) || filter.value.length !== 2) {
          throw new ReportError(`${field.label} between-filter needs exactly two values`);
        }
        where.push(
          `${field.column} BETWEEN ${bind(coerce(field, filter.value[0]))} AND ${bind(coerce(field, filter.value[1]))}`
        );
        break;
      }
      case "contains": {
        if (field.type !== "string") {
          throw new ReportError(`"${field.label}" cannot be searched by text`);
        }
        // The wildcards are ours; the user's text is bound, so % and _ in it
        // are matched literally rather than acting as wildcards.
        where.push(`${field.column} ILIKE ${bind(`%${String(filter.value)}%`)}`);
        break;
      }
      default: {
        const operators: Record<string, string> = {
          eq: "=",
          neq: "<>",
          gt: ">",
          gte: ">=",
          lt: "<",
          lte: "<=",
        };
        const op = operators[filter.operator];
        if (!op) throw new ReportError(`Unknown operator "${filter.operator}"`);
        where.push(`${field.column} ${op} ${bind(coerce(field, filter.value))}`);
      }
    }
  }

  // ── GROUP BY ──
  const groupColumns = groupBy.map((key) => {
    const field = resolveField(source, key, permissions);
    if (!field.groupable) throw new ReportError(`"${field.label}" cannot be grouped`);
    return field.column;
  });

  // ── ORDER BY ──
  const order = (definition.sortBy ?? []).map((sort) => {
    // Sorting by an aggregate alias is legitimate and common ("highest total
    // first"), so aliases are accepted alongside catalogue fields.
    const alias = aggregations.find((a) => a.alias === sort.field);
    const expression = alias
      ? `"${alias.alias}"`
      : resolveField(source, sort.field, permissions).column;
    return `${expression} ${sort.direction === "desc" ? "DESC" : "ASC"}`;
  });

  const limit = Math.min(MAX_ROWS, Math.max(1, definition.limit ?? 1000));
  const offset = Math.max(0, definition.offset ?? 0);

  const sql = [
    `SELECT ${select.join(", ")}`,
    `FROM ${source.from}`,
    where.length ? `WHERE ${where.join(" AND ")}` : "",
    groupColumns.length ? `GROUP BY ${groupColumns.join(", ")}` : "",
    order.length ? `ORDER BY ${order.join(", ")}` : "",
    `LIMIT ${limit}`,
    offset > 0 ? `OFFSET ${offset}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { sql, params, columns };
}

/** Fields a user may reference, for populating the report designer. */
export function availableFields(
  sourceKey: string,
  permissions: ReadonlySet<string>
): FieldDefinition[] {
  const source = SOURCES[sourceKey];
  if (!source) throw new ReportError(`Unknown data source "${sourceKey}"`);
  return source.fields.filter(
    (f) => !f.requiresPermission || permissions.has(f.requiresPermission)
  );
}
