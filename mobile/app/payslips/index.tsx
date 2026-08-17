import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Banner } from "@/components/Banner";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SkeletonList } from "@/components/Skeleton";
import { AppText } from "@/components/Typography";
import { ApiError, OfflineError } from "@/lib/contracts";
import { formatMoney, formatPeriod } from "@shared/money/format";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

interface Payslip {
  id: string;
  runId: string;
  periodMonth?: number;
  periodYear?: number;
  gross: number;
  totalDeductions: number;
  netPay: number;
  /**
   * Exact whole paise, as strings, alongside the display floats.
   *
   * A total computed from `netPay` would reintroduce the float error the
   * bigint storage exists to prevent. These can be added exactly.
   */
  grossMinor: string;
  totalDeductionsMinor: string;
  netPayMinor: string;
  lopDays: number;
  status: string;
}

/**
 * Payslip history.
 *
 * Read-only. The float amounts are for printing one value at a time; the
 * `*Minor` fields carry exact paise, so a total no longer has to be asked of
 * the server — it just must not be computed from the floats.
 *
 * The server returns only approved and paid runs. A draft is still being
 * corrected, and showing someone a figure that later changes is worse than
 * showing nothing — so there is no pending state to render.
 */
export default function PayslipsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { api } = useSession();

  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<{ title: string; description?: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await api.get<{ payslips: Payslip[] }>("/api/payroll/payslips");
      setPayslips(response.payslips);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        // Deliberately not cached on the device. Salary is the most sensitive
        // field in the product, and leaving it in app storage so it can be
        // read offline is a poor trade for a screen nobody opens in a tunnel.
        setError({
          title: "You are offline",
          description:
            "Payslips are not stored on this device, so they need a connection.",
        });
      } else if (caught instanceof ApiError) {
        setError({ title: "Your payslips could not be loaded", description: caught.message });
      } else {
        setError({ title: "Your payslips could not be loaded" });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen
      tabBarInset
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
    >
      {error ? <Banner tone="error" title={error.title} description={error.description} /> : null}

      {loading ? (
        <SkeletonList rows={5} rowHeight={64} />
      ) : payslips.length === 0 && !error ? (
        <EmptyState
          title="No payslips yet"
          description="A payslip appears here once the payroll run covering it has been approved. Runs still being corrected are not shown."
        />
      ) : (
        payslips.map((payslip) => {
          const period = formatPeriod(payslip.periodMonth, payslip.periodYear);

          return (
            <Card
              key={payslip.id}
              onPress={() => router.push(`/payslips/${payslip.id}`)}
              // One label for the whole row. Otherwise a screen reader stops
              // on the month and the amount separately, and the amount arrives
              // with nothing attached to it.
              accessibilityLabel={`${period}, net pay ${formatMoney(payslip.netPay)}`}
              accessibilityHint="Opens the full breakdown"
              style={{ marginBottom: theme.spacing.sm }}
            >
              <View style={styles.between}>
                <AppText variant="body" weight="medium">
                  {period}
                </AppText>
                {/* Without tabular figures a column of amounts does not line
                    up, and misaligned money is hard to scan. */}
                <AppText variant="callout" weight="semibold" tabular>
                  {formatMoney(payslip.netPay)}
                </AppText>
              </View>

              <AppText variant="footnote" tone="muted" style={{ marginTop: 2 }}>
                Net pay
                {payslip.lopDays > 0
                  ? ` · ${payslip.lopDays} ${payslip.lopDays === 1 ? "day" : "days"} loss of pay`
                  : ""}
              </AppText>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
