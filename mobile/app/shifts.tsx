import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { SkeletonList } from "@/components/Skeleton";
import { StatusPill } from "@/components/StatusPill";
import { AppText } from "@/components/Typography";
import { ApiError, OfflineError } from "@/lib/contracts";
import { todayIso } from "@/lib/leave-rules";
import {
  addDays,
  dayLabel,
  formatClock,
  formatDuration,
  groupByDay,
  isOvernight,
  nextShift,
  shiftState,
  type ShiftAssignment,
} from "@/lib/shift-rules";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme/ThemeProvider";

interface ShiftsResponse {
  employeeId: string;
  from: string;
  to: string;
  shifts: ShiftAssignment[];
  totalMinutes: number;
}

/** How far ahead to look. A month is the horizon a published roster covers. */
const HORIZON_DAYS = 28;
/** How far back "show earlier" reaches. */
const HISTORY_DAYS = 7;

/**
 * My shifts.
 *
 * The server returns published rosters only, and that is the whole point of
 * the screen: a draft roster still moves, and someone who arranged childcare
 * around a shift that later changed has been failed by the software rather
 * than by the roster.
 *
 * Upcoming is the default view. A rota is read forwards — the question is
 * almost always "when am I next in", and opening on last Tuesday makes the
 * reader scroll to find out.
 */
export default function ShiftsScreen() {
  const theme = useTheme();
  const { api } = useSession();

  const [shifts, setShifts] = useState<ShiftAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<{ title: string; description?: string } | null>(null);
  const [includeHistory, setIncludeHistory] = useState(false);

  const today = todayIso();
  const from = includeHistory ? addDays(today, -HISTORY_DAYS) : today;
  const to = addDays(today, HORIZON_DAYS);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await api.get<ShiftsResponse>(
        `/api/roster/my-shifts?from=${from}&to=${to}`
      );
      setShifts(response.shifts);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setError({
          title: "You are offline",
          description:
            "Your shifts are not stored on this device. Pull down to try again when you have a connection.",
        });
      } else if (caught instanceof ApiError) {
        setError({ title: "Your shifts could not be loaded", description: caught.message });
      } else {
        setError({ title: "Your shifts could not be loaded" });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const upNext = useMemo(() => nextShift(shifts), [shifts]);
  const days = useMemo(() => groupByDay(shifts), [shifts]);

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
        <SkeletonList rows={4} rowHeight={72} />
      ) : (
        <>
          {upNext ? <NextShiftCard shift={upNext} today={today} /> : null}

          {days.length === 0 ? (
            <EmptyState
              title={includeHistory ? "No shifts in this period" : "No shifts scheduled"}
              description={
                includeHistory
                  ? "Nothing has been published for you between last week and the next four weeks."
                  : "Nothing has been published for you in the next four weeks. Published rosters appear here as soon as your manager releases them."
              }
              action={
                includeHistory ? undefined : (
                  <Button
                    label="Show the last week"
                    variant="secondary"
                    fullWidth={false}
                    onPress={() => setIncludeHistory(true)}
                  />
                )
              }
            />
          ) : (
            days.map((day) => (
              <View key={day.date} style={{ marginTop: theme.spacing.lg }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <AppText variant="footnote" weight="semibold" tone="muted" heading>
                    {dayLabel(day.date, today)}
                  </AppText>
                  <AppText variant="footnote" tone="muted" tabular>
                    {formatDuration(day.totalMinutes)}
                  </AppText>
                </View>

                {day.shifts.map((shift) => (
                  <ShiftRow key={shift.id} shift={shift} />
                ))}
              </View>
            ))
          )}

          {!includeHistory && days.length > 0 ? (
            <Button
              label="Show the last week"
              variant="ghost"
              onPress={() => setIncludeHistory(true)}
              accessibilityHint="Adds the previous seven days to the list"
              style={{ marginTop: theme.spacing.lg }}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}

/**
 * The shift being worked, or the next one to start.
 *
 * Given its own card at the top because it answers the question the screen was
 * opened to answer. Highlighted with a border as well as a colour, so it is
 * still distinguishable with a colour filter on.
 */
function NextShiftCard({ shift, today }: { shift: ShiftAssignment; today: string }) {
  const theme = useTheme();
  const state = shiftState(shift);
  const running = state === "in_progress";
  const overnight = isOvernight(shift);

  const when = `${dayLabel(shift.shiftDate, today)}, ${formatClock(shift.startsAt)} to ${formatClock(shift.endsAt)}`;

  return (
    <Card highlighted>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <AppText variant="caption" weight="semibold" tone="primary">
          {running ? "ON SHIFT NOW" : "NEXT SHIFT"}
        </AppText>
        {overnight ? <StatusPill label="Overnight" tone="info" /> : null}
      </View>

      <AppText variant="title3" weight="bold" style={{ marginTop: theme.spacing.xs }}>
        {shift.patternName ?? "Shift"}
      </AppText>

      {/* One label for the row: a screen reader announcing the day, the start
          and the end as three stops loses which is which. */}
      <AppText
        variant="body"
        tone="muted"
        tabular
        accessibilityLabel={`${running ? "On shift now" : "Next shift"}: ${when}`}
        style={{ marginTop: 2 }}
      >
        {when}
      </AppText>

      <AppText variant="footnote" tone="muted" tabular style={{ marginTop: theme.spacing.xs }}>
        {formatDuration(shift.durationMinutes)}
        {overnight ? " · finishes the next day" : ""}
      </AppText>

      {shift.note ? (
        <AppText variant="footnote" style={{ marginTop: theme.spacing.sm }}>
          {shift.note}
        </AppText>
      ) : null}
    </Card>
  );
}

function ShiftRow({ shift }: { shift: ShiftAssignment }) {
  const theme = useTheme();
  const state = shiftState(shift);
  const overnight = isOvernight(shift);

  const times = `${formatClock(shift.startsAt)} – ${formatClock(shift.endsAt)}`;
  const name = shift.patternName ?? "Shift";

  return (
    <Card
      muted={state === "past"}
      style={{ marginTop: theme.spacing.sm }}
      // Read as one sentence. The parts are meaningless apart.
      accessibilityLabel={`${name}, ${times}, ${formatDuration(shift.durationMinutes)}${
        overnight ? ", finishes the next day" : ""
      }${state === "past" ? ", finished" : ""}`}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flex: 1, paddingRight: theme.spacing.sm }}>
          <AppText
            variant="body"
            weight="medium"
            tone={state === "past" ? "muted" : "default"}
            numberOfLines={1}
          >
            {name}
          </AppText>
          <AppText variant="footnote" tone="muted" tabular style={{ marginTop: 2 }}>
            {times} · {formatDuration(shift.durationMinutes)}
          </AppText>
        </View>

        {/* State in words. A past shift dimmed only by opacity is
            indistinguishable from a disabled one. */}
        {state === "in_progress" ? (
          <StatusPill label="Now" tone="success" />
        ) : state === "past" ? (
          <StatusPill label="Finished" tone="neutral" />
        ) : overnight ? (
          <StatusPill label="Overnight" tone="info" />
        ) : null}
      </View>

      {shift.note ? (
        <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.xs }}>
          {shift.note}
        </AppText>
      ) : null}
    </Card>
  );
}
