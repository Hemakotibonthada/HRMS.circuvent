import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { Skeleton } from "@/components/Skeleton";
import { StatusPill } from "@/components/StatusPill";
import { AppText } from "@/components/Typography";
import { ApiError, OfflineError } from "@/lib/contracts";
import { formatMoney } from "@shared/money/format";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

export interface ExpenseClaim {
  id: string;
  claimNumber: string;
  title: string;
  category: string;
  expenseDate: string;
  status: string;
  stage: string;
  /** Float for display. Never add these — see `amountMinor`. */
  amount: number;
  approvedAmount?: number;
  /** Exact paise, for anything that totals. */
  amountMinor: string;
  approvedAmountMinor?: string;
  rejectionReason?: string;
  reimbursedAt?: string;
}

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

export function stageTone(stage: string): Tone {
  if (stage === "reimbursed") return "success";
  if (stage === "approved") return "info";
  if (stage === "rejected") return "danger";
  if (stage === "cancelled") return "neutral";
  return "warning";
}

export function stageLabel(stage: string): string {
  if (stage === "reimbursed") return "Paid";
  if (stage === "approved") return "Approved";
  if (stage === "rejected") return "Rejected";
  if (stage === "cancelled") return "Cancelled";
  return "Awaiting approval";
}

/**
 * Expense claims.
 *
 * Deliberately not built until now: `/api/expenses` used to be a fake that
 * returned `data: []` and answered every submission with 201 and no write. A
 * screen on top of that would have shown someone a success message for a claim
 * that never existed, which is worse than having no screen at all.
 */
export default function ExpensesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useSession();

  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<{ title: string; description?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.get<{ data: ExpenseClaim[] }>("/api/expenses?limit=100");
      setClaims(response.data ?? []);
      setError(null);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setError({
          title: "You are offline",
          description: "Your claims will appear once you have a connection.",
        });
      } else if (caught instanceof ApiError) {
        setError({ title: "Your claims could not be loaded", description: caught.message });
      } else {
        setError({ title: "Your claims could not be loaded" });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const awaiting = claims.filter((claim) => claim.stage === "pending").length;
  const owed = claims.filter((claim) => claim.stage === "approved").length;

  return (
    <Screen
      scrollable
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      refreshing={refreshing}
    >
      <Button
        label="Claim an expense"
        onPress={() => router.push("/expenses/new")}
        accessibilityHint="Opens the form to file a new expense claim"
      />

      {error ? (
        <Banner
          tone={error.title === "You are offline" ? "warning" : "error"}
          title={error.title}
          description={error.description}
          style={{ marginTop: theme.spacing.md }}
        />
      ) : null}

      {!loading && !error && claims.length > 0 ? (
        <Card style={{ marginTop: theme.spacing.md }}>
          <View style={styles.between}>
            <AppText variant="footnote" tone="muted" style={styles.grow}>
              Awaiting approval
            </AppText>
            <AppText variant="footnote" weight="semibold">
              {awaiting}
            </AppText>
          </View>
          <View style={[styles.between, { marginTop: theme.spacing.xs }]}>
            <AppText variant="footnote" tone="muted" style={styles.grow}>
              Approved, not yet paid
            </AppText>
            <AppText variant="footnote" weight="semibold">
              {owed}
            </AppText>
          </View>
        </Card>
      ) : null}

      {loading ? (
        <View style={{ marginTop: theme.spacing.md }}>
          <Skeleton height={92} />
          <Skeleton height={92} style={{ marginTop: theme.spacing.sm }} />
          <Skeleton height={92} style={{ marginTop: theme.spacing.sm }} />
        </View>
      ) : claims.length === 0 && !error ? (
        <EmptyState
          title="No claims yet"
          description="Anything you spend on the company's behalf goes here. Keep the receipt."
        />
      ) : (
        claims.map((claim) => (
          <Card
            key={claim.id}
            onPress={() => router.push(`/expenses/${claim.id}`)}
            accessibilityLabel={`${claim.title}, ${formatMoney(claim.amount)}, ${stageLabel(
              claim.stage
            )}`}
            style={{ marginTop: theme.spacing.sm }}
          >
            <View style={styles.between}>
              <AppText variant="body" weight="semibold" style={styles.grow} numberOfLines={1}>
                {claim.title}
              </AppText>
              <StatusPill label={stageLabel(claim.stage)} tone={stageTone(claim.stage)} />
            </View>

            <AppText variant="title3" weight="bold" style={{ marginTop: theme.spacing.xs }}>
              {formatMoney(claim.amount)}
            </AppText>

            <AppText variant="caption" tone="muted" style={{ marginTop: 2 }}>
              {claim.claimNumber} · {claim.category} · {claim.expenseDate}
            </AppText>

            {/* Surfaced on the card rather than only in the detail view: a
                claim approved for less than it was filed for is the thing a
                person most needs to notice, and it is easy to miss behind a
                tap. */}
            {claim.approvedAmount !== undefined &&
            claim.approvedAmountMinor !== claim.amountMinor ? (
              <AppText variant="caption" tone="warning" style={{ marginTop: theme.spacing.xs }}>
                Approved for {formatMoney(claim.approvedAmount)}
              </AppText>
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
});
