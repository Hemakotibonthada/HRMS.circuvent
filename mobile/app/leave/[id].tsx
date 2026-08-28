import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Banner } from "@/components/Banner";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { Skeleton } from "@/components/Skeleton";
import { StatusPill, type PillTone } from "@/components/StatusPill";
import { AppText } from "@/components/Typography";
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

const STATUS_TONE: Record<LeaveDetail["status"], PillTone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

function longDate(iso: string): string {
  // Parsed without a zone suffix, so it is local midnight on that calendar
  // date. `new Date("2026-03-10")` would be UTC midnight, which formats as the
  // 9th anywhere west of Greenwich.
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
  const [error, setError] = useState<{ title: string; description?: string } | null>(null);
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
        setError({ title: "You are offline", description: "Reconnect to see this request." });
      } else if (caught instanceof ApiError) {
        setError({ title: "This request could not be loaded", description: caught.message });
      } else {
        setError({ title: "This request could not be loaded" });
      }
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Screen>
        <Skeleton height={theme.lineHeight.title2} width="60%" />
        <Skeleton height={180} radius={theme.radius.md} style={{ marginTop: theme.spacing.lg }} />
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

  if (!request) {
    return (
      <Screen>
        <EmptyState
          title="This request could not be found"
          description="It may have been cancelled, or it belongs to someone else."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.between}>
        <AppText variant="title2" weight="bold" heading style={{ flex: 1 }}>
          {titleCase(request.leaveType)} leave
        </AppText>
        <StatusPill label={titleCase(request.status)} tone={STATUS_TONE[request.status]} />
      </View>

      <Card padded={false} style={{ marginTop: theme.spacing.lg, paddingHorizontal: theme.spacing.md }}>
        <Row label="From" value={longDate(request.startDate)} first />
        <Row label="To" value={longDate(request.endDate)} />
        <Row
          label="Days"
          value={
            request.isHalfDay
              ? `Half day${request.halfDayPeriod ? ` (${request.halfDayPeriod})` : ""}`
              : `${request.totalDays} ${request.totalDays === 1 ? "day" : "days"}`
          }
        />
        <Row label="Reason" value={request.reason} />
      </Card>

      {request.rejectionReason ? (
        // Given its own banner rather than another row. A rejection reason is
        // the one thing on this screen someone has to act on, and a row in a
        // list of dates is where it gets missed.
        <Banner
          tone="error"
          title="Why this was rejected"
          description={request.rejectionReason}
          style={{ marginTop: theme.spacing.lg }}
        />
      ) : null}
    </Screen>
  );
}

function Row({ label, value, first = false }: { label: string; value: string; first?: boolean }) {
  const theme = useTheme();

  return (
    <View
      // Grouped so a screen reader reads "From: Tuesday 10 March" as one thing
      // rather than stopping on the label and the value separately.
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        borderTopColor: theme.colors.borderSubtle,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth * 2,
        paddingVertical: theme.spacing.md,
      }}
    >
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText variant="body" style={{ marginTop: 2 }}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
