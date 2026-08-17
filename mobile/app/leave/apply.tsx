import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { AppText } from "@/components/Typography";
import { ApiError } from "@/lib/contracts";
import {
  daysBetween,
  isRealDate,
  todayIso,
  validateLeave,
  type LeaveField,
} from "@/lib/leave-rules";
import { useSync } from "@/lib/sync";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TOUCH_TARGET } from "@/theme/tokens";

const LEAVE_TYPES = [
  "casual",
  "sick",
  "earned",
  "maternity",
  "paternity",
  "bereavement",
  "unpaid",
] as const;

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function ApplyLeaveScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { submit } = useSync();

  const today = useMemo(() => todayIso(), []);

  const [leaveType, setLeaveType] = useState<string>("casual");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Partial<Record<LeaveField, string>>>({});
  const [banner, setBanner] = useState<{
    tone: "info" | "warning" | "error";
    title: string;
    description?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const totalDays = useMemo(() => {
    if (!isRealDate(startDate) || !isRealDate(endDate) || endDate < startDate) return null;
    const days = daysBetween(startDate, endDate);
    return isHalfDay ? 0.5 : days;
  }, [startDate, endDate, isHalfDay]);

  const apply = useCallback(async () => {
    setBanner(null);

    // Built here rather than in the component body. A fresh object on every
    // render changes this callback's identity every render, which defeats the
    // memoisation and re-creates the handler under the finger mid-tap.
    const found = validateLeave(
      { leaveType, startDate, endDate, isHalfDay, reason },
      today
    );
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const outcome = await submit(
        "leave.apply",
        {
          leaveType,
          startDate,
          endDate,
          isHalfDay,
          reason: reason.trim(),
        },
        {
          // Derived from the request itself, so tapping twice — or retrying
          // after a lost response — cannot book the same leave twice.
          id: `leave-${startDate}-${endDate}-${leaveType}-${isHalfDay ? "half" : "full"}`,
          streamKey: "leave",
        }
      );

      if (outcome === "sent") {
        router.back();
      } else if (outcome === "queued") {
        setBanner({
          tone: "info",
          title: "Saved on this device",
          description: "It will be submitted when you have a connection.",
        });
      } else {
        // Permanently refused. Going back to the list would show no new
        // request and no explanation for why.
        setBanner({
          tone: "error",
          title: "This request was not submitted",
          description:
            "It will not be retried. Check the dates and your balance, or speak to HR.",
        });
      }
    } catch (error) {
      setBanner({
        tone: "error",
        title: "That did not work",
        description:
          error instanceof ApiError ? error.message : "Something went wrong. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }, [today, submit, leaveType, startDate, endDate, isHalfDay, reason, router]);

  return (
    <Screen keyboardAware>
      {banner ? (
        <Banner
          tone={banner.tone}
          title={banner.title}
          description={banner.description}
          style={{ marginBottom: theme.spacing.lg }}
        />
      ) : null}

      <AppText variant="footnote" weight="medium" style={{ marginBottom: theme.spacing.sm }}>
        Leave type
      </AppText>

      {/* A row of buttons rather than a picker. Seven options fit, and a
          native picker on Android is a modal that hides the rest of the form
          — including the error the person is trying to fix. */}
      <View accessibilityRole="radiogroup" style={[styles.chips, { marginBottom: theme.spacing.lg }]}>
        {LEAVE_TYPES.map((type) => {
          const selected = leaveType === type;

          return (
            <Pressable
              key={type}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={`${titleCase(type)} leave`}
              onPress={() => setLeaveType(type)}
              hitSlop={4}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                justifyContent: "center",
                paddingHorizontal: theme.spacing.lg,
                marginRight: theme.spacing.sm,
                marginBottom: theme.spacing.sm,
                borderRadius: theme.radius.pill,
                backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceElevated,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: selected ? theme.colors.primary : theme.colors.border,
              }}
            >
              <AppText
                variant="footnote"
                tone={selected ? "onPrimary" : "default"}
                weight={selected ? "semibold" : "regular"}
              >
                {titleCase(type)}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {errors.leaveType ? (
        <AppText
          variant="footnote"
          tone="danger"
          accessibilityRole="alert"
          style={{ marginBottom: theme.spacing.md }}
        >
          {errors.leaveType}
        </AppText>
      ) : null}

      <TextField
        label="Start date"
        hint="YYYY-MM-DD"
        value={startDate}
        onChangeText={(next) => {
          setStartDate(next);
          // A half day is one day, so the end follows the start rather than
          // being left behind at a stale value the user cannot see.
          if (isHalfDay) setEndDate(next);
        }}
        error={errors.startDate}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={10}
        editable={!busy}
      />

      <TextField
        label="End date"
        hint={isHalfDay ? "Same as the start date for a half day" : "YYYY-MM-DD"}
        value={endDate}
        onChangeText={setEndDate}
        error={errors.endDate}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={10}
        editable={!busy && !isHalfDay}
      />

      <View style={[styles.between, { marginBottom: theme.spacing.lg }]}>
        <AppText variant="body">Half day</AppText>
        <Switch
          value={isHalfDay}
          onValueChange={(next) => {
            setIsHalfDay(next);
            if (next) setEndDate(startDate);
          }}
          accessibilityLabel="Half day"
          accessibilityHint="Applies for half of a single day"
          disabled={busy}
        />
      </View>

      {totalDays !== null ? (
        // Shown before submitting, because the number of days is the thing
        // that comes off the balance and the one people get wrong.
        <AppText
          variant="footnote"
          tone="muted"
          accessibilityLiveRegion="polite"
          style={{ marginBottom: theme.spacing.lg }}
        >
          This will use {totalDays} {totalDays === 1 ? "day" : "days"} of your balance.
        </AppText>
      ) : null}

      <TextField
        label="Reason"
        value={reason}
        onChangeText={setReason}
        error={errors.reason}
        multiline
        numberOfLines={3}
        maxLength={1000}
        editable={!busy}
      />

      <Button label="Submit request" onPress={apply} busy={busy} />
      <Button
        label="Cancel"
        variant="ghost"
        onPress={() => router.back()}
        disabled={busy}
        style={{ marginTop: theme.spacing.sm }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap" },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
