import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { Skeleton } from "@/components/Skeleton";
import { StatusPill } from "@/components/StatusPill";
import { TextField } from "@/components/TextField";
import { AppText } from "@/components/Typography";
import { ApiError, OfflineError } from "@/lib/contracts";
import {
  dueState,
  isSettled,
  priorityLabel,
  priorityTone,
  stateLabel,
  stateTone,
  type Tone,
} from "@/lib/helpdesk-rules";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

interface Ticket {
  id: string;
  reference: string;
  subject: string;
  body: string;
  requesterId: string;
  priority: string;
  state: string;
  createdAt: string;
  resolutionDueAt?: string;
  responseBreached: boolean;
  resolutionBreached: boolean;
  tags: string[];
}

interface Comment {
  id: string;
  authorId?: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

interface TicketDetail {
  ticket: Ticket;
  comments: Comment[];
}

const PILL_TONE: Record<Tone, "success" | "warning" | "danger" | "neutral" | "info"> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  neutral: "neutral",
  info: "info",
};

function timestamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * One ticket and its conversation.
 *
 * Internal notes never reach here — the repository filters them out for a
 * non-agent, structurally rather than by convention, because an internal note
 * shown to a requester is how a disciplinary discussion reaches the person it
 * is about. This screen still checks the flag before rendering, so that a
 * future change on the server that starts sending them does not silently
 * publish them on a phone.
 */
export default function TicketDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useSession();

  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<{ title: string; description?: string } | null>(null);

  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      setDetail(await api.get<TicketDetail>(`/api/helpdesk/${id}`));
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setError({ title: "You are offline", description: "Reconnect to see this ticket." });
      } else if (caught instanceof ApiError) {
        setError({
          title: caught.status === 404 ? "This ticket could not be found" : "This ticket could not be loaded",
          description: caught.status === 404 ? undefined : caught.message,
        });
      } else {
        setError({ title: "This ticket could not be loaded" });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(async () => {
    const text = reply.trim();
    // Matches the server, which refuses an empty comment. Sending one and
    // being told no costs a round trip on a form somebody is typing one-handed.
    if (text.length < 1) {
      setReplyError("Write something before sending");
      return;
    }

    setReplyError(null);
    setSending(true);
    try {
      await api.post(`/api/helpdesk/${id}/comments`, { body: text });
      setReply("");
      // Reloaded rather than appended locally. The reply may have moved the
      // ticket out of "waiting for you", and a thread that grows while the
      // status above it stays wrong is worse than a short wait.
      await load();
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setReplyError("No connection. Your reply was not sent — it is still in the box.");
      } else if (caught instanceof ApiError) {
        setReplyError(caught.message);
      } else {
        setReplyError("Your reply was not sent. Please try again.");
      }
    } finally {
      setSending(false);
    }
  }, [api, id, reply, load]);

  if (loading) {
    return (
      <Screen>
        <Skeleton height={theme.lineHeight.title3} width="70%" />
        <Skeleton height={140} radius={theme.radius.md} style={{ marginTop: theme.spacing.lg }} />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <Banner tone="error" title={error.title} description={error.description} />
      </Screen>
    );
  }

  if (!detail) {
    return (
      <Screen>
        <EmptyState
          title="This ticket could not be found"
          description="It may have been merged into another, or it belongs to someone else."
        />
      </Screen>
    );
  }

  const { ticket, comments } = detail;
  const settled = isSettled(ticket.state);
  const due = dueState(
    ticket.resolutionDueAt,
    new Date(),
    ticket.resolutionBreached || ticket.responseBreached,
    settled
  );

  // Belt and braces over the repository's own filter. See the note above.
  const visible = comments.filter((comment) => !comment.isInternal);

  return (
    <Screen
      keyboardAware
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
    >
      <View style={styles.between}>
        <AppText variant="caption" tone="muted" tabular>
          {ticket.reference}
        </AppText>
        <StatusPill label={stateLabel(ticket.state)} tone={PILL_TONE[stateTone(ticket.state)]} />
      </View>

      <AppText variant="title3" weight="bold" heading style={{ marginTop: theme.spacing.xs }}>
        {ticket.subject}
      </AppText>

      <View style={[styles.meta, { marginTop: theme.spacing.sm }]}>
        <StatusPill
          label={`${priorityLabel(ticket.priority)} priority`}
          tone={PILL_TONE[priorityTone(ticket.priority)]}
          style={{ marginRight: theme.spacing.sm }}
        />
        <AppText variant="caption" tone="muted">
          Raised {timestamp(ticket.createdAt)}
        </AppText>
      </View>

      {due ? (
        <Banner
          tone={due.overdue ? "error" : due.tone === "warning" ? "warning" : "info"}
          title={due.text}
          description={
            due.overdue
              ? "The helpdesk has been notified. You do not need to do anything."
              : undefined
          }
          style={{ marginTop: theme.spacing.md }}
        />
      ) : null}

      <Card style={{ marginTop: theme.spacing.lg }}>
        <AppText variant="caption" tone="muted">
          What you reported
        </AppText>
        <AppText variant="body" style={{ marginTop: theme.spacing.xs }}>
          {ticket.body}
        </AppText>
      </Card>

      <AppText
        variant="footnote"
        weight="semibold"
        tone="muted"
        heading
        style={{ marginTop: theme.spacing.xl, marginBottom: theme.spacing.sm }}
      >
        Replies
      </AppText>

      {visible.length === 0 ? (
        <AppText variant="footnote" tone="muted">
          No replies yet. You will get a notification when the helpdesk responds.
        </AppText>
      ) : (
        visible.map((comment) => {
          const mine = comment.authorId !== undefined && comment.authorId === user?.id;

          return (
            <Card
              key={comment.id}
              muted={!mine}
              accessibilityLabel={`${mine ? "You" : "The helpdesk"} wrote on ${timestamp(comment.createdAt)}: ${comment.body}`}
              style={{ marginBottom: theme.spacing.sm }}
            >
              <View style={styles.between}>
                {/* Named in words. A reply distinguished only by which side of
                    the screen it sits on is unreadable to a screen reader and
                    ambiguous to everyone at a glance. */}
                <AppText variant="caption" weight="semibold" tone={mine ? "primary" : "default"}>
                  {mine ? "You" : "Helpdesk"}
                </AppText>
                <AppText variant="caption" tone="muted" tabular>
                  {timestamp(comment.createdAt)}
                </AppText>
              </View>
              <AppText variant="body" style={{ marginTop: theme.spacing.xs }}>
                {comment.body}
              </AppText>
            </Card>
          );
        })
      )}

      {settled ? (
        // No reply box on a closed ticket. A message typed into one that
        // nobody is watching is worse than being told to raise a new one.
        <Banner
          tone="info"
          title="This ticket is closed"
          description="If the problem comes back, raise a new ticket so it gets a fresh response time."
          style={{ marginTop: theme.spacing.lg }}
        />
      ) : (
        <View style={{ marginTop: theme.spacing.lg }}>
          <TextField
            label="Add a reply"
            value={reply}
            onChangeText={setReply}
            error={replyError ?? undefined}
            multiline
            numberOfLines={3}
            maxLength={20_000}
            editable={!sending}
          />
          <Button label="Send reply" onPress={send} busy={sending} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
});
