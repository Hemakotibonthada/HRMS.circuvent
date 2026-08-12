import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
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
  const [error, setError] = useState<string | null>(null);

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
        setError("Offline. Payslips are not stored on this device.");
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
        ) : !payslip ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.body }}>
            This payslip could not be found.
          </Text>
        ) : (
          <View>
            <Text
              accessibilityRole="header"
              style={{
                color: theme.colors.textMuted,
                fontSize: theme.fontSize.body,
                lineHeight: theme.lineHeight.body,
              }}
            >
              {formatPeriod(payslip.periodMonth, payslip.periodYear)}
            </Text>

            <Text
              accessibilityLabel={`Net pay ${formatMoney(payslip.netPay)}`}
              style={{
                color: theme.colors.text,
                fontSize: theme.fontSize.display,
                lineHeight: theme.lineHeight.display,
                fontWeight: theme.fontWeight.bold,
                fontVariant: ["tabular-nums"],
                marginTop: theme.spacing.xs,
              }}
            >
              {formatMoney(payslip.netPay)}
            </Text>
            <Text
              style={{
                color: theme.colors.textMuted,
                fontSize: theme.fontSize.footnote,
                lineHeight: theme.lineHeight.footnote,
              }}
            >
              Net pay
            </Text>

            <View style={{ marginTop: theme.spacing.xl }}>
              <Line label="Gross" value={formatMoney(payslip.gross)} />
              <Line label="Total deductions" value={formatMoney(payslip.totalDeductions)} />
              <Line label="Net pay" value={formatMoney(payslip.netPay)} emphasis />
            </View>

            <View style={{ marginTop: theme.spacing.xl }}>
              <Line label="Working days" value={String(payslip.workingDays)} />
              <Line label="Days present" value={String(payslip.presentDays)} />
              {payslip.lopDays > 0 ? (
                <Line label="Loss of pay" value={`${payslip.lopDays} days`} />
              ) : null}
            </View>

            {payslip.anomalies.length > 0 ? (
              // Surfaced rather than hidden. These are the payroll engine's own
              // doubts about the figure, and the person it belongs to has more
              // context than anyone to say whether they are right.
              <View
                style={{
                  backgroundColor: theme.colors.warningSubtle,
                  borderRadius: theme.radius.md,
                  padding: theme.spacing.md,
                  marginTop: theme.spacing.xl,
                }}
              >
                <Text
                  style={{
                    color: theme.colors.warning,
                    fontSize: theme.fontSize.footnote,
                    lineHeight: theme.lineHeight.footnote,
                    fontWeight: theme.fontWeight.semibold,
                  }}
                >
                  Flagged for review
                </Text>
                {payslip.anomalies.map((anomaly) => (
                  <Text
                    key={anomaly}
                    style={{
                      color: theme.colors.warning,
                      fontSize: theme.fontSize.footnote,
                      lineHeight: theme.lineHeight.footnote,
                      marginTop: theme.spacing.xs,
                    }}
                  >
                    {anomaly}
                  </Text>
                ))}
              </View>
            ) : null}

            <Text
              style={{
                color: theme.colors.textMuted,
                fontSize: theme.fontSize.caption,
                lineHeight: theme.lineHeight.caption,
                marginTop: theme.spacing.xl,
              }}
            >
              If any figure here looks wrong, raise it with HR rather than
              recalculating it yourself — the amounts come from the payroll run
              and this screen does no arithmetic of its own.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Line({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
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
        borderTopWidth: StyleSheet.hairlineWidth * 2,
        paddingVertical: theme.spacing.md,
      }}
    >
      <Text
        style={{
          color: emphasis ? theme.colors.text : theme.colors.textMuted,
          fontSize: theme.fontSize.body,
          lineHeight: theme.lineHeight.body,
          fontWeight: emphasis ? theme.fontWeight.semibold : theme.fontWeight.regular,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: theme.colors.text,
          fontSize: theme.fontSize.body,
          lineHeight: theme.lineHeight.body,
          fontWeight: emphasis ? theme.fontWeight.bold : theme.fontWeight.medium,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
});
