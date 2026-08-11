import { useCallback, useEffect, useState } from "react";
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button } from "@/components/Button";
import { ApiError, OfflineError, evaluateClockIn, type Geofence } from "@/lib/contracts";
import { readPosition } from "@/lib/location";
import { useSession } from "@/lib/session";
import { useSync } from "@/lib/sync";
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

function formatTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(minutes?: number): string {
  if (minutes === undefined || minutes === null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Today.
 *
 * The clock-in button is the reason this app exists, so it is the only thing
 * above the fold and it is the largest target on the screen.
 *
 * Location is checked on the device before the request is sent — not as
 * security, since a phone is an untrusted client and the server checks again,
 * but so that someone standing in the wrong car park is told immediately
 * rather than after a round-trip that ends in a refusal.
 */
export default function TodayScreen() {
  const theme = useTheme();
  const { api, user } = useSession();
  const { submit, pending, quarantined, retry, discard } = useSync();
  const router = useRouter();

  const [today, setToday] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error" | "success"; text: string } | null>(
    null
  );
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
        setMessage({ tone: "info", text: "Offline. Your clock-in will be sent when you reconnect." });
      } else if (error instanceof ApiError) {
        setMessage({ tone: "error", text: error.message });
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
          setMessage({ tone: "error", text: located.message });
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
            setMessage({ tone: "error", text: verdict.message });
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
            text: direction === "in" ? "Clocked in" : "Clocked out",
          });
          await load();
        } else if (outcome === "queued") {
          setMessage({
            tone: "info",
            text: "Saved on this device. It will be sent when you have a connection.",
          });
        } else {
          // Quarantined: the server refused it outright and retrying will not
          // help. Saying "clocked in" here would be the worst outcome of all,
          // because the person stops thinking about it.
          setMessage({
            tone: "error",
            text: "This could not be recorded. Please speak to your manager or HR.",
          });
        }
      } catch (error) {
        if (error instanceof ApiError) {
          setMessage({ tone: "error", text: error.message });
        } else {
          setMessage({ tone: "error", text: "Something went wrong. Please try again." });
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

  const toneColour = {
    info: theme.colors.textMuted,
    error: theme.colors.danger,
    success: theme.colors.success,
  };
  const toneBackground = {
    info: theme.colors.surface,
    error: theme.colors.dangerSubtle,
    success: theme.colors.successSubtle,
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
      edges={["bottom"]}
    >
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={theme.colors.primary}
          />
        }
      >
        <Text
          style={{
            color: theme.colors.textMuted,
            fontSize: theme.fontSize.body,
            lineHeight: theme.lineHeight.body,
          }}
        >
          {user ? `Hello, ${user.firstName}` : ""}
        </Text>

        <View
          style={{
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.border,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderRadius: theme.radius.lg,
            padding: theme.spacing.xl,
            marginTop: theme.spacing.lg,
            ...theme.elevation.card,
          }}
        >
          <Text
            accessibilityRole="header"
            style={{
              color: theme.colors.text,
              fontSize: theme.fontSize.title2,
              lineHeight: theme.lineHeight.title2,
              fontWeight: theme.fontWeight.bold,
            }}
          >
            {finished ? "Day complete" : clockedIn ? "You are clocked in" : "Not clocked in"}
          </Text>

          <View style={[styles.row, { marginTop: theme.spacing.lg }]}>
            <Field label="In" value={formatTime(record?.clockInAt)} />
            <Field label="Out" value={formatTime(record?.clockOutAt)} />
            <Field label="Worked" value={formatDuration(record?.workedMinutes)} />
          </View>

          {record?.requiresLocationReview ? (
            <Text
              style={{
                color: theme.colors.warning,
                fontSize: theme.fontSize.footnote,
                lineHeight: theme.lineHeight.footnote,
                marginTop: theme.spacing.md,
              }}
            >
              Your manager will check today&apos;s location. Nothing is needed from you.
            </Text>
          ) : null}

          {pending.length > 0 ? (
            // Shown rather than hidden. Someone whose punch is sitting on the
            // device needs to know it has not reached the server yet — that is
            // the difference between "I clocked in" and "I can prove it".
            <Text
              accessibilityLiveRegion="polite"
              style={{
                color: theme.colors.textMuted,
                fontSize: theme.fontSize.footnote,
                lineHeight: theme.lineHeight.footnote,
                marginTop: theme.spacing.md,
              }}
            >
              {pending.length === 1
                ? "1 action waiting to be sent"
                : `${pending.length} actions waiting to be sent`}
            </Text>
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
        </View>

        {message ? (
          <View
            accessibilityRole={message.tone === "error" ? "alert" : undefined}
            accessibilityLiveRegion={message.tone === "error" ? "assertive" : "polite"}
            style={{
              backgroundColor: toneBackground[message.tone],
              borderRadius: theme.radius.md,
              padding: theme.spacing.md,
              marginTop: theme.spacing.lg,
            }}
          >
            <Text
              style={{
                color: toneColour[message.tone],
                fontSize: theme.fontSize.footnote,
                lineHeight: theme.lineHeight.footnote,
              }}
            >
              {message.text}
            </Text>

            {settingsPrompt ? (
              <Button
                label="Open Settings"
                variant="ghost"
                fullWidth={false}
                onPress={() => void Linking.openSettings()}
                style={{ marginTop: theme.spacing.sm }}
              />
            ) : null}
          </View>
        ) : null}

        {quarantined.length > 0 ? (
          // Refused work has to be visible and actionable. The alternative is
          // that it sits in a database on the phone for ever while the person
          // believes they clocked in — the failure mode this whole queue
          // exists to avoid.
          <View
            accessibilityRole="alert"
            style={{
              backgroundColor: theme.colors.dangerSubtle,
              borderRadius: theme.radius.md,
              padding: theme.spacing.md,
              marginTop: theme.spacing.lg,
            }}
          >
            <Text
              style={{
                color: theme.colors.danger,
                fontSize: theme.fontSize.footnote,
                lineHeight: theme.lineHeight.footnote,
                fontWeight: theme.fontWeight.semibold,
              }}
            >
              {quarantined.length === 1
                ? "1 action was refused and will not be retried"
                : `${quarantined.length} actions were refused and will not be retried`}
            </Text>

            {quarantined.map((operation) => (
              <View key={operation.id} style={{ marginTop: theme.spacing.sm }}>
                <Text
                  style={{
                    color: theme.colors.danger,
                    fontSize: theme.fontSize.caption,
                    lineHeight: theme.lineHeight.caption,
                  }}
                >
                  {operation.kind.replace(/[._]/g, " ")} —{" "}
                  {operation.lastError ?? "no reason given"}
                </Text>
                <View style={styles.actions}>
                  <Button
                    label="Try again"
                    variant="ghost"
                    fullWidth={false}
                    onPress={() => void retry(operation.id)}
                    accessibilityLabel={`Try ${operation.kind.replace(/[._]/g, " ")} again`}
                  />
                  <Button
                    label="Discard"
                    variant="ghost"
                    fullWidth={false}
                    onPress={() => void discard(operation.id)}
                    accessibilityLabel={`Discard ${operation.kind.replace(/[._]/g, " ")}`}
                    accessibilityHint="Removes this action permanently"
                    style={{ marginLeft: theme.spacing.md }}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <Button
          label="Leave"
          variant="secondary"
          onPress={() => router.push("/leave")}
          accessibilityHint="Shows your leave balance and requests"
          style={{ marginTop: theme.spacing.lg }}
        />

        <Button
          label="Settings"
          variant="ghost"
          onPress={() => router.push("/settings")}
          accessibilityHint="Account settings and biometric unlock"
          style={{ marginTop: theme.spacing.xl }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text
        style={{
          color: theme.colors.textMuted,
          fontSize: theme.fontSize.caption,
          lineHeight: theme.lineHeight.caption,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: theme.colors.text,
          fontSize: theme.fontSize.callout,
          lineHeight: theme.lineHeight.callout,
          fontWeight: theme.fontWeight.semibold,
          // Times and durations line up in a row only if the digits are the
          // same width; proportional digits make the columns jitter.
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  actions: { flexDirection: "row", alignItems: "center" },
  field: { flex: 1 },
});
