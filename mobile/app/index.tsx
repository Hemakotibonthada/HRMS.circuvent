import { useCallback, useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Screen } from "@/components/Screen";
import { Skeleton } from "@/components/Skeleton";
import { AppText } from "@/components/Typography";
import { ApiError, OfflineError, evaluateClockIn, type Geofence } from "@/lib/contracts";
import { readPosition } from "@/lib/location";
import { useSession } from "@/lib/session";
import { useSync } from "@/lib/sync";
import { formatDuration } from "@/lib/shift-rules";
import { useTheme } from "@/theme/ThemeProvider";

interface TodayResponse {
  record: {
    workDate: string;
    clockInAt?: string;
    clockOutAt?: string;
    status: string;
    workedMinutes?: number;
    lateByMinutes: number;
    requiresLocationReview: boolean;
  } | null;
  /** Null for remote and field staff, who may clock in from anywhere. */
  fence: Geofence | null;
}

/** Roles the server will actually let approve. */
const APPROVER_ROLES = ["owner", "admin", "hr", "manager"];

function formatTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Today.
 *
 * The clock-in button is the reason this app exists, so it is the only thing
 * above the fold and it is the largest target on the screen. Navigation moved
 * to the tab bar for the same reason: it used to be a column of buttons below
 * this card, which meant scrolling past the punch to reach anything else.
 *
 * Location is checked on the device before the request is sent — not as
 * security, since a phone is an untrusted client and the server checks again,
 * but so that someone standing in the wrong car park is told immediately
 * rather than after a round-trip that ends in a refusal.
 */
export default function TodayScreen() {
  const theme = useTheme();
  const { api, user } = useSession();
  const { submit, pending, quarantined, retry, discard, syncing } = useSync();
  const router = useRouter();

  const [today, setToday] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "info" | "error" | "success";
    title: string;
    description?: string;
  } | null>(null);
  const [settingsPrompt, setSettingsPrompt] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.get<TodayResponse>("/api/attendance/clock");
      setToday(response);
    } catch (error) {
      if (error instanceof OfflineError) {
        // Not an error banner. Being offline is the normal state in a lift or
        // a basement, and the queue exists precisely so that it does not
        // block the action.
        setMessage({
          tone: "info",
          title: "You are offline",
          description: "Your clock-in will be sent when you reconnect.",
        });
      } else if (error instanceof ApiError) {
        setMessage({ tone: "error", title: "Today could not be loaded", description: error.message });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const punch = useCallback(
    async (direction: "in" | "out") => {
      setMessage(null);
      setSettingsPrompt(false);
      setBusy(true);

      try {
        const located = await readPosition();

        if (!located.ok) {
          setMessage({ tone: "error", title: "Location unavailable", description: located.message });
          setSettingsPrompt(located.reason === "denied_forever" || located.reason === "disabled");
          return;
        }

        // The same function the server runs. Checking here first means a
        // refusal is instant and explains itself, instead of arriving as a
        // 403 after a round-trip.
        const fences = today?.fence ? [today.fence] : [];
        if (fences.length > 0) {
          const verdict = evaluateClockIn(located.position, fences);
          if (!verdict.allowed) {
            setMessage({ tone: "error", title: "You are not at work", description: verdict.message });
            return;
          }
        }

        // Written to the queue first, then sent. Not sent-then-queued-on-
        // failure: the app can be killed between the tap and the response —
        // locking the phone and pocketing it does exactly that — and the
        // punch has to survive it.
        const outcome = await submit(
          direction === "in" ? "attendance.clock_in" : "attendance.clock_out",
          {
            action: direction,
            method: "mobile",
            latitude: located.position.latitude,
            longitude: located.position.longitude,
            accuracyMetres: located.position.accuracyMetres,
            capturedAt: located.position.capturedAt,
            isMocked: located.position.isMocked,
          },
          {
            // Idempotency key: a retry or a double-tap must not produce two
            // punches. Scoped to the person, the day and the direction.
            id: `clock-${direction}-${user?.employeeId ?? user?.id}-${new Date().toISOString().slice(0, 10)}`,
            // Orders this punch behind the same employee's earlier ones. A
            // clock-out that overtakes its clock-in records an impossible day.
            streamKey: `attendance-${user?.employeeId ?? user?.id}`,
          }
        );

        if (outcome === "sent") {
          setMessage({
            tone: "success",
            title: direction === "in" ? "Clocked in" : "Clocked out",
          });
          await load();
        } else if (outcome === "queued") {
          setMessage({
            tone: "info",
            title: "Saved on this device",
            description: "It will be sent when you have a connection.",
          });
        } else {
          // Quarantined: the server refused it outright and retrying will not
          // help. Saying "clocked in" here would be the worst outcome of all,
          // because the person stops thinking about it.
          setMessage({
            tone: "error",
            title: "This could not be recorded",
            description: "Please speak to your manager or HR.",
          });
        }
      } catch (error) {
        if (error instanceof ApiError) {
          setMessage({ tone: "error", title: "That did not work", description: error.message });
        } else {
          setMessage({ tone: "error", title: "Something went wrong", description: "Please try again." });
        }
      } finally {
        setBusy(false);
      }
    },
    [submit, today, user, load]
  );

  const record = today?.record;
  const clockedIn = Boolean(record?.clockInAt && !record?.clockOutAt);
  const finished = Boolean(record?.clockOutAt);
  const canApprove = user ? APPROVER_ROLES.includes(user.role) : false;

  return (
    <Screen
      tabBarInset
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
    >
      <AppText variant="body" tone="muted">
        {user ? `Hello, ${user.firstName}` : ""}
      </AppText>

      <Card padded={false} style={{ marginTop: theme.spacing.lg, padding: theme.spacing.xl }}>
        {loading ? (
          // A placeholder the size of the heading it replaces, so the button
          // below does not jump once the state is known — and so the screen
          // never claims "Not clocked in" before it has asked.
          <Skeleton height={theme.lineHeight.title2} width="70%" />
        ) : (
          <AppText variant="title2" weight="bold" heading>
            {finished ? "Day complete" : clockedIn ? "You are clocked in" : "Not clocked in"}
          </AppText>
        )}

        <View style={[styles.row, { marginTop: theme.spacing.lg }]}>
          <Field label="In" value={formatTime(record?.clockInAt)} />
          <Field label="Out" value={formatTime(record?.clockOutAt)} />
          <Field
            label="Worked"
            value={
              record?.workedMinutes === undefined ? "—" : formatDuration(record.workedMinutes)
            }
          />
        </View>

        {record?.requiresLocationReview ? (
          <AppText variant="footnote" tone="warning" style={{ marginTop: theme.spacing.md }}>
            Your manager will check today&apos;s location. Nothing is needed from you.
          </AppText>
        ) : null}

        {pending.length > 0 ? (
          // Shown rather than hidden. Someone whose punch is sitting on the
          // device needs to know it has not reached the server yet — that is
          // the difference between "I clocked in" and "I can prove it".
          <AppText
            variant="footnote"
            tone="muted"
            accessibilityLiveRegion="polite"
            style={{ marginTop: theme.spacing.md }}
          >
            {pending.length === 1
              ? "1 action waiting to be sent"
              : `${pending.length} actions waiting to be sent`}
            {syncing ? " · sending now" : ""}
          </AppText>
        ) : null}

        {!loading ? (
          <Button
            label={clockedIn ? "Clock out" : "Clock in"}
            variant={clockedIn ? "secondary" : "primary"}
            onPress={() => punch(clockedIn ? "out" : "in")}
            busy={busy}
            disabled={finished}
            accessibilityHint={
              clockedIn
                ? "Records the end of your working day using your current location"
                : "Records the start of your working day using your current location"
            }
            style={{ marginTop: theme.spacing.xl }}
          />
        ) : null}
      </Card>

      {message ? (
        <Banner
          tone={message.tone === "success" ? "success" : message.tone}
          title={message.title}
          description={message.description}
          style={{ marginTop: theme.spacing.lg }}
          action={
            settingsPrompt ? (
              <Button
                label="Open Settings"
                variant="ghost"
                fullWidth={false}
                onPress={() => void Linking.openSettings()}
              />
            ) : undefined
          }
        />
      ) : null}

      {quarantined.length > 0 ? (
        // Refused work has to be visible and actionable. The alternative is
        // that it sits in a database on the phone for ever while the person
        // believes they clocked in — the failure mode this whole queue exists
        // to avoid.
        <Banner
          tone="error"
          title={
            quarantined.length === 1
              ? "1 action was refused and will not be retried"
              : `${quarantined.length} actions were refused and will not be retried`
          }
          style={{ marginTop: theme.spacing.lg }}
        >
          {quarantined.map((operation) => {
            const name = operation.kind.replace(/[._]/g, " ");
            return (
              <View key={operation.id} style={{ marginBottom: theme.spacing.sm }}>
                <AppText variant="caption" tone="danger">
                  {name} — {operation.lastError ?? "no reason given"}
                </AppText>
                <View style={styles.actions}>
                  <Button
                    label="Try again"
                    variant="ghost"
                    fullWidth={false}
                    onPress={() => void retry(operation.id)}
                    accessibilityLabel={`Try ${name} again`}
                  />
                  <Button
                    label="Discard"
                    variant="ghost"
                    fullWidth={false}
                    onPress={() => void discard(operation.id)}
                    accessibilityLabel={`Discard ${name}`}
                    accessibilityHint="Removes this action permanently"
                    style={{ marginLeft: theme.spacing.md }}
                  />
                </View>
              </View>
            );
          })}
        </Banner>
      ) : null}

      {/* Approvals stays on this screen as well as on Profile: for a manager
          it is a daily action, and daily actions belong next to the other one.
          Shown only to roles the server will accept — a button that always
          returns 403 reads as a broken app rather than as a boundary. */}
      {canApprove ? (
        <Button
          label="Approvals"
          variant="secondary"
          onPress={() => router.push("/approvals")}
          accessibilityHint="Leave requests waiting for your decision"
          style={{ marginTop: theme.spacing.lg }}
        />
      ) : null}

      <Button
        label="Attendance history"
        variant="ghost"
        onPress={() => router.push("/attendance")}
        accessibilityHint="Your punches, month by month"
        style={{ marginTop: theme.spacing.sm }}
      />
    </Screen>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View
      // One stop per figure. Announced separately, "In" and "09:02" arrive as
      // two unrelated fragments.
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={styles.field}
    >
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      {/* Times and durations line up in a row only if the digits are the same
          width; proportional figures make the columns jitter. */}
      <AppText variant="callout" weight="semibold" tabular style={{ marginTop: 2 }}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between" },
  actions: { flexDirection: "row", alignItems: "center" },
  field: { flex: 1 },
});
