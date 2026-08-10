import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { ApiError, OfflineError } from "@/lib/contracts";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

interface LeaveDetail {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  isHalfDay: boolean;
  halfDayPeriod?: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  appliedAt: string;
  approvedAt?: string;
  rejectionReason?: string;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function LeaveDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();

  const [request, setRequest] = useState<LeaveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      // The list endpoint filtered to this one id. There is no GET /leave/[id]
      // route on the server, and inventing a client call to an endpoint that
      // does not exist is how the last two contract mismatches happened.
      const page = await api.get<{ items: LeaveDetail[] }>("/api/leave?pageSize=200");
      setRequest(page.items.find((item) => item.id === id) ?? null);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setError("Offline. Reconnect to see this request.");
      } else if (caught instanceof ApiError) {
        setError(caught.message);
      }
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusColour: Record<LeaveDetail["status"], string> = {
    pending: theme.colors.warning,
    approved: theme.colors.success,
    rejected: theme.colors.danger,
    cancelled: theme.colors.textMuted,
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
      edges={["bottom"]}
    >
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
        {error ? (
          <Text
            accessibilityRole="alert"
            style={{ color: theme.colors.danger, fontSize: theme.fontSize.body }}
          >
            {error}
          </Text>
        ) : loading ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.body }}>
            Loading…
          </Text>
        ) : !request ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.body }}>
            This request could not be found. It may have been cancelled.
          </Text>
        ) : (
          <View>
            <View style={styles.between}>
              <Text
                accessibilityRole="header"
                style={{
                  color: theme.colors.text,
                  fontSize: theme.fontSize.title2,
                  lineHeight: theme.lineHeight.title2,
                  fontWeight: theme.fontWeight.bold,
                }}
              >
                {titleCase(request.leaveType)} leave
              </Text>
              <Text
                style={{
                  color: statusColour[request.status],
                  fontSize: theme.fontSize.footnote,
                  fontWeight: theme.fontWeight.semibold,
                }}
              >
                {titleCase(request.status)}
              </Text>
            </View>

            <Row label="From" value={longDate(request.startDate)} />
            <Row label="To" value={longDate(request.endDate)} />
            <Row
              label="Days"
              value={`${request.totalDays}${request.isHalfDay ? " (half day)" : ""}`}
            />
            <Row label="Reason" value={request.reason} />
            {request.rejectionReason ? (
              <Row label="Reason for rejection" value={request.rejectionReason} />
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      // Grouped so a screen reader reads "From: Tuesday 10 March" as one
      // thing rather than stopping on the label and the value separately.
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        borderTopColor: theme.colors.borderSubtle,
        borderTopWidth: StyleSheet.hairlineWidth * 2,
        paddingVertical: theme.spacing.md,
      }}
    >
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
          fontSize: theme.fontSize.body,
          lineHeight: theme.lineHeight.body,
          marginTop: 2,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  between: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    // A literal, not a token. StyleSheet.create runs at module evaluation,
    // before any theme exists, so a lookup here would be a reference to
    // something not yet initialised.
    marginBottom: 16,
  },
});
