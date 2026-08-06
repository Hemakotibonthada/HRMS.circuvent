// ═══════════════════════════════════════════════════════════════
// PLATFORM SCHEMA — custom fields
// ═══════════════════════════════════════════════════════════════
// Tenant-defined fields on core entities.
//
// Definitions and values are real rows, not a jsonb blob on the organization.
// The blob version — which this replaces — could not be indexed, could not
// carry per-field permissions, gave no history of who changed a definition,
// and rewrote every tenant's whole configuration on each edit, which loses
// concurrent updates.

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
import { sql } from "drizzle-orm";
import { organizations } from "./identity";
import { hrms } from "./hrms";

export const customFieldTypeEnum = hrms.enum("custom_field_type", [
  "text",
  "textarea",
  "number",
  "currency",
  "date",
  "boolean",
  "select",
  "multiselect",
  "email",
  "phone",
  "url",
]);

export const customFieldDefinitions = hrms.table(
  "custom_field_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /** The entity this field hangs off: employee, candidate, asset, ticket. */
    entityType: text("entity_type").notNull(),
    /** Stable machine key. Renaming the label must not orphan the values. */
    key: text("key").notNull(),
    label: text("label").notNull(),
    helpText: text("help_text"),

    dataType: customFieldTypeEnum("data_type").notNull(),
    isRequired: boolean("is_required").notNull().default(false),
    /**
     * Only required when another field holds one of these values.
     *
     * "Reason for leaving" is mandatory only when "has left" is true; making
     * it unconditionally required would block every ordinary edit.
     */
    requiredWhen: jsonb("required_when").$type<{
      key: string;
      equals: (string | number | boolean)[];
    }>(),

    options: jsonb("options")
      .$type<{ value: string; label: string; isActive?: boolean }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    validation: jsonb("validation")
      .$type<{
        minLength?: number;
        maxLength?: number;
        min?: number;
        max?: number;
        pattern?: string;
        patternMessage?: string;
      }>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    isUnique: boolean("is_unique").notNull().default(false),
    /** Holds personal data, so erasure and subject-access requests find it. */
    isPii: boolean("is_pii").notNull().default(false),
    /** Roles that may read this field; empty means everyone who can read the entity. */
    visibleToRoles: jsonb("visible_to_roles").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Roles that may write it; empty means whoever may edit the entity. */
    editableByRoles: jsonb("editable_by_roles").$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    section: text("section"),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),

    createdById: uuid("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("custom_field_definitions_org_entity_key").on(t.orgId, t.entityType, t.key),
    index("custom_field_definitions_entity_idx").on(t.orgId, t.entityType, t.isActive),
  ]
);

export const customFieldValues = hrms.table(
  "custom_field_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => customFieldDefinitions.id, { onDelete: "cascade" }),

    entityType: text("entity_type").notNull(),
    /**
     * Not a foreign key, because the field may hang off any entity.
     *
     * The trade-off is deliberate: a polymorphic FK is not expressible, and
     * the alternative — one value table per entity — multiplies the schema
     * every time a new entity becomes extensible. Orphans are cleaned by the
     * entity's own delete path.
     */
    entityId: uuid("entity_id").notNull(),

    value: jsonb("value"),
    /**
     * Stable text form, for indexing and uniqueness.
     *
     * jsonb equality would treat ["a","b"] and ["b","a"] as different, so a
     * uniqueness rule on a multiselect would be bypassed by reordering.
     */
    valueText: text("value_text"),

    /**
     * Mirror of the definition's `is_unique`, maintained by a database
     * trigger.
     *
     * Denormalised on purpose: a partial unique index cannot read another
     * table, and an application-level uniqueness check is racy — two
     * concurrent requests both pass the SELECT and both insert. Never write
     * this from application code; the trigger owns it.
     */
    isUnique: boolean("is_unique").notNull().default(false),

    updatedById: uuid("updated_by_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("custom_field_values_entity_definition_key").on(t.entityId, t.definitionId),
    index("custom_field_values_lookup_idx").on(t.orgId, t.entityType, t.entityId),
    // Drives "find everyone whose custom field X is Y", which is the whole
    // reason values are rows rather than a blob.
    index("custom_field_values_search_idx").on(t.orgId, t.definitionId, t.valueText),
  ]
);

/**
 * Definition change history.
 *
 * A field's meaning drifts — options are added, a label is reworded, it is
 * made required. When a report from last year disagrees with today's data,
 * this is the only way to find out why.
 */
export const customFieldAudit = hrms.table(
  "custom_field_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => customFieldDefinitions.id, { onDelete: "cascade" }),

    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    changedById: uuid("changed_by_id"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("custom_field_audit_definition_idx").on(t.definitionId, t.changedAt)]
);
