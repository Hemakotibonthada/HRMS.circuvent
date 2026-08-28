import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Banner } from "@/components/Banner";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SkeletonList } from "@/components/Skeleton";
import { StatusPill } from "@/components/StatusPill";
import { AppText } from "@/components/Typography";
import { ApiError, OfflineError } from "@/lib/contracts";
import {
  averageWorkedMinutes,
  canGoForward,
  currentMonth,
  monthLabel,
  monthRange,
  nextMonth,
  previousMonth,
  statusLabel,
  statusTone,
  type AttendanceRecord,
  type AttendanceSummary,
  type MonthCursor,
  type StatusTone,
} from "@/lib/attendance-rules";
import { formatClock, formatDuration } from "@/lib/shift-rules";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TOUCH_TARGET } from "@/theme/tokens";

interface AttendancePage {
  items: AttendanceRecord[];
  total: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PILL_TONE: Record<StatusTone, "success" | "warning" | "danger" | "neutral"> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  neutral: "neutral",
};

/**
 * Attendance history.
 *
 * One month at a time, because that is the unit attendance is questioned in —
 * a payslip covers a month, and the argument that brings someone here is
 * almost always about one.
 *
 * The employee id is sent explicitly. `/api/attendance` scopes an ordinary
 * employee to themselves and ignores the parameter, but for a manager it is
 * the *filter*, and omitting it returns the whole organisation. A manager
 * opening their own attendance and being shown everybody's — with no names
 * attached — reads as a broken screen rather than as a permission.
 */
export default function AttendanceScreen() {
  const theme = useTheme();
  const { api, user } = useSession();

  const [cursor, setCursor] = useState<MonthCursor>(() => currentMonth());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<{ title: string; description?: string } | null>(null);

  const scope = user && UUID.test(user.id) ? `&employeeId=${user.id}` : "";

  const load = useCallback(async () => {
    setError(null);
    const { from, to } = monthRange(cursor);

    try {
      // Both at once: the totals and the rows they summarise are independent,
      // and two round trips on a mobile connection is twice the wait.
      const [page, totals] = await Promise.all([
        api.get<AttendancePage>(
          `/api/attendance?from=${from}&to=${to}&pageSize=200${scope}`
        ),
        api.get<AttendanceSummary>(
          `/api/attendance/summary?month=${cursor.month}&year=${cursor.year}${scope}`
        ),
      ]);
      setRecords(page.items);
      setSummary(totals);
    } catch (caught) {
      // Cleared rather than left showing the previous month's data under the
      // new month's heading, which would be a quietly wrong screen.
      setRecords([]);
      setSummary(null);

      if (caught instanceof OfflineError) {
        setError({
          title: "You are offline",
          description: "Attendance history is not stored on this device.",
        });
      } else if (caught instanceof ApiError) {
        setError({ title: "This month could not be loaded", description: caught.message });
      } else {
        setError({ title: "This month could not be loaded" });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, cursor, scope]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const forward = canGoForward(cursor);
  const average = useMemo(
    () => (summary ? averageWorkedMinutes(summary) : undefined),
    [summary]
  );

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <MonthStep
          direction="back"
          label={`Go to ${monthLabel(previousMonth(cursor))}`}
          onPress={() => setCursor(previousMonth(cursor))}
        />

        <AppText variant="callout" weight="semibold" heading>
          {monthLabel(cursor)}
        </AppText>

        <MonthStep
          direction="forward"
          // Disabled in the current month rather than hidden. A control that
          // disappears makes people think they broke something; one that is
          // visibly inert says "this is as far as it goes".
          disabled={!forward}
          label={forward ? `Go to ${monthLabel(nextMonth(cursor))}` : "This is the current month"}
          onPress={() => setCursor(nextMonth(cursor))}
        />
      </View>

      {error ? (
        <Banner
          tone="error"
          title={error.title}
          description={error.description}
          style={{ marginTop: theme.spacing.lg }}
        />
      ) : null}

      {loading ? (
        <View style={{ marginTop: theme.spacing.lg }}>
          <SkeletonList rows={5} rowHeight={60} />
        </View>
      ) : (
        <>
          {summary ? (
            <Card style={{ marginTop: theme.spacing.lg }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                <Total label="Present" value={String(summary.presentDays)} />
                <Total label="Absent" value={String(summary.absentDays)} />
                <Total label="Leave" value={String(summary.leaveDays)} />
                <Total label="Remote" value={String(summary.wfhDays)} />
              </View>

              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  marginTop: theme.spacing.md,
                  borderTopColor: theme.colors.borderSubtle,
                  borderTopWidth: 1,
                  paddingTop: theme.spacing.md,
                }}
              >
                <Total label="Worked" value={formatDuration(summary.totalWorkedMinutes)} />
                <Total label="Overtime" value={formatDuration(summary.totalOvertimeMinutes)} />
                {/* An em dash, not "0h". Nobody averaged nothing; there was
                    nothing to average. */}
                <Total
                  label="Average day"
                  value={average === undefined ? "—" : formatDuration(average)}
                />
                <Total label="Late" value={String(summary.lateDays)} />
              </View>
            </Card>
          ) : null}

          {records.length === 0 && !error ? (
            <EmptyState
              title="Nothing recorded this month"
              description="Days you clock in, take leave or work from home will appear here."
            />
          ) : (
            records.map((record) => <RecordRow key={record.id} record={record} />)
          )}
        </>
      )}
    </Screen>
  );
}

function MonthStep({
  direction,
  label,
  onPress,
  disabled = false,
}: {
  direction: "back" | "forward";
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Conveyed to assistive technology, not only as a dimmed chevron.
      accessibilityState={{ disabled }}
      hitSlop={8}
      style={({ pressed }) => ({
        minWidth: MIN_TOUCH_TARGET,
        minHeight: MIN_TOUCH_TARGET,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: theme.radius.md,
        opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
      })}
    >
      <Feather
        name={direction === "back" ? "chevron-left" : "chevron-right"}
        size={24}
        color={theme.colors.text}
      />
    </Pressable>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  const theme = useTheme();

  return (
    <View
      // One stop per figure. Split across two nodes a screen reader reads the
      // number and then the word, with no way to tell they belong together.
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{ width: "50%", paddingVertical: theme.spacing.xs }}
    >
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText variant="title3" weight="bold" tabular>
        {value}
      </AppText>
    </View>
  );
}

function RecordRow({ record }: { record: AttendanceRecord }) {
  const theme = useTheme();

  const day = new Date(`${record.workDate}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  const times =
    record.clockInAt || record.clockOutAt
      ? `${formatClock(record.clockInAt ?? "")} – ${formatClock(record.clockOutAt ?? "")}`
      : "No punches";

  return (
    <Card
      style={{ marginTop: theme.spacing.sm }}
      accessibilityLabel={`${day}, ${statusLabel(record.status)}, ${times}${
        record.workedMinutes ? `, worked ${formatDuration(record.workedMinutes)}` : ""
      }`}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flex: 1, paddingRight: theme.spacing.sm }}>
          <AppText variant="body" weight="medium">
            {day}
          </AppText>
          <AppText variant="footnote" tone="muted" tabular style={{ marginTop: 2 }}>
            {times}
            {record.workedMinutes ? ` · ${formatDuration(record.workedMinutes)}` : ""}
          </AppText>
        </View>

        <StatusPill label={statusLabel(record.status)} tone={PILL_TONE[statusTone(record.status)]} />
      </View>

      {record.lateByMinutes > 0 || record.requiresLocationReview || record.isRegularized ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: theme.spacing.xs }}>
          {record.lateByMinutes > 0 ? (
            <AppText variant="caption" tone="warning" tabular style={{ marginRight: theme.spacing.md }}>
              {formatDuration(record.lateByMinutes)} late
            </AppText>
          ) : null}

          {record.requiresLocationReview ? (
            // Stated plainly, and stated as requiring nothing. A flag someone
            // cannot act on but is not told the meaning of reads as an
            // accusation.
            <AppText variant="caption" tone="muted" style={{ marginRight: theme.spacing.md }}>
              Location being checked · nothing needed from you
            </AppText>
          ) : null}

          {record.isRegularized ? (
            <AppText variant="caption" tone="muted">
              Corrected by HR
            </AppText>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
