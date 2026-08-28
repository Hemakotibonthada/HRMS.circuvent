import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SkeletonList } from "@/components/Skeleton";
import { StatusPill, type PillTone } from "@/components/StatusPill";
import { AppText } from "@/components/Typography";
import { ApiError, OfflineError } from "@/lib/contracts";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

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

const STATUS_TONE: Record<LeaveRequest["status"], PillTone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
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
  // Starts true. Without it the first render reached the empty state and told
  // people "you have not applied for any leave yet" before the request had
  // returned — a statement about someone's record that nothing had checked,
  // and indistinguishable from the truth.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<{ title: string; description?: string } | null>(null);

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
        setError({
          title: "You are offline",
          description: "Pull down to try again when you have a connection.",
        });
      } else if (caught instanceof ApiError) {
        setError({ title: "Your leave could not be loaded", description: caught.message });
      } else {
        setError({ title: "Your leave could not be loaded" });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalAvailable = useMemo(
    () => balances.reduce((sum, balance) => sum + balance.available, 0),
    [balances]
  );

  return (
    <Screen
      tabBarInset
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
    >
      <Button
        label="Apply for leave"
        onPress={() => router.push("/leave/apply")}
        accessibilityHint="Opens the leave request form"
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
          <SkeletonList rows={4} rowHeight={68} />
        </View>
      ) : (
        <>
          {balances.length > 0 ? (
            <View style={{ marginTop: theme.spacing.xl }}>
              <View style={styles.between}>
                <AppText variant="title3" weight="semibold" heading>
                  Your balance
                </AppText>
                <AppText variant="footnote" tone="muted" tabular>
                  {totalAvailable} {totalAvailable === 1 ? "day" : "days"} in total
                </AppText>
              </View>

              <View style={[styles.balanceRow, { marginTop: theme.spacing.md }]}>
                {balances.map((balance) => (
                  <Card
                    key={balance.leaveType}
                    // One label for the whole tile. Without this a screen
                    // reader announces "Casual", "12", "of 18 days" as three
                    // separate stops and the number arrives with nothing
                    // attached to it.
                    accessibilityLabel={`${titleCase(balance.leaveType)}: ${balance.available} of ${balance.entitled} days available`}
                    style={{
                      minWidth: 104,
                      marginRight: theme.spacing.sm,
                      marginBottom: theme.spacing.sm,
                    }}
                  >
                    <AppText variant="caption" tone="muted">
                      {titleCase(balance.leaveType)}
                    </AppText>
                    <AppText variant="title2" weight="bold" tabular>
                      {balance.available}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      of {balance.entitled} days
                    </AppText>
                  </Card>
                ))}
              </View>
            </View>
          ) : null}

          <AppText
            variant="title3"
            weight="semibold"
            heading
            style={{ marginTop: theme.spacing.xl, marginBottom: theme.spacing.md }}
          >
            Your requests
          </AppText>

          {requests.length === 0 ? (
            <EmptyState
              title="No leave requests yet"
              description="Anything you apply for appears here, with where it has got to in the approval chain."
              action={
                <Button
                  label="Apply for leave"
                  fullWidth={false}
                  onPress={() => router.push("/leave/apply")}
                />
              }
            />
          ) : (
            requests.map((request) => (
              <Card
                key={request.id}
                onPress={() => router.push(`/leave/${request.id}`)}
                accessibilityLabel={`${titleCase(request.leaveType)} leave, ${formatDate(request.startDate)} to ${formatDate(request.endDate)}, ${request.totalDays} ${request.totalDays === 1 ? "day" : "days"}, ${request.status}`}
                accessibilityHint="Opens the request"
                style={{ marginBottom: theme.spacing.sm }}
              >
                <View style={styles.between}>
                  <AppText variant="body" weight="medium">
                    {titleCase(request.leaveType)}
                  </AppText>
                  {/* Status is a word as well as a colour. Colour alone
                      excludes anyone with a colour vision deficiency, and
                      "approved" and "rejected" are exactly the pair people
                      confuse. */}
                  <StatusPill
                    label={titleCase(request.status)}
                    tone={STATUS_TONE[request.status]}
                  />
                </View>

                <AppText variant="footnote" tone="muted" tabular style={{ marginTop: theme.spacing.xs }}>
                  {formatDate(request.startDate)} – {formatDate(request.endDate)} ·{" "}
                  {request.isHalfDay
                    ? "Half day"
                    : `${request.totalDays} ${request.totalDays === 1 ? "day" : "days"}`}
                </AppText>
              </Card>
            ))
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceRow: { flexDirection: "row", flexWrap: "wrap" },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
