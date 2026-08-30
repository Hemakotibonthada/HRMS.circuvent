import { index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./identity";
import { employees, hrms } from "./hrms";
import { deviceSecurityPolicies } from "./security-incidents";

export const deviceEnrollTokens = hrms.table(
  "device_enroll_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
    employeeEmail: text("employee_email").notNull(),
    employeeCode: text("employee_code"),
    tokenHash: text("token_hash").notNull().unique(),
    tokenPrefix: text("token_prefix").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("device_enroll_tokens_prefix_idx").on(t.tokenPrefix),
    index("device_enroll_tokens_org_idx").on(t.orgId, t.createdAt),
  ]
);

export const deviceAgentKeys = hrms.table(
  "device_agent_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => deviceSecurityPolicies.id, {
      onDelete: "cascade",
    }),
    deviceHostname: text("device_hostname").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("device_agent_keys_hostname_idx").on(t.deviceHostname)]
);
