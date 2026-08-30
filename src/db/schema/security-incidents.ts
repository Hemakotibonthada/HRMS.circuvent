// ═══════════════════════════════════════════════════════════════
// SECURITY INCIDENTS & DEVICE DLP SCHEMA
// ═══════════════════════════════════════════════════════════════
// Tracks hardware security events, USB storage block triggers,
// Windows Firewall egress violations, and endpoint device telemetry.

import {
  boolean,
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./identity";
import { hrms, employees } from "./hrms";

export const securityIncidents = hrms.table(
  "security_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    employeeId: uuid("employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    employeeCode: text("employee_code"),
    employeeEmail: text("employee_email"),

    deviceHostname: text("device_hostname").notNull(),
    deviceSerial: text("device_serial"),
    deviceUsername: text("device_username"),

    incidentType: text("incident_type").notNull(),
    severity: text("severity").notNull().default("high"),
    actionTaken: text("action_taken").notNull().default("blocked_and_ejected"),

    osVersion: text("os_version"),
    metadata: jsonb("metadata").notNull().default({}),

    status: text("status").notNull().default("open"),
    resolutionNotes: text("resolution_notes"),
    resolvedById: uuid("resolved_by_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    emailAlertSent: boolean("email_alert_sent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("security_incidents_org_idx").on(t.orgId),
    index("security_incidents_emp_idx").on(t.employeeId),
    index("security_incidents_type_idx").on(t.incidentType),
    index("security_incidents_status_idx").on(t.status),
    index("security_incidents_created_idx").on(t.createdAt),
  ]
);

export const deviceSecurityPolicies = hrms.table(
  "device_security_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    deviceHostname: text("device_hostname").notNull(),
    deviceSerial: text("device_serial"),
    employeeId: uuid("employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    employeeCode: text("employee_code"),
    employeeEmail: text("employee_email"),

    policyMode: text("policy_mode").notNull().default("strict_block"),
    usbBlocked: boolean("usb_blocked").notNull().default(true),
    firewallActive: boolean("firewall_active").notNull().default(true),
    agentVersion: text("agent_version").default("2.4.0"),
    osVersion: text("os_version"),

    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("device_security_policies_org_host_key").on(t.orgId, t.deviceHostname),
    index("device_security_policies_org_idx").on(t.orgId),
    index("device_security_policies_emp_idx").on(t.employeeId),
  ]
);
