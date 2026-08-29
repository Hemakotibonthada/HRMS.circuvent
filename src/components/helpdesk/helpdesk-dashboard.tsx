"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Headphones,
  Plus,
  Search,
  Clock,
  AlertTriangle,
  MessageSquare,
  UserPlus,
  RefreshCw,
  Shield,
  Star,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { useAuth } from "@/hooks/use-auth";
import { useRBAC } from "@/hooks/use-rbac";
import { useNowMs } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import {
  addComment,
  assignTicket,
  createTicket,
  getTicket,
  listCategories,
  listTickets,
  rateTicket,
  runEscalations,
  searchEmployees,
  searchKnowledge,
  transitionTicket,
  type KnowledgeArticle,
  type TicketCategory,
  type TicketDetail,
  type TicketListItem,
  type TicketSummary,
} from "@/lib/helpdesk-client";
import {
  SELECTABLE_PRIORITIES,
  TONE_BADGE,
  dueState,
  isSettled,
  priorityLabel,
  priorityTone,
  stateLabel,
  stateTone,
  validateTicket,
  type TicketPriority,
  type TicketState,
} from "@/lib/helpdesk-rules";

type TabKey = "live" | "waiting" | "mine" | "queue" | "risk" | "resolved" | "all";

function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ToneBadge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <Badge
      variant="secondary"
      className={cn("font-normal", TONE_BADGE[tone as keyof typeof TONE_BADGE] ?? TONE_BADGE.neutral)}
    >
      {children}
    </Badge>
  );
}

export function HelpdeskDashboard() {
  const { user } = useAuth();
  const rbac = useRBAC();
  const now = useNowMs(30_000) ?? 0;
  const canManage = rbac.can("helpdesk.manage");
  const isAgent = canManage || rbac.isManager;
  const employeeId = user?.employeeId ?? null;

  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [summary, setSummary] = useState<TicketSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>("live");
  const [search, setSearch] = useState("");

  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    subject: "",
    body: "",
    categoryId: "",
    priority: "normal" as TicketPriority,
  });
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [kbHints, setKbHints] = useState<KnowledgeArticle[]>([]);
  const [creating, setCreating] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [sending, setSending] = useState(false);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignSearch, setAssignSearch] = useState("");
  const [assignOptions, setAssignOptions] = useState<{ id: string; fullName: string }[]>([]);
  const [assigning, setAssigning] = useState(false);

  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState("");

  const loadList = useCallback(async () => {
    try {
      const data = await listTickets();
      setTickets(data.tickets);
      setSummary(data.summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load tickets");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await getTicket(id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load ticket");
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
    void listCategories()
      .then(setCategories)
      .catch(() => {});
  }, [loadList]);

  useEffect(() => {
    if (!createOpen) return;
    void listCategories()
      .then((loaded) => {
        setCategories(loaded);
        setCreateForm((f) => ({
          ...f,
          categoryId:
            f.categoryId && loaded.some((category) => category.id === f.categoryId) ? f.categoryId : "",
        }));
      })
      .catch(() => {});
  }, [createOpen]);

  const createCategoryLabel = useMemo(() => {
    if (!createForm.categoryId) return "General";
    return categories.find((category) => category.id === createForm.categoryId)?.name ?? "General";
  }, [createForm.categoryId, categories]);

  const createCategoryValue = useMemo(() => {
    if (!createForm.categoryId) return "none";
    return categories.some((category) => category.id === createForm.categoryId)
      ? createForm.categoryId
      : "none";
  }, [createForm.categoryId, categories]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    const q = createForm.subject.trim();
    if (q.length < 3) {
      setKbHints([]);
      return;
    }
    const timer = setTimeout(() => {
      void searchKnowledge(q).then(setKbHints);
    }, 350);
    return () => clearTimeout(timer);
  }, [createForm.subject]);

  useEffect(() => {
    if (!assignOpen) return;
    const timer = setTimeout(() => {
      void searchEmployees(assignSearch).then(setAssignOptions);
    }, 250);
    return () => clearTimeout(timer);
  }, [assignOpen, assignSearch]);

  const filtered = useMemo(() => {
    let list = tickets;
    if (tab === "live") list = list.filter((t) => !isSettled(t.state));
    if (tab === "waiting") list = list.filter((t) => t.state === "pending_requester");
    if (tab === "mine" && employeeId) list = list.filter((t) => t.requesterId === employeeId);
    if (tab === "queue") list = list.filter((t) => t.state === "new" && !t.assigneeId);
    if (tab === "risk")
      list = list.filter((t) => t.responseBreached || t.resolutionBreached);
    if (tab === "resolved") list = list.filter((t) => isSettled(t.state));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          t.reference.toLowerCase().includes(q) ||
          t.requesterName?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [tickets, tab, employeeId, search]);

  const handleCreate = async () => {
    const errors = validateTicket(createForm);
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setCreating(true);
    try {
      const ticket = await createTicket({
        subject: createForm.subject.trim(),
        body: createForm.body.trim(),
        categoryId: createForm.categoryId || undefined,
        priority: createForm.priority,
      });
      toast.success(`Ticket ${ticket.reference} created`);
      setCreateOpen(false);
      setCreateForm({ subject: "", body: "", categoryId: "", priority: "normal" });
      await loadList();
      setSelectedId(ticket.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create ticket");
    } finally {
      setCreating(false);
    }
  };

  const handleReply = async () => {
    if (!selectedId || !reply.trim()) return;
    setSending(true);
    try {
      await addComment(selectedId, reply.trim(), internalNote && isAgent);
      setReply("");
      setInternalNote(false);
      await loadDetail(selectedId);
      await loadList();
      toast.success(internalNote ? "Internal note added" : "Reply sent");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send reply");
    } finally {
      setSending(false);
    }
  };

  const handleTransition = async (state: TicketState) => {
    if (!selectedId) return;
    try {
      await transitionTicket(selectedId, state);
      await loadDetail(selectedId);
      await loadList();
      toast.success(`Ticket marked ${stateLabel(state).toLowerCase()}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update ticket");
    }
  };

  const handleAssign = async (assigneeId: string) => {
    if (!selectedId) return;
    setAssigning(true);
    try {
      await assignTicket(selectedId, assigneeId);
      setAssignOpen(false);
      await loadDetail(selectedId);
      await loadList();
      toast.success("Ticket assigned");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not assign");
    } finally {
      setAssigning(false);
    }
  };

  const handleRate = async () => {
    if (!selectedId || rating < 1) return;
    try {
      await rateTicket(selectedId, rating, ratingComment.trim() || undefined);
      await loadDetail(selectedId);
      toast.success("Thank you for your feedback");
      setRating(0);
      setRatingComment("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit rating");
    }
  };

  const handleEscalationSweep = async () => {
    try {
      const result = await runEscalations();
      toast.success(
        `Escalation sweep: ${result.escalated.length} escalated of ${result.scanned} scanned`
      );
      await loadList();
      if (selectedId) await loadDetail(selectedId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Escalation sweep failed");
    }
  };

  if (loading) return <DataLoadingSkeleton />;

  const kpis = [
    { label: "Open", value: summary?.open ?? 0, icon: Clock },
    { label: "Waiting", value: summary?.waiting ?? 0, icon: MessageSquare },
    { label: "Resolved", value: summary?.resolved ?? 0, icon: Headphones },
    { label: "SLA breached", value: summary?.breached ?? 0, icon: AlertTriangle },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Helpdesk</h1>
          <p className="text-sm text-muted-foreground">
            Raise requests, track SLA, and work the queue — same system as the mobile app.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              void loadList();
            }}
          >
            <RefreshCw className={cn("mr-1 h-4 w-4", refreshing && "animate-spin")} />
            Refresh
          </Button>
          {(rbac.isAdmin || user?.role === "owner") && (
            <Button variant="outline" size="sm" onClick={() => void handleEscalationSweep()}>
              Run SLA sweep
            </Button>
          )}
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            New ticket
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="flex items-center gap-3 pt-4">
              <div className="rounded-lg bg-violet-100 p-2 dark:bg-violet-950/50">
                <kpi.icon className="h-4 w-4 text-violet-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{kpi.value}</p>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by subject, reference or requester…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="live">Live</TabsTrigger>
          <TabsTrigger value="waiting">Waiting for me</TabsTrigger>
          <TabsTrigger value="mine">My tickets</TabsTrigger>
          {isAgent && <TabsTrigger value="queue">Unassigned</TabsTrigger>}
          {isAgent && <TabsTrigger value="risk">SLA risk</TabsTrigger>}
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {filtered.length === 0 ? (
            <DataEmptyState {...EMPTY_STATES.helpdesk} />
          ) : (
            <div className="divide-y rounded-lg border">
              {filtered.map((ticket) => {
                const due =
                  now > 0
                    ? dueState(
                        ticket.resolutionDueAt,
                        new Date(now),
                        ticket.resolutionBreached,
                        isSettled(ticket.state)
                      )
                    : undefined;
                return (
                  <button
                    key={ticket.id}
                    type="button"
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                    onClick={() => setSelectedId(ticket.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {ticket.reference}
                        </span>
                        <ToneBadge tone={stateTone(ticket.state)}>
                          {stateLabel(ticket.state)}
                        </ToneBadge>
                        <ToneBadge tone={priorityTone(ticket.priority)}>
                          {priorityLabel(ticket.priority)}
                        </ToneBadge>
                        {ticket.isConfidential && (
                          <Badge variant="outline" className="gap-1">
                            <Shield className="h-3 w-3" />
                            Confidential
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm font-medium">{ticket.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        {ticket.requesterName ?? "Employee"} · {formatWhen(ticket.createdAt)}
                        {due ? ` · ${due.text}` : ""}
                      </p>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ENHANCED CREATE TICKET DIALOG */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <Headphones className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Raise Support Ticket</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Submit an IT hardware, software access, or HR support incident.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="subject" className="text-xs font-semibold">Subject / Issue Summary <span className="text-destructive">*</span></Label>
              <Input
                id="subject"
                placeholder="e.g. Need VPN certificate reset for remote work"
                value={createForm.subject}
                onChange={(e) => setCreateForm((f) => ({ ...f, subject: e.target.value }))}
                className="h-9 text-xs"
              />
              {createErrors.subject && (
                <p className="text-xs text-destructive">{createErrors.subject}</p>
              )}
            </div>

            {kbHints.length > 0 && (
              <div className="rounded-xl border bg-muted/30 p-3 text-xs">
                <p className="mb-1.5 font-semibold text-foreground">Before you submit — these articles may help:</p>
                <ul className="space-y-1">
                  {kbHints.slice(0, 3).map((a) => (
                    <li key={a.id} className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
                      &bull; {a.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="body" className="text-xs font-semibold">Detailed Description &amp; Steps to Reproduce <span className="text-destructive">*</span></Label>
              <Textarea
                id="body"
                rows={4}
                placeholder="Describe what happened, what device or system you are using, and the error messages received..."
                value={createForm.body}
                onChange={(e) => setCreateForm((f) => ({ ...f, body: e.target.value }))}
                className="text-xs resize-none"
              />
              {createErrors.body && (
                <p className="text-xs text-destructive">{createErrors.body}</p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Helpdesk Category</Label>
                <Select
                  value={createCategoryValue}
                  onValueChange={(v) =>
                    setCreateForm((f) => ({ ...f, categoryId: v === "none" ? "" : v }))
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <span className="truncate">{createCategoryLabel}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">General Support</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">
                        {c.name}
                        {c.isConfidential ? " (confidential)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Priority Level</Label>
                <Select
                  value={createForm.priority}
                  onValueChange={(v) =>
                    setCreateForm((f) => ({ ...f, priority: v as TicketPriority }))
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SELECTABLE_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p} className="text-xs">
                        {priorityLabel(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2 gap-2">
            <Button variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={creating}
              onClick={() => void handleCreate()}
              className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all gap-1.5"
            >
              {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Submit Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ticket detail */}
      <Dialog open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 p-0">
          {detailLoading || !detail ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <DialogHeader className="border-b px-6 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {detail.ticket.reference}
                  </span>
                  <ToneBadge tone={stateTone(detail.ticket.state)}>
                    {stateLabel(detail.ticket.state)}
                  </ToneBadge>
                  <ToneBadge tone={priorityTone(detail.ticket.priority)}>
                    {priorityLabel(detail.ticket.priority)}
                  </ToneBadge>
                </div>
                <DialogTitle className="text-left">{detail.ticket.subject}</DialogTitle>
                {now > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {dueState(
                      detail.sla.resolutionDueAt,
                      new Date(now),
                      detail.sla.resolutionBreached,
                      isSettled(detail.ticket.state)
                    )?.text ?? "No active SLA deadline"}
                  </p>
                )}
              </DialogHeader>

              <ScrollArea className="max-h-[50vh] flex-1 px-6">
                <div className="space-y-4 py-4">
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm">Original request</CardTitle>
                    </CardHeader>
                    <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {detail.ticket.body}
                    </CardContent>
                  </Card>

                  <div className="space-y-3">
                    <p className="text-sm font-medium">Conversation</p>
                    {detail.comments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No replies yet.</p>
                    ) : (
                      detail.comments.map((c) => (
                        <div
                          key={c.id}
                          className={cn(
                            "rounded-lg border p-3 text-sm",
                            c.isInternal && "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                          )}
                        >
                          {c.isInternal && (
                            <p className="mb-1 text-xs font-medium text-amber-800 dark:text-amber-200">
                              Internal note
                            </p>
                          )}
                          <p className="whitespace-pre-wrap">{c.body}</p>
                          <p className="mt-2 text-xs text-muted-foreground">{formatWhen(c.createdAt)}</p>
                        </div>
                      ))
                    )}
                  </div>

                  {detail.events.length > 0 && isAgent && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Activity</p>
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {detail.events.map((e, i) => (
                          <li key={`${e.occurredAt}-${i}`}>
                            {e.eventType.replace(/_/g, " ")}
                            {e.fromValue && e.toValue
                              ? `: ${e.fromValue} → ${e.toValue}`
                              : ""}{" "}
                            · {formatWhen(e.occurredAt)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="space-y-3 border-t px-6 py-4">
                {!isSettled(detail.ticket.state) && (
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Write a reply…"
                      rows={3}
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                    />
                    {isAgent && (
                      <div className="flex items-center gap-2 text-sm">
                        <Checkbox
                          id="helpdesk-internal-note"
                          checked={internalNote}
                          onCheckedChange={(v) => setInternalNote(v === true)}
                        />
                        <Label htmlFor="helpdesk-internal-note" className="font-normal cursor-pointer">
                          Internal note (not visible to requester)
                        </Label>
                      </div>
                    )}
                    <Button size="sm" disabled={sending || !reply.trim()} onClick={() => void handleReply()}>
                      {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                      Send
                    </Button>
                  </div>
                )}

                {isAgent && !isSettled(detail.ticket.state) && (
                  <div className="flex flex-wrap gap-2">
                    {detail.ticket.state === "new" && (
                      <Button size="sm" variant="secondary" onClick={() => void handleTransition("open")}>
                        Pick up
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
                      <UserPlus className="mr-1 h-3.5 w-3.5" />
                      Assign
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleTransition("pending_requester")}
                    >
                      Wait on requester
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleTransition("pending_third_party")}
                    >
                      Wait on vendor
                    </Button>
                    <Button size="sm" onClick={() => void handleTransition("resolved")}>
                      Resolve
                    </Button>
                  </div>
                )}

                {detail.ticket.requesterId === employeeId &&
                  detail.ticket.state === "pending_requester" && (
                    <Button size="sm" onClick={() => void handleTransition("open")}>
                      I have replied — resume ticket
                    </Button>
                  )}

                {detail.ticket.requesterId === employeeId && !isSettled(detail.ticket.state) && (
                  <Button size="sm" variant="ghost" onClick={() => void handleTransition("closed")}>
                    Close ticket
                  </Button>
                )}

                {isSettled(detail.ticket.state) &&
                  detail.ticket.requesterId === employeeId && (
                    <div className="space-y-2 rounded-lg border p-3">
                      <p className="text-sm font-medium">How was your experience?</p>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setRating(n)}
                            className="rounded p-1 hover:bg-muted"
                          >
                            <Star
                              className={cn(
                                "h-5 w-5",
                                n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"
                              )}
                            />
                          </button>
                        ))}
                      </div>
                      <Input
                        placeholder="Optional comment"
                        value={ratingComment}
                        onChange={(e) => setRatingComment(e.target.value)}
                      />
                      <Button size="sm" disabled={rating < 1} onClick={() => void handleRate()}>
                        Submit rating
                      </Button>
                    </div>
                  )}

                {isSettled(detail.ticket.state) && isAgent && (
                  <Button size="sm" variant="outline" onClick={() => void handleTransition("open")}>
                    Reopen
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Assign */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign ticket</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Search employees…"
            value={assignSearch}
            onChange={(e) => setAssignSearch(e.target.value)}
          />
          <Separator />
          <ScrollArea className="max-h-48">
            <div className="space-y-1">
              {assignOptions.map((e) => (
                <Button
                  key={e.id}
                  variant="ghost"
                  className="w-full justify-start"
                  disabled={assigning}
                  onClick={() => void handleAssign(e.id)}
                >
                  {e.fullName}
                </Button>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
