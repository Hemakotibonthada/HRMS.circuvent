// ═══════════════════════════════════════════════════════════════
// HELPDESK SCHEMA — tickets, SLA policies, escalation, knowledge base
// ═══════════════════════════════════════════════════════════════
// An HR helpdesk carries grievances, harassment complaints and pay disputes
// alongside "I need a new laptop". The confidentiality model is therefore part
// of the schema rather than a UI concern: some tickets must be invisible to
// the requester's own manager, because the manager is who the ticket is about.

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
import { hrms, departments, employees } from "./hrms";

export const ticketPriorityEnum = hrms.enum("ticket_priority", [
  "urgent",
  "high",
  "normal",
  "low",
]);

export const ticketStateEnum = hrms.enum("ticket_state", [
  "new",
  "open",
  "pending_requester",
  "pending_third_party",
  "resolved",
  "closed",
]);

export const slaPolicies = hrms.table(
  "sla_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    /** Minutes of business time to first response, keyed by priority. */
    responseMinutes: jsonb("response_minutes")
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{"urgent":60,"high":240,"normal":480,"low":1440}'::jsonb`),
    resolutionMinutes: jsonb("resolution_minutes")
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{"urgent":240,"high":1440,"normal":2880,"low":5760}'::jsonb`),

    /** Priorities whose clock runs against the calendar, not the office diary. */
    roundTheClockPriorities: jsonb("round_the_clock_priorities")
      .$type<string[]>()
      .notNull()
      .default(sql`'["urgent"]'::jsonb`),

    businessHours: jsonb("business_hours")
      .$type<{
        days: Record<string, { open: string; close: string }>;
        timezone: string;
        holidays: string[];
      }>()
      .notNull(),

    escalations: jsonb("escalations")
      .$type<
        { atConsumed: number; target: string; action: string; notifyRole?: string }[]
      >()
      .notNull()
      .default(sql`'[]'::jsonb`),

    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sla_policies_org_active_idx").on(t.orgId, t.isActive)]
);

export const ticketCategories = hrms.table(
  "ticket_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    slaPolicyId: uuid("sla_policy_id").references(() => slaPolicies.id, {
      onDelete: "set null",
    }),
    /** Team that owns tickets in this category. */
    assignedTeamId: uuid("assigned_team_id").references(() => departments.id, {
      onDelete: "set null",
    }),

    /**
     * Hides the ticket from the requester's reporting line.
     *
     * A grievance about a manager cannot appear on that manager's queue, and
     * making this a category property rather than a per-ticket toggle means
     * nobody has to remember to set it while distressed.
     */
    isConfidential: boolean("is_confidential").notNull().default(false),
    /** Roles that may read confidential tickets in this category. */
    confidentialToRoles: jsonb("confidential_to_roles")
      .$type<string[]>()
      .notNull()
      .default(sql`'["hr","owner"]'::jsonb`),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ticket_categories_org_name_key").on(t.orgId, t.name),
    index("ticket_categories_org_active_idx").on(t.orgId, t.isActive),
  ]
);

export const tickets = hrms.table(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /** Human-facing reference, for when someone rings up about it. */
    reference: text("reference").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),

    requesterId: uuid("requester_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** Set when someone raises a ticket on another person's behalf. */
    raisedById: uuid("raised_by_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    assigneeId: uuid("assignee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    teamId: uuid("team_id").references(() => departments.id, { onDelete: "set null" }),

    categoryId: uuid("category_id").references(() => ticketCategories.id, {
      onDelete: "set null",
    }),
    slaPolicyId: uuid("sla_policy_id").references(() => slaPolicies.id, {
      onDelete: "set null",
    }),

    priority: ticketPriorityEnum("priority").notNull().default("normal"),
    state: ticketStateEnum("state").notNull().default("new"),
    /** Copied from the category at creation; a later category edit must not retro-hide. */
    isConfidential: boolean("is_confidential").notNull().default(false),

    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    firstRespondedAt: timestamp("first_responded_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    reopenedCount: integer("reopened_count").notNull().default(0),

    /** Cached from the SLA engine so the queue can sort by urgency cheaply. */
    responseDueAt: timestamp("response_due_at", { withTimezone: true }),
    resolutionDueAt: timestamp("resolution_due_at", { withTimezone: true }),
    responseBreached: boolean("response_breached").notNull().default(false),
    resolutionBreached: boolean("resolution_breached").notNull().default(false),

    /** Escalations already fired, so each fires exactly once. */
    firedEscalations: jsonb("fired_escalations")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    satisfactionRating: integer("satisfaction_rating"),
    satisfactionComment: text("satisfaction_comment"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tickets_org_reference_key").on(t.orgId, t.reference),
    index("tickets_org_state_idx").on(t.orgId, t.state),
    index("tickets_assignee_idx").on(t.assigneeId, t.state),
    index("tickets_requester_idx").on(t.requesterId),
    // Drives the breach-risk queue, which is the page a desk lead lives on.
    index("tickets_due_idx").on(t.orgId, t.resolutionDueAt),
  ]
);

/**
 * Spans where the SLA clock was stopped.
 *
 * Rows rather than a running total, because "why is this ticket's clock four
 * days behind the calendar?" needs an answer with dates in it.
 */
export const ticketPauses = hrms.table(
  "ticket_pauses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),

    pausedAt: timestamp("paused_at", { withTimezone: true }).notNull(),
    resumedAt: timestamp("resumed_at", { withTimezone: true }),
    reason: text("reason").notNull().default("pending_requester"),
  },
  (t) => [index("ticket_pauses_ticket_idx").on(t.ticketId)]
);

export const ticketComments = hrms.table(
  "ticket_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),

    authorId: uuid("author_id").references(() => employees.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    /**
     * Visible only to agents.
     *
     * The distinction has to be structural, not a convention: an internal note
     * accidentally shown to a requester is how a disciplinary discussion
     * reaches the person it is about.
     */
    isInternal: boolean("is_internal").notNull().default(false),
    attachments: jsonb("attachments")
      .$type<{ name: string; url: string; sizeBytes?: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ticket_comments_ticket_idx").on(t.ticketId, t.createdAt)]
);

/** Every state change, for the audit a grievance investigation needs. */
export const ticketEvents = hrms.table(
  "ticket_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),

    eventType: text("event_type").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    actorId: uuid("actor_id").references(() => employees.id, { onDelete: "set null" }),
    detail: text("detail"),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ticket_events_ticket_idx").on(t.ticketId, t.occurredAt)]
);

/**
 * Knowledge base, for deflection.
 *
 * The cheapest ticket is the one nobody needed to raise, and `viewCount` and
 * `deflectionCount` are what tell you which articles are earning their place.
 */
export const knowledgeArticles = hrms.table(
  "knowledge_articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    slug: text("slug").notNull(),
    body: text("body").notNull(),
    summary: text("summary"),
    categoryId: uuid("category_id").references(() => ticketCategories.id, {
      onDelete: "set null",
    }),
    keywords: jsonb("keywords").$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    /** Roles that may read it; empty means everyone. */
    visibleToRoles: jsonb("visible_to_roles").$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    viewCount: integer("view_count").notNull().default(0),
    /** Times someone read this instead of raising a ticket. */
    deflectionCount: integer("deflection_count").notNull().default(0),
    helpfulCount: integer("helpful_count").notNull().default(0),
    unhelpfulCount: integer("unhelpful_count").notNull().default(0),

    authorId: uuid("author_id").references(() => employees.id, { onDelete: "set null" }),
    isPublished: boolean("is_published").notNull().default(false),
    /** Content goes stale; an unreviewed article is a wrong answer waiting. */
    reviewOn: text("review_on"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("knowledge_articles_org_slug_key").on(t.orgId, t.slug),
    index("knowledge_articles_org_published_idx").on(t.orgId, t.isPublished),
  ]
);
