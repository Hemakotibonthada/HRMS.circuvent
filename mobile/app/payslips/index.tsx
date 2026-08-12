import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ApiError, OfflineError } from "@/lib/contracts";
import { formatMoney, formatPeriod } from "@shared/money/format";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TOUCH_TARGET } from "@/theme/tokens";

interface Payslip {
  id: string;
  runId: string;
  periodMonth?: number;
  periodYear?: number;
  gross: number;
  totalDeductions: number;
  netPay: number;
  lopDays: number;
  status: string;
}

/**
 * Payslip history.
 *
 * Read-only, and no arithmetic anywhere. The amounts arrive already converted
 * from the bigint minor units they are stored in; adding them up on a phone
 * would reintroduce exactly the float error the bigint exists to prevent. If a
 * total is ever needed here, it comes from the server.
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
  const [error, setError] = useState<string | null>(null);

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
        setError("Offline. Payslips are not stored on this device, so they need a connection.");
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
        {error ? (
          <Text
            accessibilityRole="alert"
            style={{
              color: theme.colors.danger,
              fontSize: theme.fontSize.body,
              lineHeight: theme.lineHeight.body,
            }}
          >
            {error}
          </Text>
        ) : loading ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.body }}>
            Loading…
          </Text>
        ) : payslips.length === 0 ? (
          <Text
            style={{
              color: theme.colors.textMuted,
              fontSize: theme.fontSize.body,
              lineHeight: theme.lineHeight.body,
            }}
          >
            You have no payslips yet. They appear here once a payroll run has been approved.
          </Text>
        ) : (
          payslips.map((payslip) => {
            const period = formatPeriod(payslip.periodMonth, payslip.periodYear);
            return (
              <Pressable
                key={payslip.id}
                accessibilityRole="button"
                // One label for the whole row. Otherwise a screen reader stops
                // on the month and the amount separately, and the amount
                // arrives with nothing attached to it.
                accessibilityLabel={`${period}, net pay ${formatMoney(payslip.netPay)}`}
                accessibilityHint="Opens the full breakdown"
                onPress={() => router.push(`/payslips/${payslip.id}`)}
                style={{
                  minHeight: MIN_TOUCH_TARGET,
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.border,
                  borderWidth: StyleSheet.hairlineWidth * 2,
                  borderRadius: theme.radius.md,
                  padding: theme.spacing.md,
                  marginBottom: theme.spacing.sm,
                }}
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
                    {period}
                  </Text>
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontSize: theme.fontSize.callout,
                      lineHeight: theme.lineHeight.callout,
                      fontWeight: theme.fontWeight.semibold,
                      // Without tabular figures a column of amounts does not
                      // line up, and misaligned money is hard to scan.
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatMoney(payslip.netPay)}
                  </Text>
                </View>
                <Text
                  style={{
                    color: theme.colors.textMuted,
                    fontSize: theme.fontSize.footnote,
                    lineHeight: theme.lineHeight.footnote,
                    marginTop: 2,
                  }}
                >
                  Net pay
                  {payslip.lopDays > 0
                    ? ` · ${payslip.lopDays} ${payslip.lopDays === 1 ? "day" : "days"} loss of pay`
                    : ""}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
