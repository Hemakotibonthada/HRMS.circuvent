import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SkeletonList } from "@/components/Skeleton";
import { StatusPill } from "@/components/StatusPill";
import { AppText } from "@/components/Typography";
import { ApiError, OfflineError } from "@/lib/contracts";
import { dueState, isSettled, stateLabel, stateTone, type Tone } from "@/lib/helpdesk-rules";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TOUCH_TARGET } from "@/theme/tokens";

interface Ticket {
  id: string;
  reference: string;
  subject: string;
  priority: string;
  state: string;
  createdAt: string;
  resolutionDueAt?: string;
  responseBreached: boolean;
  resolutionBreached: boolean;
  requesterName?: string;
}

interface TicketsResponse {
  tickets: Ticket[];
  summary: { total: number; open: number; waiting: number; resolved: number; breached: number };
}

type Filter = "live" | "waiting" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "waiting", label: "Waiting for you" },
  { key: "all", label: "All" },
];

const PILL_TONE: Record<Tone, "success" | "warning" | "danger" | "neutral" | "info"> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  neutral: "neutral",
  info: "info",
};

/**
 * Helpdesk.
 *
 * Filtering happens on what has already been fetched rather than by asking the
 * server again per tab. The list is capped at 500 by the repository, the
 * summary is counted from those same rows, and a second round trip per tap on
 * a mobile connection buys nothing except a chance for the two to disagree.
 *
 * "Live" is the default rather than "All". A ticket closed in March is not
 * what somebody opening this screen came to find.
 */
export default function HelpdeskScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useSession();

  const [data, setData] = useState<TicketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<{ title: string; description?: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("live");

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<TicketsResponse>("/api/helpdesk"));
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setError({
          title: "You are offline",
          description: "Tickets are not stored on this device.",
        });
      } else if (caught instanceof ApiError) {
        setError({ title: "Your tickets could not be loaded", description: caught.message });
      } else {
        setError({ title: "Your tickets could not be loaded" });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  // Reloaded on return, not only on mount. Somebody who has just raised a
  // ticket comes straight back here, and a list that does not contain it
  // reads as the ticket having been lost.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    void load();
  }, [load]);

  const tickets = useMemo(() => {
    const all = data?.tickets ?? [];
    if (filter === "all") return all;
    if (filter === "waiting") return all.filter((t) => t.state === "pending_requester");
    return all.filter((t) => !isSettled(t.state));
  }, [data, filter]);

  const summary = data?.summary;

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
    >
      <Button
        label="Raise a ticket"
        onPress={() => router.push("/helpdesk/new")}
        accessibilityHint="Opens the form to describe a new problem"
      />

      {error ? (
        <Banner
          tone="error"
          title={error.title}
          description={error.description}
          style={{ marginTop: theme.spacing.lg }}
        />
      ) : null}

      {loading ? (
        <View style={{ marginTop: theme.spacing.xl }}>
          <SkeletonList rows={4} rowHeight={76} />
        </View>
      ) : (
        <>
          {summary && summary.total > 0 ? (
            <Card style={{ marginTop: theme.spacing.lg }}>
              <View style={styles.row}>
                <Total label="Live" value={summary.open + summary.waiting} />
                <Total label="Waiting for you" value={summary.waiting} />
                <Total label="Settled" value={summary.resolved} />
              </View>
            </Card>
          ) : null}

          {summary && summary.total > 0 ? (
            <View
              accessibilityRole="tablist"
              style={[styles.filters, { marginTop: theme.spacing.lg }]}
            >
              {FILTERS.map((option) => {
                const selected = filter === option.key;

                return (
                  <Pressable
                    key={option.key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Show ${option.label.toLowerCase()} tickets`}
                    onPress={() => setFilter(option.key)}
                    hitSlop={4}
                    style={{
                      minHeight: MIN_TOUCH_TARGET,
                      justifyContent: "center",
                      paddingHorizontal: theme.spacing.lg,
                      marginRight: theme.spacing.sm,
                      marginBottom: theme.spacing.sm,
                      borderRadius: theme.radius.pill,
                      backgroundColor: selected
                        ? theme.colors.primary
                        : theme.colors.surfaceElevated,
                      borderWidth: StyleSheet.hairlineWidth * 2,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                    }}
                  >
                    <AppText
                      variant="footnote"
                      tone={selected ? "onPrimary" : "default"}
                      weight={selected ? "semibold" : "regular"}
                    >
                      {option.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {tickets.length === 0 && !error ? (
            <EmptyState
              title={
                filter === "waiting"
                  ? "Nothing is waiting for you"
                  : filter === "live"
                    ? "No open tickets"
                    : "No tickets yet"
              }
              description={
                filter === "all"
                  ? "Anything you raise with HR or IT appears here, with where it has got to."
                  : "Switch to All to see tickets that have already been settled."
              }
              action={
                filter === "all" ? undefined : (
                  <Button
                    label="Show all"
                    variant="secondary"
                    fullWidth={false}
                    onPress={() => setFilter("all")}
                  />
                )
              }
            />
          ) : (
            tickets.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} />)
          )}
        </>
      )}
    </Screen>
  );
}

function TicketRow({ ticket }: { ticket: Ticket }) {
  const theme = useTheme();
  const router = useRouter();

  const settled = isSettled(ticket.state);
  const due = dueState(
    ticket.resolutionDueAt,
    new Date(),
    ticket.resolutionBreached || ticket.responseBreached,
    settled
  );

  return (
    <Card
      onPress={() => router.push(`/helpdesk/${ticket.id}`)}
      muted={settled}
      accessibilityLabel={`${ticket.reference}, ${ticket.subject}, ${stateLabel(ticket.state)}${
        due ? `, ${due.text}` : ""
      }`}
      accessibilityHint="Opens the ticket and its replies"
      style={{ marginBottom: theme.spacing.sm }}
    >
      <View style={styles.between}>
        <AppText variant="caption" tone="muted" tabular>
          {ticket.reference}
        </AppText>
        <StatusPill label={stateLabel(ticket.state)} tone={PILL_TONE[stateTone(ticket.state)]} />
      </View>

      <AppText variant="body" weight="medium" numberOfLines={2} style={{ marginTop: 2 }}>
        {ticket.subject}
      </AppText>

      {due ? (
        <AppText
          variant="caption"
          tone={due.tone === "danger" ? "danger" : due.tone === "warning" ? "warning" : "muted"}
          style={{ marginTop: theme.spacing.xs }}
        >
          {due.text}
        </AppText>
      ) : null}
    </Card>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  const theme = useTheme();

  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{ flex: 1, paddingRight: theme.spacing.sm }}
    >
      <AppText variant="title3" weight="bold" tabular>
        {value}
      </AppText>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  filters: { flexDirection: "row", flexWrap: "wrap" },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
