// ═══════════════════════════════════════════════════════════════
// INTEGRATIONS SCHEMA — outbound webhooks
// ═══════════════════════════════════════════════════════════════
// Its own file rather than an addition to hrms.ts, which is large and edited
// constantly; a new table does not need to contend with it.
//
// Deliberately narrow. This covers the one class of integration that works
// with nothing but a URL the customer already owns — Slack, Teams and most
// chat tools accept exactly this shape. Anything requiring a registered OAuth
// application is absent rather than drawn as a button that cannot work, which
// is what the settings screen used to do.

import { boolean, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./identity";
import { hrms } from "./hrms";

export const integrations = hrms.table("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),

  /** Constrained in SQL: slack_webhook | teams_webhook | generic_webhook. */
  kind: text("kind").notNull(),
  displayName: text("display_name").notNull(),
  endpointUrl: text("endpoint_url").notNull(),

  /**
   * Signing secret, encrypted at rest and never returned by the API.
   *
   * A webhook secret is a bearer credential for whatever is on the other end:
   * anyone holding it can forge messages that the receiving system will trust.
   */
  secretEncrypted: text("secret_encrypted"),

  /** Event names to deliver. Empty means everything this app emits. */
  events: jsonb("events").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  isEnabled: boolean("is_enabled").notNull().default(true),

  /**
   * What actually happened last time, so the screen can report a real result.
   * The panel this replaces displayed invented sync times for services that
   * were never connected to anything.
   */
  lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
  lastStatus: text("last_status"),
  lastError: text("last_error"),

  /**
   * The signed-in user who added it. The API context carries an identity user
   * id rather than an employee id, so this is recorded as what it actually is
   * instead of being forced through a join that would sometimes find nobody.
   */
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IntegrationRow = typeof integrations.$inferSelect;
