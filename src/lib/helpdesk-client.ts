// Client for /api/helpdesk — the web dashboard talks here, not through collection-service.

import type { TicketPriority, TicketState } from "@/lib/helpdesk-rules";

export interface TicketSummary {
  total: number;
  open: number;
  waiting: number;
  resolved: number;
  breached: number;
}

export interface TicketListItem {
  id: string;
  reference: string;
  subject: string;
  body?: string;
  requesterId: string;
  requesterName?: string;
  assigneeId?: string;
  priority: TicketPriority;
  state: TicketState;
  isConfidential: boolean;
  createdAt: string;
  responseDueAt?: string;
  resolutionDueAt?: string;
  responseBreached: boolean;
  resolutionBreached: boolean;
  resolutionConsumed?: number;
  tags: string[];
}

export interface TicketComment {
  id: string;
  authorId?: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

export interface TicketEvent {
  eventType: string;
  fromValue?: string;
  toValue?: string;
  occurredAt: string;
}

export interface TicketDetail {
  ticket: TicketListItem & { body: string };
  comments: TicketComment[];
  events: TicketEvent[];
  sla: {
    responseDueAt: string;
    resolutionDueAt: string;
    responseBreached: boolean;
    resolutionBreached: boolean;
    resolutionConsumed: number;
  };
}

export interface TicketCategory {
  id: string;
  name: string;
  isConfidential: boolean;
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  summary?: string;
  score: number;
}

export interface ListTicketsOptions {
  state?: TicketState;
  assignedToMe?: boolean;
  breachRisk?: boolean;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

export async function listTickets(
  opts: ListTicketsOptions = {}
): Promise<{ tickets: TicketListItem[]; summary: TicketSummary }> {
  const params = new URLSearchParams();
  if (opts.state) params.set("state", opts.state);
  if (opts.assignedToMe) params.set("assignedToMe", "true");
  if (opts.breachRisk) params.set("breachRisk", "true");
  const qs = params.toString();

  const res = await fetch(`/api/helpdesk${qs ? `?${qs}` : ""}`, { credentials: "include" });
  if (!res.ok) throw new Error(await readError(res, "Could not load tickets"));
  return (await res.json()) as { tickets: TicketListItem[]; summary: TicketSummary };
}

export async function listCategories(): Promise<TicketCategory[]> {
  const res = await fetch("/api/helpdesk/categories", { credentials: "include" });
  if (!res.ok) throw new Error(await readError(res, "Could not load categories"));
  const body = (await res.json()) as { categories: TicketCategory[] };
  return body.categories ?? [];
}

export async function searchKnowledge(query: string): Promise<KnowledgeArticle[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const res = await fetch(`/api/helpdesk/knowledge?q=${encodeURIComponent(q)}`, {
    credentials: "include",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { articles: KnowledgeArticle[] };
  return body.articles ?? [];
}

export async function createTicket(input: {
  subject: string;
  body: string;
  categoryId?: string;
  priority?: TicketPriority;
  requesterId?: string;
  tags?: string[];
}): Promise<TicketListItem> {
  const res = await fetch("/api/helpdesk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not create ticket"));
  return (await res.json()) as TicketListItem;
}

export async function getTicket(id: string): Promise<TicketDetail> {
  const res = await fetch(`/api/helpdesk/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error(await readError(res, "Could not load ticket"));
  return (await res.json()) as TicketDetail;
}

export async function addComment(
  ticketId: string,
  body: string,
  isInternal = false
): Promise<void> {
  const res = await fetch(`/api/helpdesk/${ticketId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ body, isInternal }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not send reply"));
}

export async function transitionTicket(
  ticketId: string,
  state: TicketState
): Promise<TicketListItem> {
  const res = await fetch(`/api/helpdesk/${ticketId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ action: "transition", state }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not update ticket"));
  return (await res.json()) as TicketListItem;
}

export async function assignTicket(
  ticketId: string,
  assigneeId: string
): Promise<TicketListItem> {
  const res = await fetch(`/api/helpdesk/${ticketId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ action: "assign", assigneeId }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not assign ticket"));
  return (await res.json()) as TicketListItem;
}

export async function rateTicket(
  ticketId: string,
  rating: number,
  comment?: string
): Promise<TicketListItem> {
  const res = await fetch(`/api/helpdesk/${ticketId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ action: "rate", rating, comment }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not submit rating"));
  return (await res.json()) as TicketListItem;
}

export async function runEscalations(): Promise<{ scanned: number; escalated: unknown[] }> {
  const res = await fetch("/api/helpdesk/escalations", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(await readError(res, "Escalation sweep failed"));
  return (await res.json()) as { scanned: number; escalated: unknown[] };
}

export interface EmployeeOption {
  id: string;
  fullName: string;
  employeeCode?: string;
}

export async function searchEmployees(query: string): Promise<EmployeeOption[]> {
  const params = new URLSearchParams({ pageSize: "20" });
  if (query.trim()) params.set("search", query.trim());
  const res = await fetch(`/api/employees?${params}`, { credentials: "include" });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    items?: { id: string; fullName?: string; firstName?: string; lastName?: string; employeeCode?: string }[];
  };
  return (body.items ?? []).map((e) => ({
    id: e.id,
    fullName: e.fullName ?? `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim(),
    employeeCode: e.employeeCode,
  }));
}
