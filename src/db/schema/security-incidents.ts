// ═══════════════════════════════════════════════════════════════
// SECURITY INCIDENTS & DEVICE DLP SCHEMA
// ═══════════════════════════════════════════════════════════════
// Tracks hardware security events, USB storage block triggers,
// Windows Firewall egress violations, and endpoint device telemetry.

import {
  boolean,
  index,
  integer,
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
    agentVersion: text("agent_version").default("2.5.0"),
    osVersion: text("os_version"),
    osFamily: text("os_family").notNull().default("windows"), // "windows" | "macos" | "linux"
    osBuild: text("os_build"),

    // Disk Encryption & Compliance
    encryptionStatus: text("encryption_status").notNull().default("unknown"), // "encrypted" | "unencrypted" | "encrypting" | "unknown"
    encryptionType: text("encryption_type").notNull().default("none"), // "bitlocker" | "filevault" | "luks" | "none"

    // Patch Management
    missingPatchesCount: integer("missing_patches_count").notNull().default(0),
    pendingUpdates: jsonb("pending_updates").notNull().default([]),
    lastPatchScanAt: timestamp("last_patch_scan_at", { withTimezone: true }),

    // Software Scan & Inventory
    lastSoftwareScanAt: timestamp("last_software_scan_at", { withTimezone: true }),

    // Overall Compliance
    complianceScore: integer("compliance_score").notNull().default(100), // 0 to 100
    complianceStatus: text("compliance_status").notNull().default("compliant"), // "compliant" | "warning" | "critical_risk"

    // Hardware Specs Telemetry (CPU, RAM, Storage, MAC, Model, etc.)
    hardwareSpecs: jsonb("hardware_specs").notNull().default({}),

    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("device_security_policies_org_host_key").on(t.orgId, t.deviceHostname),
    index("device_security_policies_org_idx").on(t.orgId),
    index("device_security_policies_emp_idx").on(t.employeeId),
    index("device_security_policies_os_idx").on(t.osFamily),
    index("device_security_policies_compliance_idx").on(t.complianceStatus),
  ]
);

export const deviceInstalledSoftware = hrms.table(
  "device_installed_software",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    deviceId: uuid("device_id").references(() => deviceSecurityPolicies.id, {
      onDelete: "cascade",
    }),
    deviceHostname: text("device_hostname").notNull(),
    employeeId: uuid("employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),

    name: text("name").notNull(),
    version: text("version"),
    publisher: text("publisher"),
    installDate: text("install_date"),
    isBlacklisted: boolean("is_blacklisted").notNull().default(false),
    category: text("category").notNull().default("utility"), // "utility" | "development" | "remote_access" | "p2p_sharing" | "productivity" | "security" | "communication"
    riskLevel: text("risk_level").notNull().default("low"), // "safe" | "low" | "medium" | "high" | "critical"

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("device_installed_software_org_idx").on(t.orgId),
    index("device_installed_software_device_idx").on(t.deviceId),
    index("device_installed_software_hostname_idx").on(t.deviceHostname),
    index("device_installed_software_blacklisted_idx").on(t.isBlacklisted),
    index("device_installed_software_risk_idx").on(t.riskLevel),
    uniqueIndex("device_software_host_name_ver_key").on(t.deviceHostname, t.name, t.version),
  ]
);

export const deviceCommands = hrms.table(
  "device_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    deviceId: uuid("device_id").references(() => deviceSecurityPolicies.id, {
      onDelete: "cascade",
    }),
    deviceHostname: text("device_hostname").notNull(),

    commandType: text("command_type").notNull(), // "lock_device" | "policy_refresh" | "trigger_scan" | "kill_process" | "quarantine_app" | "wipe_cache"
    payload: jsonb("payload").notNull().default({}),

    status: text("status").notNull().default("pending"), // "pending" | "sent" | "acknowledged" | "completed" | "failed" | "cancelled"
    issuedById: uuid("issued_by_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    issuedByEmail: text("issued_by_email"),

    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    resultOutput: text("result_output"),
    errorMessage: text("error_message"),
  },
  (t) => [
    index("device_commands_org_idx").on(t.orgId),
    index("device_commands_device_idx").on(t.deviceId),
    index("device_commands_hostname_status_idx").on(t.deviceHostname, t.status),
    index("device_commands_issued_idx").on(t.issuedAt),
  ]
);
