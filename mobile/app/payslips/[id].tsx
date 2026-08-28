import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Banner } from "@/components/Banner";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { Skeleton } from "@/components/Skeleton";
import { AppText } from "@/components/Typography";
import { ApiError, OfflineError } from "@/lib/contracts";
import { formatMoney, formatPeriod } from "@shared/money/format";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

interface Payslip {
  id: string;
  periodMonth?: number;
  periodYear?: number;
  workingDays: number;
  presentDays: number;
  lopDays: number;
  gross: number;
  totalDeductions: number;
  netPay: number;
  /** Exact whole paise, for any arithmetic. See payslips/index.tsx. */
  grossMinor: string;
  totalDeductionsMinor: string;
  netPayMinor: string;
  status: string;
  anomalies: string[];
}

/**
 * One payslip.
 *
 * Gross, deductions and net are shown as the server sent them. It would be
 * easy to render `gross - totalDeductions` as a check, and wrong: those are
 * floats converted from the stored minor units, and a subtraction here could
 * disagree with the authoritative figure by a paisa. If the numbers ever fail
 * to reconcile, that is a payroll bug to fix at source, not something to
 * paper over on a phone.
 */
export default function PayslipDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();

  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ title: string; description?: string } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      // Filtered from the list, because there is no GET /payslips/[id] route.
      // Inventing a client call to an endpoint that does not exist is how the
      // earlier contract mismatches happened.
      const response = await api.get<{ payslips: Payslip[] }>("/api/payroll/payslips");
      setPayslip(response.payslips.find((p) => p.id === id) ?? null);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setError({
          title: "You are offline",
          description: "Payslips are not stored on this device.",
        });
      } else if (caught instanceof ApiError) {
        setError({ title: "This payslip could not be loaded", description: caught.message });
      } else {
        setError({ title: "This payslip could not be loaded" });
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
        <Skeleton height={theme.lineHeight.body} width="40%" />
        <Skeleton
          height={theme.lineHeight.display}
          width="65%"
          style={{ marginTop: theme.spacing.sm }}
        />
        <Skeleton height={160} radius={theme.radius.md} style={{ marginTop: theme.spacing.xl }} />
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

  if (!payslip) {
    return (
      <Screen>
        <EmptyState
          title="This payslip could not be found"
          description="It may belong to a run that was withdrawn for correction."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppText variant="body" tone="muted" heading>
        {formatPeriod(payslip.periodMonth, payslip.periodYear)}
      </AppText>

      <AppText
        variant="display"
        weight="bold"
        tabular
        accessibilityLabel={`Net pay ${formatMoney(payslip.netPay)}`}
        style={{ marginTop: theme.spacing.xs }}
      >
        {formatMoney(payslip.netPay)}
      </AppText>
      <AppText variant="footnote" tone="muted">
        Net pay
      </AppText>

      <Card
        padded={false}
        style={{ marginTop: theme.spacing.xl, paddingHorizontal: theme.spacing.md }}
      >
        <Line label="Gross" value={formatMoney(payslip.gross)} first />
        <Line label="Total deductions" value={formatMoney(payslip.totalDeductions)} />
        <Line label="Net pay" value={formatMoney(payslip.netPay)} emphasis />
      </Card>

      <Card
        padded={false}
        style={{ marginTop: theme.spacing.lg, paddingHorizontal: theme.spacing.md }}
      >
        <Line label="Working days" value={String(payslip.workingDays)} first />
        <Line label="Days present" value={String(payslip.presentDays)} />
        {payslip.lopDays > 0 ? (
          <Line
            label="Loss of pay"
            value={`${payslip.lopDays} ${payslip.lopDays === 1 ? "day" : "days"}`}
          />
        ) : null}
      </Card>

      {payslip.anomalies.length > 0 ? (
        // Surfaced rather than hidden. These are the payroll engine's own
        // doubts about the figure, and the person it belongs to has more
        // context than anyone to say whether they are right.
        <Banner
          tone="warning"
          title="Flagged for review"
          style={{ marginTop: theme.spacing.lg }}
        >
          {payslip.anomalies.map((anomaly) => (
            <AppText key={anomaly} variant="footnote" tone="warning" style={{ marginTop: 2 }}>
              {anomaly}
            </AppText>
          ))}
        </Banner>
      ) : null}

      <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.xl }}>
        If any figure here looks wrong, raise it with HR rather than
        recalculating it yourself — the amounts come from the payroll run and
        this screen does no arithmetic of its own.
      </AppText>
    </Screen>
  );
}

function Line({
  label,
  value,
  emphasis = false,
  first = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  first?: boolean;
}) {
  const theme = useTheme();

  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        borderTopColor: theme.colors.borderSubtle,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth * 2,
        paddingVertical: theme.spacing.md,
      }}
    >
      <AppText
        variant="body"
        tone={emphasis ? "default" : "muted"}
        weight={emphasis ? "semibold" : "regular"}
      >
        {label}
      </AppText>
      <AppText variant="body" weight={emphasis ? "bold" : "medium"} tabular>
        {value}
      </AppText>
    </View>
  );
}
