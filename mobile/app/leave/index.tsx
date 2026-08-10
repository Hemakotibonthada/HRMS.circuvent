import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button } from "@/components/Button";
import { ApiError, OfflineError } from "@/lib/contracts";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TOUCH_TARGET } from "@/theme/tokens";

interface LeaveRequest {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  isHalfDay: boolean;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
}

interface Balance {
  leaveType: string;
  entitled: number;
  used: number;
  available: number;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

export default function LeaveScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useSession();

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Both at once. Sequential requests double the time someone stares at a
      // spinner on a mobile connection, and neither depends on the other.
      const [list, balance] = await Promise.all([
        api.get<{ items: LeaveRequest[] }>(
          "/api/leave?pageSize=50&sortBy=startDate&sortDirection=desc"
        ),
        api.get<{ balances: Balance[] }>("/api/leave/balances"),
      ]);
      setRequests(list.items);
      setBalances(balance.balances);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setError("Offline. Pull down to try again when you have a connection.");
      } else if (caught instanceof ApiError) {
        setError(caught.message);
      }
    } finally {
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusColour: Record<LeaveRequest["status"], string> = useMemo(
    () => ({
      pending: theme.colors.warning,
      approved: theme.colors.success,
      rejected: theme.colors.danger,
      cancelled: theme.colors.textMuted,
    }),
    [theme]
  );

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
        <Button
          label="Apply for leave"
          onPress={() => router.push("/leave/apply")}
          accessibilityHint="Opens the leave request form"
        />

        {balances.length > 0 ? (
          <View style={{ marginTop: theme.spacing.xl }}>
            <Text
              accessibilityRole="header"
              style={{
                color: theme.colors.text,
                fontSize: theme.fontSize.title3,
                lineHeight: theme.lineHeight.title3,
                fontWeight: theme.fontWeight.semibold,
                marginBottom: theme.spacing.md,
              }}
            >
              Your balance
            </Text>

            <View style={styles.balanceRow}>
              {balances.map((balance) => (
                <View
                  key={balance.leaveType}
                  // One label for the whole tile. Without this a screen reader
                  // announces "Casual", "12", "of 18 days" as three separate
                  // stops and the number arrives with nothing attached to it.
                  accessible
                  accessibilityLabel={`${titleCase(balance.leaveType)}: ${balance.available} of ${balance.entitled} days available`}
                  style={{
                    backgroundColor: theme.colors.surfaceElevated,
                    borderColor: theme.colors.border,
                    borderWidth: StyleSheet.hairlineWidth * 2,
                    borderRadius: theme.radius.md,
                    padding: theme.spacing.md,
                    minWidth: 104,
                    marginRight: theme.spacing.sm,
                    marginBottom: theme.spacing.sm,
                  }}
                >
                  <Text
                    style={{
                      color: theme.colors.textMuted,
                      fontSize: theme.fontSize.caption,
                      lineHeight: theme.lineHeight.caption,
                    }}
                  >
                    {titleCase(balance.leaveType)}
                  </Text>
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontSize: theme.fontSize.title2,
                      lineHeight: theme.lineHeight.title2,
                      fontWeight: theme.fontWeight.bold,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {balance.available}
                  </Text>
                  <Text
                    style={{
                      color: theme.colors.textMuted,
                      fontSize: theme.fontSize.caption,
                      lineHeight: theme.lineHeight.caption,
                    }}
                  >
                    of {balance.entitled} days
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <Text
          accessibilityRole="header"
          style={{
            color: theme.colors.text,
            fontSize: theme.fontSize.title3,
            lineHeight: theme.lineHeight.title3,
            fontWeight: theme.fontWeight.semibold,
            marginTop: theme.spacing.xl,
            marginBottom: theme.spacing.md,
          }}
        >
          Your requests
        </Text>

        {error ? (
          <Text
            accessibilityRole="alert"
            style={{
              color: theme.colors.danger,
              fontSize: theme.fontSize.footnote,
              lineHeight: theme.lineHeight.footnote,
            }}
          >
            {error}
          </Text>
        ) : requests.length === 0 ? (
          // An empty state that says what to do next, not just that there is
          // nothing. "No data" leaves someone wondering whether it is broken.
          <Text
            style={{
              color: theme.colors.textMuted,
              fontSize: theme.fontSize.body,
              lineHeight: theme.lineHeight.body,
            }}
          >
            You have not applied for any leave yet.
          </Text>
        ) : (
          requests.map((request) => (
            <Pressable
              key={request.id}
              accessibilityRole="button"
              accessibilityLabel={`${titleCase(request.leaveType)} leave, ${formatDate(request.startDate)} to ${formatDate(request.endDate)}, ${request.totalDays} days, ${request.status}`}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.border,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderRadius: theme.radius.md,
                padding: theme.spacing.md,
                marginBottom: theme.spacing.sm,
              }}
              onPress={() => router.push(`/leave/${request.id}`)}
            >
              <View style={styles.between}>
                <Text
                  style={{
                    color: theme.colors.text,
                    fontSize: theme.fontSize.body,
                    lineHeight: theme.lineHeight.body,
                    fontWeight: theme.fontWeight.medium,
                  }}
                >
                  {titleCase(request.leaveType)}
                </Text>
                {/* Status is a word as well as a colour. Colour alone excludes
                    anyone with a colour vision deficiency, and "approved" and
                    "rejected" are exactly the pair people confuse. */}
                <Text
                  style={{
                    color: statusColour[request.status],
                    fontSize: theme.fontSize.footnote,
                    lineHeight: theme.lineHeight.footnote,
                    fontWeight: theme.fontWeight.semibold,
                  }}
                >
                  {titleCase(request.status)}
                </Text>
              </View>
              <Text
                style={{
                  color: theme.colors.textMuted,
                  fontSize: theme.fontSize.footnote,
                  lineHeight: theme.lineHeight.footnote,
                  marginTop: theme.spacing.xs,
                }}
              >
                {formatDate(request.startDate)} – {formatDate(request.endDate)} ·{" "}
                {request.totalDays} {request.totalDays === 1 ? "day" : "days"}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  balanceRow: { flexDirection: "row", flexWrap: "wrap" },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
