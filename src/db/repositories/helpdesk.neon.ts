// ═══════════════════════════════════════════════════════════════
// HELPDESK REPOSITORY — Neon implementation (server-side only)
// ═══════════════════════════════════════════════════════════════
// Tickets, SLA tracking and escalation. The clock arithmetic lives in
// src/lib/sla.ts so it tests without a database.
//
// The access model is the part to read carefully. An HR helpdesk carries
// grievances and harassment complaints alongside laptop requests, and a
// confidential ticket must be invisible to the requester's own manager —
// because the manager is frequently who the ticket is about. That is enforced
// here, in the query, not in the UI.

import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/db/client";
import { employees } from "@/db/schema/hrms";
import {
  knowledgeArticles,
  slaPolicies,
  ticketCategories,
  ticketComments,
  ticketEvents,
  ticketPauses,
  tickets,
} from "@/db/schema/helpdesk";
import {
  DEFAULT_SLA,
  clockPaused,
  dueEscalations,
  escalationKey,
  raisePriority,
  slaStatus,
  type BusinessHours,
  type EscalationRule,
  type Priority,
  type SlaPolicy,
  type TicketState,
} from "@/lib/sla";
import { NotFoundError, RepositoryError } from "./types";

export interface TicketRecord {
  id: string;
  reference: string;
  subject: string;
  body?: string;
  requesterId: string;
  requesterName?: string;
  assigneeId?: string;
  priority: Priority;
  state: TicketState;
  isConfidential: boolean;
  createdAt: string;
  responseDueAt?: string;
  resolutionDueAt?: string;
  responseBreached: boolean;
  resolutionBreached: boolean;
  /** Fraction of the resolution target consumed, for the risk queue. */
  resolutionConsumed?: number;
  tags: string[];
}

function toPolicy(row: typeof slaPolicies.$inferSelect | undefined): SlaPolicy {
  if (!row) return DEFAULT_SLA;

  return {
    id: row.id,
    name: row.name,
    responseMinutes: row.responseMinutes as SlaPolicy["responseMinutes"],
    resolutionMinutes: row.resolutionMinutes as SlaPolicy["resolutionMinutes"],
    roundTheClockPriorities: (row.roundTheClockPriorities as Priority[]) ?? [],
    businessHours: row.businessHours as unknown as BusinessHours,
  };
}

/**
 * A short, unambiguous reference.
 *
 * No I, O, 0 or 1: these are read out over the phone, and a reference someone
 * cannot dictate correctly is a reference the desk cannot find.
 */
function reference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `HD-${[...bytes].map((b) => alphabet[b % alphabet.length]).join("")}`;
}

export class NeonHelpdeskRepository {
  constructor(private readonly ctx: TenantContext) {}

  async createTicket(input: {
    subject: string;
    body: string;
    requesterId: string;
    raisedById?: string;
    categoryId?: string;
    priority?: Priority;
    tags?: string[];
  }): Promise<TicketRecord> {
    return withTenant(this.ctx, async (tx) => {
      let isConfidential = false;
      let teamId: string | undefined;
      let slaPolicyId: string | undefined;

      if (input.categoryId) {
        const [category] = await tx
          .select()
          .from(ticketCategories)
          .where(eq(ticketCategories.id, input.categoryId))
          .limit(1);

        if (!category) throw new NotFoundError("Category", input.categoryId);

        // Copied onto the ticket rather than read through the category. A
        // later edit to the category must not retroactively expose tickets
        // raised while it was confidential.
        isConfidential = category.isConfidential;
        teamId = category.assignedTeamId ?? undefined;
        slaPolicyId = category.slaPolicyId ?? undefined;
      }

      if (!slaPolicyId) {
        const [fallback] = await tx
          .select({ id: slaPolicies.id })
          .from(slaPolicies)
          .where(and(eq(slaPolicies.isDefault, true), eq(slaPolicies.isActive, true)))
          .limit(1);
        slaPolicyId = fallback?.id;
      }

      const policy = toPolicy(
        slaPolicyId
          ? (await tx.select().from(slaPolicies).where(eq(slaPolicies.id, slaPolicyId)).limit(1))[0]
          : undefined
      );

      const now = new Date();
      const priority = input.priority ?? "normal";

      const status = slaStatus(
        { createdAt: now, priority, pauses: [] },
        policy,
        now
      );

      const [created] = await tx
        .insert(tickets)
        .values({
          orgId: this.ctx.orgId,
          reference: reference(),
          subject: input.subject,
          body: input.body,
          requesterId: input.requesterId,
          raisedById: input.raisedById,
          categoryId: input.categoryId,
          slaPolicyId,
          teamId,
          priority,
          isConfidential,
          tags: input.tags ?? [],
          responseDueAt: status.responseDueAt,
          resolutionDueAt: status.resolutionDueAt,
        })
        .returning();

      await tx.insert(ticketEvents).values({
        orgId: this.ctx.orgId,
        ticketId: created.id,
        eventType: "created",
        toValue: "new",
        actorId: input.raisedById ?? input.requesterId,
      });

      return this.toRecord(created);
    });
  }

  /**
   * Tickets visible to one person.
   *
   * The confidentiality filter is a WHERE clause, not a post-filter on the
   * result. Fetching everything and hiding some of it in the response builder
   * is one refactor away from a leak, and the thing leaked is a harassment
   * complaint.
   */
  async listVisible(
    viewerId: string,
    viewerRole: string,
    options: { state?: TicketState; assignedToMe?: boolean; breachRisk?: boolean } = {}
  ): Promise<TicketRecord[]> {
    const canSeeConfidential = ["owner", "hr"].includes(viewerRole);
    const isAgent = ["owner", "admin", "hr", "manager"].includes(viewerRole);

    return withTenant(this.ctx, async (tx) => {
      const visibility = canSeeConfidential
        ? undefined
        : isAgent
          ? // An agent sees non-confidential tickets, plus their own, plus any
            // assigned to them. A confidential ticket they raised is still
            // theirs to see.
            or(
              eq(tickets.isConfidential, false),
              eq(tickets.requesterId, viewerId),
              eq(tickets.assigneeId, viewerId)
            )
          : or(eq(tickets.requesterId, viewerId), eq(tickets.assigneeId, viewerId));

      const rows = await tx
        .select({ t: tickets, first: employees.firstName, last: employees.lastName })
        .from(tickets)
        .leftJoin(employees, eq(employees.id, tickets.requesterId))
        .where(
          and(
            visibility,
            options.state ? eq(tickets.state, options.state) : undefined,
            options.assignedToMe ? eq(tickets.assigneeId, viewerId) : undefined,
            options.breachRisk
              ? or(eq(tickets.resolutionBreached, true), eq(tickets.responseBreached, true))
              : undefined
          )
        )
        .orderBy(asc(tickets.resolutionDueAt), desc(tickets.createdAt))
        .limit(500);

      return rows.map((r) => ({
        ...this.toRecord(r.t),
        requesterName: r.first && r.last ? `${r.first} ${r.last}` : undefined,
      }));
    });
  }

  /**
   * One ticket with its conversation.
   *
   * Internal notes are filtered out for a non-agent. The distinction is
   * structural rather than conventional: an internal note shown to a requester
   * is how a disciplinary discussion reaches the person it is about.
   */
  async getTicket(
    ticketId: string,
    viewerId: string,
    viewerRole: string
  ): Promise<{
    ticket: TicketRecord;
    comments: {
      id: string;
      authorId?: string;
      body: string;
      isInternal: boolean;
      createdAt: string;
    }[];
    events: { eventType: string; fromValue?: string; toValue?: string; occurredAt: string }[];
    sla: ReturnType<typeof slaStatus>;
  }> {
    const isAgent = ["owner", "admin", "hr", "manager"].includes(viewerRole);
    const canSeeConfidential = ["owner", "hr"].includes(viewerRole);

    return withTenant(this.ctx, async (tx) => {
      const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
      if (!ticket) throw new NotFoundError("Ticket", ticketId);

      const isParty = ticket.requesterId === viewerId || ticket.assigneeId === viewerId;

      if (ticket.isConfidential && !canSeeConfidential && !isParty) {
        // A 404 rather than a 403: confirming that a confidential ticket
        // exists is itself a disclosure.
        throw new NotFoundError("Ticket", ticketId);
      }
      if (!isAgent && !isParty) {
        throw new NotFoundError("Ticket", ticketId);
      }

      const comments = await tx
        .select()
        .from(ticketComments)
        .where(
          and(
            eq(ticketComments.ticketId, ticketId),
            isAgent ? undefined : eq(ticketComments.isInternal, false)
          )
        )
        .orderBy(asc(ticketComments.createdAt));

      const events = await tx
        .select()
        .from(ticketEvents)
        .where(eq(ticketEvents.ticketId, ticketId))
        .orderBy(asc(ticketEvents.occurredAt));

      const sla = await this.statusFor(tx, ticket);

      return {
        ticket: this.toRecord(ticket),
        comments: comments.map((c) => ({
          id: c.id,
          authorId: c.authorId ?? undefined,
          body: c.body,
          isInternal: c.isInternal,
          createdAt: c.createdAt.toISOString(),
        })),
        events: events.map((e) => ({
          eventType: e.eventType,
          fromValue: e.fromValue ?? undefined,
          toValue: e.toValue ?? undefined,
          occurredAt: e.occurredAt.toISOString(),
        })),
        sla,
      };
    });
  }

  /**
   * Adds a comment, and records the first agent reply as the SLA response.
   *
   * The requester's own follow-up does not stop the response clock. Counting
   * it would let a ticket report as answered when nobody has answered it.
   */
  async comment(
    ticketId: string,
    authorId: string,
    body: string,
    options: { isInternal?: boolean; isAgent: boolean }
  ): Promise<{ firstResponse: boolean }> {
    return withTenant(this.ctx, async (tx) => {
      const [ticket] = await tx
        .select()
        .from(tickets)
        .where(eq(tickets.id, ticketId))
        .for("update")
        .limit(1);

      if (!ticket) throw new NotFoundError("Ticket", ticketId);
      if (ticket.state === "closed") {
        throw new RepositoryError("This ticket is closed", 409);
      }
      if (options.isInternal && !options.isAgent) {
        throw new RepositoryError("You cannot add an internal note", 403);
      }

      await tx.insert(ticketComments).values({
        orgId: this.ctx.orgId,
        ticketId,
        authorId,
        body,
        isInternal: options.isInternal ?? false,
      });

      const isFirstResponse =
        options.isAgent &&
        !options.isInternal &&
        !ticket.firstRespondedAt &&
        authorId !== ticket.requesterId;

      if (isFirstResponse) {
        await tx
          .update(tickets)
          .set({ firstRespondedAt: new Date(), updatedAt: new Date() })
          .where(eq(tickets.id, ticketId));

        await tx.insert(ticketEvents).values({
          orgId: this.ctx.orgId,
          ticketId,
          eventType: "first_response",
          actorId: authorId,
        });
      }

      // A requester replying resumes the clock: they no longer owe anything.
      if (!options.isAgent && ticket.state === "pending_requester") {
        await this.resumeIn(tx, ticketId);
        await tx
          .update(tickets)
          .set({ state: "open", updatedAt: new Date() })
          .where(eq(tickets.id, ticketId));
      }

      return { firstResponse: isFirstResponse };
    });
  }

  /** Moves a ticket between states, pausing or resuming the clock as required. */
  async transition(
    ticketId: string,
    to: TicketState,
    actorId: string
  ): Promise<TicketRecord> {
    return withTenant(this.ctx, async (tx) => {
      const [ticket] = await tx
        .select()
        .from(tickets)
        .where(eq(tickets.id, ticketId))
        .for("update")
        .limit(1);

      if (!ticket) throw new NotFoundError("Ticket", ticketId);
      if (ticket.state === to) return this.toRecord(ticket);

      if (ticket.state === "closed" && to !== "open") {
        throw new RepositoryError("A closed ticket can only be reopened", 409);
      }

      const wasPaused = clockPaused(ticket.state);
      const nowPaused = clockPaused(to);

      if (!wasPaused && nowPaused) {
        await tx.insert(ticketPauses).values({
          orgId: this.ctx.orgId,
          ticketId,
          pausedAt: new Date(),
          reason: to,
        });
      }
      if (wasPaused && !nowPaused) {
        await this.resumeIn(tx, ticketId);
      }

      const changes: Partial<typeof tickets.$inferInsert> = {
        state: to,
        updatedAt: new Date(),
      };

      if (to === "resolved" && !ticket.resolvedAt) changes.resolvedAt = new Date();
      if (to === "closed") changes.closedAt = new Date();

      if (to === "open" && ticket.state === "closed") {
        // Reopening clears the resolution stamp: the ticket is not resolved,
        // and leaving it would report a resolution time for work still to do.
        changes.resolvedAt = null;
        changes.closedAt = null;
        changes.reopenedCount = ticket.reopenedCount + 1;
      }

      const [updated] = await tx
        .update(tickets)
        .set(changes)
        .where(eq(tickets.id, ticketId))
        .returning();

      await tx.insert(ticketEvents).values({
        orgId: this.ctx.orgId,
        ticketId,
        eventType: "state_changed",
        fromValue: ticket.state,
        toValue: to,
        actorId,
      });

      return this.toRecord(updated);
    });
  }

  /**
   * Records the requester's satisfaction rating.
   *
   * Only once. Allowing a re-rate would let a dissatisfied requester be talked
   * into revising it, which is exactly the pressure the metric exists to
   * detect.
   */
  async rate(
    ticketId: string,
    rating: number,
    comment?: string
  ): Promise<TicketRecord> {
    return withTenant(this.ctx, async (tx) => {
      const [ticket] = await tx
        .select()
        .from(tickets)
        .where(eq(tickets.id, ticketId))
        .for("update")
        .limit(1);

      if (!ticket) throw new NotFoundError("Ticket", ticketId);
      if (ticket.satisfactionRating !== null) {
        throw new RepositoryError("This ticket has already been rated", 409);
      }

      const [updated] = await tx
        .update(tickets)
        .set({
          satisfactionRating: rating,
          satisfactionComment: comment,
          updatedAt: new Date(),
        })
        .where(eq(tickets.id, ticketId))
        .returning();

      await tx.insert(ticketEvents).values({
        orgId: this.ctx.orgId,
        ticketId,
        eventType: "rated",
        toValue: String(rating),
        actorId: ticket.requesterId,
      });

      return this.toRecord(updated);
    });
  }

  async assign(ticketId: string, assigneeId: string, actorId: string): Promise<TicketRecord> {    return withTenant(this.ctx, async (tx) => {
      const [ticket] = await tx
        .select()
        .from(tickets)
        .where(eq(tickets.id, ticketId))
        .for("update")
        .limit(1);

      if (!ticket) throw new NotFoundError("Ticket", ticketId);

      const [updated] = await tx
        .update(tickets)
        .set({
          assigneeId,
          // Picking up a new ticket moves it out of the unclaimed queue.
          state: ticket.state === "new" ? "open" : ticket.state,
          updatedAt: new Date(),
        })
        .where(eq(tickets.id, ticketId))
        .returning();

      await tx.insert(ticketEvents).values({
        orgId: this.ctx.orgId,
        ticketId,
        eventType: "assigned",
        fromValue: ticket.assigneeId ?? undefined,
        toValue: assigneeId,
        actorId,
      });

      return this.toRecord(updated);
    });
  }

  /**
   * Recomputes SLA state and fires any escalations now due.
   *
   * Idempotent by design: fired escalations are recorded on the ticket, so
   * running this every minute does not re-notify. An engine that re-fires
   * teaches people to mute the channel, and then they miss the real one.
   */
  async runEscalations(now = new Date()): Promise<{
    scanned: number;
    escalated: { ticketId: string; reference: string; action: string; target: string }[];
  }> {
    return withTenant(this.ctx, async (tx) => {
      const open = await tx
        .select()
        .from(tickets)
        .where(inArray(tickets.state, ["new", "open", "pending_third_party"]))
        .limit(2000);

      const policies = await tx.select().from(slaPolicies);
      const byId = new Map(policies.map((p) => [p.id, p]));

      const escalated: {
        ticketId: string;
        reference: string;
        action: string;
        target: string;
      }[] = [];

      for (const ticket of open) {
        const policyRow = ticket.slaPolicyId ? byId.get(ticket.slaPolicyId) : undefined;
        const status = await this.statusFor(tx, ticket, now);

        const rules = ((policyRow?.escalations ?? []) as EscalationRule[]).filter(
          (r) => typeof r.atConsumed === "number"
        );

        const due = dueEscalations(
          status,
          rules,
          (ticket.firedEscalations as string[]) ?? []
        );

        const changes: Partial<typeof tickets.$inferInsert> = {
          responseDueAt: status.responseDueAt,
          resolutionDueAt: status.resolutionDueAt,
          responseBreached: status.responseBreached,
          resolutionBreached: status.resolutionBreached,
          updatedAt: new Date(),
        };

        if (due.length > 0) {
          changes.firedEscalations = [
            ...((ticket.firedEscalations as string[]) ?? []),
            ...due.map((e) => escalationKey(e.rule)),
          ];

          if (due.some((e) => e.action === "raise_priority")) {
            changes.priority = raisePriority(ticket.priority);
          }

          for (const event of due) {
            await tx.insert(ticketEvents).values({
              orgId: this.ctx.orgId,
              ticketId: ticket.id,
              eventType: "escalated",
              toValue: event.action,
              detail: `${event.target} clock at ${Math.round(event.consumed * 100)}% of target`,
            });

            escalated.push({
              ticketId: ticket.id,
              reference: ticket.reference,
              action: event.action,
              target: event.target,
            });
          }
        }

        await tx.update(tickets).set(changes).where(eq(tickets.id, ticket.id));
      }

      return { scanned: open.length, escalated };
    });
  }

  /** Articles matching a query, for deflection before a ticket is raised. */
  async searchKnowledge(query: string, viewerRole: string, limit = 5) {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9]/g, ""))
      .filter((t) => t.length > 2);

    if (terms.length === 0) return [];

    return withTenant(this.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(knowledgeArticles)
        .where(eq(knowledgeArticles.isPublished, true))
        .limit(500);

      return rows
        .filter((a) => {
          const roles = (a.visibleToRoles as string[]) ?? [];
          return roles.length === 0 || roles.includes(viewerRole);
        })
        .map((a) => {
          const haystack = `${a.title} ${a.summary ?? ""} ${(a.keywords as string[]).join(" ")}`
            .toLowerCase();

          // Title and keyword hits count double: an article whose title
          // matches is far likelier to be the answer than one that mentions
          // the word once in its body.
          const score =
            terms.filter((t) => a.title.toLowerCase().includes(t)).length * 2 +
            terms.filter((t) => haystack.includes(t)).length;

          return { article: a, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((r) => ({
          id: r.article.id,
          title: r.article.title,
          slug: r.article.slug,
          summary: r.article.summary ?? undefined,
          helpfulCount: r.article.helpfulCount,
        }));
    });
  }

  // ─── Internals ─────────────────────────────────────────────

  private async statusFor(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    ticket: typeof tickets.$inferSelect,
    now = new Date()
  ) {
    const [policyRow] = ticket.slaPolicyId
      ? await tx.select().from(slaPolicies).where(eq(slaPolicies.id, ticket.slaPolicyId)).limit(1)
      : [];

    const pauses = await tx
      .select()
      .from(ticketPauses)
      .where(eq(ticketPauses.ticketId, ticket.id));

    return slaStatus(
      {
        createdAt: ticket.createdAt,
        firstRespondedAt: ticket.firstRespondedAt ?? undefined,
        resolvedAt: ticket.resolvedAt ?? undefined,
        priority: ticket.priority,
        pauses: pauses.map((p) => ({ from: p.pausedAt, to: p.resumedAt ?? undefined })),
      },
      toPolicy(policyRow),
      now
    );
  }

  private async resumeIn(
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    ticketId: string
  ): Promise<void> {
    await tx
      .update(ticketPauses)
      .set({ resumedAt: new Date() })
      .where(and(eq(ticketPauses.ticketId, ticketId), isNull(ticketPauses.resumedAt)));
  }

  private toRecord(row: typeof tickets.$inferSelect): TicketRecord {
    return {
      id: row.id,
      reference: row.reference,
      subject: row.subject,
      body: row.body,
      requesterId: row.requesterId,
      assigneeId: row.assigneeId ?? undefined,
      priority: row.priority,
      state: row.state,
      isConfidential: row.isConfidential,
      createdAt: row.createdAt.toISOString(),
      responseDueAt: row.responseDueAt?.toISOString(),
      resolutionDueAt: row.resolutionDueAt?.toISOString(),
      responseBreached: row.responseBreached,
      resolutionBreached: row.resolutionBreached,
      tags: (row.tags as string[]) ?? [],
    };
  }
}

