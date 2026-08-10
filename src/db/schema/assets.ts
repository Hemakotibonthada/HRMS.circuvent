// ═══════════════════════════════════════════════════════════════
// ASSET SCHEMA — register, assignment history, maintenance
// ═══════════════════════════════════════════════════════════════
// The `assets` table originally lived in hrms.ts. Its columns were sound, so
// migration 0016 ALTERs it in place rather than dropping and recreating it —
// unlike the placeholder tickets and SSO tables, this one was worth keeping.
// Only the definition moved, so there is still exactly one.
//
// Depreciation feeds the balance sheet, which is why the method and its inputs
// are stored per asset rather than assumed: finance declares a policy to their
// auditors, and the register has to match what was declared.

import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./identity";
import { hrms, employees, locations } from "./hrms";

export const assetStateEnum = hrms.enum("asset_state", [
  "in_stock",
  "assigned",
  "in_repair",
  "lost",
  "retired",
  "disposed",
]);

export const depreciationMethodEnum = hrms.enum("depreciation_method", [
  "straight_line",
  "declining_balance",
  "double_declining",
  "none",
]);

export const assetCategories = hrms.table(
  "asset_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    code: text("code").notNull(),

    /** Defaults applied to assets created in this category. */
    defaultUsefulLifeMonths: integer("default_useful_life_months").notNull().default(36),
    defaultMethod: depreciationMethodEnum("default_method").notNull().default("straight_line"),
    /** Residual as a percentage of cost, applied at creation. */
    defaultSalvagePercent: integer("default_salvage_percent").notNull().default(0),

    /** How many one person may hold. Zero means no limit. */
    maxPerEmployee: integer("max_per_employee").notNull().default(0),
    /** Months between services. Zero means no schedule. */
    serviceIntervalMonths: integer("service_interval_months").notNull().default(0),
    /** Requires a signed acceptance before issue — laptops, phones, cards. */
    requiresAcceptance: boolean("requires_acceptance").notNull().default(false),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("asset_categories_org_code_key").on(t.orgId, t.code),
    index("asset_categories_org_active_idx").on(t.orgId, t.isActive),
  ]
);

export const assets = hrms.table(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    assetTag: text("asset_tag").notNull(),
    name: text("name").notNull(),
    /** Free-text category retained from the original schema for continuity. */
    category: text("category").notNull(),
    categoryId: uuid("category_id").references(() => assetCategories.id, {
      onDelete: "set null",
    }),

    serialNumber: text("serial_number"),
    manufacturer: text("manufacturer"),
    model: text("model"),

    purchaseDate: date("purchase_date"),
    purchaseCostMinor: bigint("purchase_cost_minor", { mode: "bigint" }),
    currency: text("currency").notNull().default("INR"),
    warrantyExpiresOn: date("warranty_expires_on"),
    supplier: text("supplier"),
    invoiceNumber: text("invoice_number"),

    // ── Depreciation ──
    depreciationMethod: depreciationMethodEnum("depreciation_method")
      .notNull()
      .default("straight_line"),
    usefulLifeMonths: integer("useful_life_months").notNull().default(36),
    salvageValueMinor: bigint("salvage_value_minor", { mode: "bigint" })
      .notNull()
      .default(sql`0`),

    condition: text("condition").notNull().default("good"),
    /**
     * Lifecycle state.
     *
     * Replaces the free-text `status` it sits beside: a state machine cannot
     * be enforced over arbitrary strings, and "avaliable" is a state nobody
     * notices until a report is short by one laptop.
     */
    state: assetStateEnum("state").notNull().default("in_stock"),
    status: text("status").notNull().default("available"),

    assignedToId: uuid("assigned_to_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),

    lastServicedOn: date("last_serviced_on"),
    disposedOn: date("disposed_on"),
    disposalProceedsMinor: bigint("disposal_proceeds_minor", { mode: "bigint" }),
    disposalReason: text("disposal_reason"),

    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("assets_org_tag_key").on(t.orgId, t.assetTag),
    index("assets_org_status_idx").on(t.orgId, t.status),
    index("assets_assigned_to_idx").on(t.assignedToId),
    index("assets_org_state_idx").on(t.orgId, t.state),
  ]
);

/**
 * Who held what, and when.
 *
 * Rows rather than just the current holder. "Who had this laptop when the data
 * was leaked?" is a question the current assignment cannot answer, and it is
 * the question that actually gets asked.
 */
export const assetAssignments = hrms.table(
  "asset_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),

    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    issuedById: uuid("issued_by_id").references(() => employees.id, { onDelete: "set null" }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    returnedToId: uuid("returned_to_id").references(() => employees.id, {
      onDelete: "set null",
    }),

    conditionOnIssue: text("condition_on_issue").notNull().default("good"),
    conditionOnReturn: text("condition_on_return"),
    /** Book value when issued, so a later loss can be costed at the right figure. */
    bookValueOnIssueMinor: bigint("book_value_on_issue_minor", { mode: "bigint" }),

    /** Signed acceptance, for categories that require one. */
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptanceDocumentId: uuid("acceptance_document_id"),

    notes: text("notes"),
  },
  (t) => [
    index("asset_assignments_asset_idx").on(t.assetId, t.issuedAt),
    index("asset_assignments_employee_idx").on(t.employeeId),
  ]
);

export const assetMaintenance = hrms.table(
  "asset_maintenance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),

    kind: text("kind").notNull().default("repair"),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
    reportedById: uuid("reported_by_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),

    vendor: text("vendor"),
    /** Under warranty, the cost is the vendor's, which changes the decision. */
    underWarranty: boolean("under_warranty").notNull().default(false),
    costMinor: bigint("cost_minor", { mode: "bigint" }),

    completedAt: timestamp("completed_at", { withTimezone: true }),
    outcome: text("outcome"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asset_maintenance_asset_idx").on(t.assetId, t.reportedAt)]
);

/**
 * Every lifecycle change.
 *
 * Insert-only. An asset register is an inventory of things that walk out of
 * buildings, and the history of who moved what is the only defence against a
 * dispute about it.
 */
export const assetEvents = hrms.table(
  "asset_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),

    action: text("action").notNull(),
    fromState: text("from_state"),
    toState: text("to_state"),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),
    actorId: uuid("actor_id").references(() => employees.id, { onDelete: "set null" }),
    detail: text("detail"),
    metadata: jsonb("metadata"),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asset_events_asset_idx").on(t.assetId, t.occurredAt)]
);

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
export type AssetAssignment = typeof assetAssignments.$inferSelect;
