import { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { ApiError, OfflineError } from "@/lib/contracts";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

interface PendingRequest {
  id: string;
  employeeId: string;
  employeeName?: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  isHalfDay: boolean;
  reason: string;
  status: string;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/**
 * The approvals queue.
 *
 * Decisions are sent immediately and are never queued offline. Everything else
 * in this app writes to the queue first, because a clock-in is a record of
 * something that already happened and delay costs nothing. An approval is the
 * opposite: it is a judgement about current state, and one made against a
 * three-day-old cache — after the request was withdrawn, or approved by
 * somebody else — is a decision the manager did not actually make.
 */
export default function ApprovalsScreen() {
  const theme = useTheme();
  const { api, user } = useSession();

  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // No employeeId: a privileged caller omitting it sees the whole
      // organisation's queue, which is the point of this screen.
      const page = await api.get<{ items: PendingRequest[] }>(
        "/api/leave?status=pending&pageSize=100&sortBy=startDate&sortDirection=asc"
      );
      setRequests(page.items);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setError("Offline. Approvals need a connection, so nothing is shown rather than something stale.");
      } else if (caught instanceof ApiError) {
        setError(caught.message);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (id: string, action: "approve" | "reject", reason?: string) => {
      setBusyId(id);
      setError(null);
      try {
        await api.post(`/api/leave/${id}/decision`, { action, reason });
        setRejecting(null);
        setRejectReason("");
        // Reloaded rather than removed locally. Another manager may have acted
        // on something else in the list while this screen was open, and
        // showing a queue that no longer exists invites a second decision on
        // an already-decided request.
        await load();
      } catch (caught) {
        if (caught instanceof OfflineError) {
          setError("No connection. The decision was not recorded — try again when you are back online.");
        } else if (caught instanceof ApiError) {
          setError(caught.message);
        } else {
          setError("Something went wrong. The decision was not recorded.");
        }
      } finally {
        setBusyId(null);
      }
    },
    [api, load]
  );

  const submitRejection = useCallback(
    (id: string) => {
      const reason = rejectReason.trim();
      // Matches the server, which refuses a rejection under three characters.
      // Someone told only "rejected" has nothing to act on.
      if (reason.length < 3) {
        setReasonError("Give a reason. The person needs to know why.");
        return;
      }
      setReasonError(null);
      void decide(id, "reject", reason);
    },
    [rejectReason, decide]
  );

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
      edges={["bottom"]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg }}
          keyboardShouldPersistTaps="handled"
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
          {error ? (
            <View
              accessibilityRole="alert"
              style={{
                backgroundColor: theme.colors.dangerSubtle,
                borderRadius: theme.radius.md,
                padding: theme.spacing.md,
                marginBottom: theme.spacing.lg,
              }}
            >
              <Text
                style={{
                  color: theme.colors.danger,
                  fontSize: theme.fontSize.footnote,
                  lineHeight: theme.lineHeight.footnote,
                }}
              >
                {error}
              </Text>
            </View>
          ) : null}

          {loading ? (
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.body }}>
              Loading…
            </Text>
          ) : requests.length === 0 ? (
            <Text
              style={{
                color: theme.colors.textMuted,
                fontSize: theme.fontSize.body,
                lineHeight: theme.lineHeight.body,
              }}
            >
              Nothing is waiting for you.
            </Text>
          ) : (
            requests.map((request) => {
              // The server refuses this outright. Saying so before the tap is
              // better than a 403 that reads like a fault.
              const isOwn = request.employeeId === user?.employeeId || request.employeeId === user?.id;
              const busy = busyId === request.id;

              return (
                <View
                  key={request.id}
                  style={{
                    backgroundColor: theme.colors.surfaceElevated,
                    borderColor: theme.colors.border,
                    borderWidth: StyleSheet.hairlineWidth * 2,
                    borderRadius: theme.radius.md,
                    padding: theme.spacing.md,
                    marginBottom: theme.spacing.md,
                  }}
                >
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontSize: theme.fontSize.body,
                      lineHeight: theme.lineHeight.body,
                      fontWeight: theme.fontWeight.semibold,
                    }}
                  >
                    {request.employeeName ?? "An employee"}
                  </Text>
                  <Text
                    style={{
                      color: theme.colors.textMuted,
                      fontSize: theme.fontSize.footnote,
                      lineHeight: theme.lineHeight.footnote,
                      marginTop: 2,
                    }}
                  >
                    {titleCase(request.leaveType)} · {shortDate(request.startDate)} –{" "}
                    {shortDate(request.endDate)} · {request.totalDays}{" "}
                    {request.totalDays === 1 ? "day" : "days"}
                    {request.isHalfDay ? " (half day)" : ""}
                  </Text>
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontSize: theme.fontSize.footnote,
                      lineHeight: theme.lineHeight.footnote,
                      marginTop: theme.spacing.sm,
                    }}
                  >
                    {request.reason}
                  </Text>

                  {isOwn ? (
                    <Text
                      style={{
                        color: theme.colors.textMuted,
                        fontSize: theme.fontSize.caption,
                        lineHeight: theme.lineHeight.caption,
                        marginTop: theme.spacing.md,
                      }}
                    >
                      This is your own request. Someone else has to decide it.
                    </Text>
                  ) : rejecting === request.id ? (
                    <View style={{ marginTop: theme.spacing.md }}>
                      <TextField
                        label="Reason for rejection"
                        value={rejectReason}
                        onChangeText={setRejectReason}
                        error={reasonError ?? undefined}
                        multiline
                        numberOfLines={2}
                        maxLength={1000}
                        autoFocus
                        editable={!busy}
                      />
                      <View style={styles.actions}>
                        <Button
                          label="Confirm rejection"
                          variant="danger"
                          fullWidth={false}
                          busy={busy}
                          onPress={() => submitRejection(request.id)}
                        />
                        <Button
                          label="Back"
                          variant="ghost"
                          fullWidth={false}
                          onPress={() => {
                            setRejecting(null);
                            setReasonError(null);
                            setRejectReason("");
                          }}
                          style={{ marginLeft: theme.spacing.sm }}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={[styles.actions, { marginTop: theme.spacing.md }]}>
                      <Button
                        label="Approve"
                        fullWidth={false}
                        busy={busy}
                        onPress={() => void decide(request.id, "approve")}
                        accessibilityLabel={`Approve ${request.employeeName ?? "this"} ${titleCase(request.leaveType)} leave`}
                      />
                      <Button
                        label="Reject"
                        variant="secondary"
                        fullWidth={false}
                        disabled={busy}
                        onPress={() => {
                          setRejecting(request.id);
                          setRejectReason("");
                          setReasonError(null);
                        }}
                        accessibilityLabel={`Reject ${request.employeeName ?? "this"} ${titleCase(request.leaveType)} leave`}
                        style={{ marginLeft: theme.spacing.sm }}
                      />
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
});
