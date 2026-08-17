import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { stageLabel, stageTone, type ExpenseClaim } from "./index";

interface ExpenseDetail extends ExpenseClaim {
  description?: string;
  lineItems: { description: string; amountMinor: string }[];
  currency: string;
  approvedAt?: string;
  createdAt: string;
}

/** One claim, and what happened to it. */
export default function ExpenseDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [claim, setClaim] = useState<ExpenseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState<{ title: string; description?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setClaim(await api.get<ExpenseDetail>(`/api/expenses/${id}`));
      setError(null);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setError({ title: "You are offline" });
      } else if (caught instanceof ApiError) {
        setError({ title: "This claim could not be loaded", description: caught.message });
      } else {
        setError({ title: "This claim could not be loaded" });
      }
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const withdraw = async () => {
    setWithdrawing(true);
    try {
      await api.post(`/api/expenses/${id}/decision`, { action: "cancel", reason: "Withdrawn" });
      await load();
    } catch (caught) {
      setError({
        title: "This claim could not be withdrawn",
        description: caught instanceof ApiError ? caught.message : undefined,
      });
    } finally {
      setWithdrawing(false);
    }
  };

  if (loading) {
    return (
      <Screen scrollable>
        <Skeleton height={120} />
        <Skeleton height={200} style={{ marginTop: theme.spacing.md }} />
      </Screen>
    );
  }

  if (!claim) {
    return (
      <Screen scrollable>
        {error ? <Banner tone="error" title={error.title} description={error.description} /> : null}
        <EmptyState
          title="This claim could not be found"
          description="It may have been withdrawn."
        />
        <Button
          label="Back to claims"
          variant="secondary"
          onPress={() => router.replace("/expenses")}
          style={{ marginTop: theme.spacing.lg }}
        />
      </Screen>
    );
  }

  const partiallyApproved =
    claim.approvedAmount !== undefined && claim.approvedAmountMinor !== claim.amountMinor;

  return (
    <Screen scrollable>
      {error ? (
        <Banner
          tone="error"
          title={error.title}
          description={error.description}
          style={{ marginBottom: theme.spacing.md }}
        />
      ) : null}

      <View style={styles.between}>
        <AppText variant="title2" weight="bold" heading style={styles.grow}>
          {claim.title}
        </AppText>
        <StatusPill label={stageLabel(claim.stage)} tone={stageTone(claim.stage)} />
      </View>

      <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.xs }}>
        {claim.claimNumber} · {claim.category} · {claim.expenseDate}
      </AppText>

      <AppText
        variant="display"
        weight="bold"
        style={{ marginTop: theme.spacing.md }}
        accessibilityLabel={`Claimed ${formatMoney(claim.amount)}`}
      >
        {formatMoney(claim.amount)}
      </AppText>

      {/* The gap between claimed and approved is the single most important
          number on this screen, so it is stated rather than left to be worked
          out from two figures. */}
      {partiallyApproved && claim.approvedAmount !== undefined ? (
        <Banner
          tone="warning"
          title={`Approved for ${formatMoney(claim.approvedAmount)}`}
          description="Part of this claim was not approved. Ask your approver if you need the reason."
          style={{ marginTop: theme.spacing.md }}
        />
      ) : null}

      {claim.rejectionReason ? (
        <Banner
          tone={claim.stage === "rejected" ? "error" : "warning"}
          title={claim.stage === "rejected" ? "Not approved" : "Withdrawn"}
          description={claim.rejectionReason}
          style={{ marginTop: theme.spacing.md }}
        />
      ) : null}

      <Card style={{ marginTop: theme.spacing.md }}>
        <AppText variant="footnote" weight="semibold" heading>
          What you spent
        </AppText>
        {claim.lineItems.map((line, index) => (
          <View
            key={`${line.description}-${index}`}
            style={[styles.between, { marginTop: theme.spacing.sm }]}
          >
            <AppText variant="body" style={styles.grow}>
              {line.description}
            </AppText>
            <AppText variant="body" weight="medium">
              {formatMoney(Number(line.amountMinor) / 100)}
            </AppText>
          </View>
        ))}
      </Card>

      {claim.description ? (
        <Card style={{ marginTop: theme.spacing.md }}>
          <AppText variant="footnote" weight="semibold" heading>
            Notes
          </AppText>
          <AppText variant="body" style={{ marginTop: theme.spacing.xs }}>
            {claim.description}
          </AppText>
        </Card>
      ) : null}

      {claim.reimbursedAt ? (
        <Banner
          tone="success"
          title="Paid"
          description={`Reimbursed on ${claim.reimbursedAt.slice(0, 10)}.`}
          style={{ marginTop: theme.spacing.md }}
        />
      ) : null}

      {/* Only while it is still pending. The server refuses anything else, and
          offering a button that will be rejected is worse than not offering
          one. */}
      {claim.stage === "pending" ? (
        <Button
          label="Withdraw this claim"
          variant="secondary"
          busy={withdrawing}
          onPress={() => void withdraw()}
          accessibilityHint="Cancels the claim so nobody reviews it"
          style={{ marginTop: theme.spacing.xl }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
});
