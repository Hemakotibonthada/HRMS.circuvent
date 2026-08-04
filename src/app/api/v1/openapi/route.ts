// GET /api/v1/openapi — machine-readable API description.
//
// Served rather than hand-maintained in a wiki, so it cannot drift from the
// routes. Public: an integrator needs to read it before they have a key, and
// it describes only the shape of the API, never any tenant's data.

import { NextResponse } from "next/server";
import { ALL_SCOPES } from "@/lib/api-keys";

const VERSION = "2026-04-01";

const paginationSchema = {
  type: "object",
  properties: {
    page: { type: "integer" },
    pageSize: { type: "integer" },
    total: { type: "integer" },
    hasMore: { type: "boolean" },
  },
} as const;

const errorSchema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: {
          type: "string",
          enum: [
            "unauthorized",
            "invalid_request",
            "validation_failed",
            "conflict",
            "rate_limited",
            "internal_error",
          ],
        },
        message: { type: "string" },
        field: { type: "string" },
      },
      required: ["code", "message"],
    },
  },
} as const;

const spec = {
  openapi: "3.1.0",
  info: {
    title: "Circuvent HRMS API",
    version: VERSION,
    description:
      "Read and write employee, leave and attendance data. Authenticate with an API key issued " +
      "from Settings → API keys. Keys carry explicit scopes; a write scope does not imply the " +
      "matching read scope.",
  },
  servers: [{ url: "https://hrms.circuvent.com/api/v1" }],
  components: {
    securitySchemes: {
      apiKey: {
        type: "http",
        scheme: "bearer",
        description:
          "Send as `Authorization: Bearer cvk_live_…` or `X-API-Key`. Available scopes: " +
          ALL_SCOPES.join(", "),
      },
    },
    schemas: {
      Error: errorSchema,
      Pagination: paginationSchema,
      Employee: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          employeeCode: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          fullName: { type: "string" },
          email: { type: "string", format: "email" },
          designation: { type: "string" },
          departmentId: { type: "string", format: "uuid" },
          departmentName: { type: "string" },
          employmentType: { type: "string" },
          status: { type: "string" },
          joinDate: { type: "string", format: "date" },
          exitDate: { type: "string", format: "date" },
        },
      },
      LeaveRequest: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          employeeId: { type: "string", format: "uuid" },
          leaveType: { type: "string" },
          startDate: { type: "string", format: "date" },
          endDate: { type: "string", format: "date" },
          totalDays: { type: "number" },
          status: { type: "string", enum: ["pending", "approved", "rejected", "cancelled"] },
        },
      },
      AttendanceRecord: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          employeeId: { type: "string", format: "uuid" },
          workDate: { type: "string", format: "date" },
          clockInAt: { type: "string", format: "date-time" },
          clockOutAt: { type: "string", format: "date-time" },
          status: { type: "string" },
          workedMinutes: { type: "integer" },
          overtimeMinutes: { type: "integer" },
        },
      },
    },
  },
  security: [{ apiKey: [] }],
  paths: {
    "/employees": {
      get: {
        summary: "List employees",
        description: "Requires the `employees:read` scope.",
        parameters: [
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "departmentId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          {
            name: "pageSize",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
        ],
        responses: {
          "200": {
            description: "A page of employees",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/Employee" } },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                  },
                },
              },
            },
          },
          "401": { description: "Missing or invalid key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "403": { description: "Key lacks the required scope", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "429": { description: "Rate limit exceeded", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
      post: {
        summary: "Create an employee",
        description: "Requires the `employees:write` scope.",
        responses: {
          "201": { description: "Created", content: { "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Employee" } } } } } },
          "400": { description: "Validation failed", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "409": { description: "Email or employee code already exists", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/leave": {
      get: {
        summary: "List leave requests",
        description:
          "Requires the `leave:read` scope. Read-only: approving leave is an employment " +
          "decision and belongs to a person, not an integration.",
        responses: {
          "200": {
            description: "A page of leave requests",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/LeaveRequest" } },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/attendance": {
      get: {
        summary: "List attendance records",
        description: "Requires the `attendance:read` scope.",
        responses: {
          "200": {
            description: "A page of attendance records",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: "#/components/schemas/AttendanceRecord" } },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: "Record a punch",
        description:
          "Requires the `attendance:write` scope. Intended for biometric terminals and " +
          "turnstiles. `at` may be back-dated so a terminal can submit punches buffered during " +
          "a network outage, but not future-dated.",
        responses: {
          "201": { description: "Clock-in recorded" },
          "200": { description: "Clock-out recorded" },
          "409": { description: "Already clocked in, or not clocked in" },
        },
      },
    },
  },
} as const;

export async function GET() {
  return NextResponse.json(spec, {
    headers: {
      "x-api-version": VERSION,
      // The specification is identical for every caller and changes only on
      // deploy, so it is safe to cache at the edge.
      "cache-control": "public, max-age=3600",
    },
  });
}
